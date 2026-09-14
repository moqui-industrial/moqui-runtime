---
name: create-user-account
title: Create user account and add to ADMIN
description: Create a UserAccount then add the user to the ADMIN group
risk: confirm
services: [org.moqui.impl.UserServices.create#UserAccount]
---
# Create user account + ADMIN group

`create#UserAccount` is `allow-remote=false`; call it with **`run_service`**, not REST.

- Service: `org.moqui.impl.UserServices.create#UserAccount`
- Parameters: `username`, `firstName`, `lastName`, `emailAddress`, `newPassword`, `newPasswordVerify` (must match)
- Returns: `userId`
- Then add ADMIN: `request` POST `/apps/system/Security/UserGroup/GroupUsers/createUserGroupMember` with `userGroupId=ADMIN`, `userId`, `fromDate` (now is fine if omitted)

First canvas (`kind=openui`) fields (prefill from the user message): `username`, `firstName`, `lastName`, `emailAddress`, `newPassword`, `newPasswordVerify`, `userGroupId` (default `ADMIN`).

Example `lang` (Script mode Mutation POSTs on Create):

```
$username = ""
$firstName = ""
$lastName = ""
$emailAddress = ""
$newPassword = ""
$newPasswordVerify = ""
$userGroupId = "ADMIN"
createUser = Mutation("request", {method:"POST", path:"/apps/system/Security/UserAccount/UserAccountList/createUserAccount", body:{username:$username, firstName:$firstName, lastName:$lastName, emailAddress:$emailAddress, newPassword:$newPassword, newPasswordVerify:$newPasswordVerify}})
root = Stack([CardHeader("Create user"), Form("create", Button("Create user", Action([@Run(createUser)])), [FormControl("Username", Input("username", $username)), FormControl("First name", Input("firstName", $firstName)), FormControl("Last name", Input("lastName", $lastName)), FormControl("Email", Input("emailAddress", $emailAddress)), FormControl("Password", Input("newPassword", $newPassword)), FormControl("Verify", Input("newPasswordVerify", $newPasswordVerify))])])
```

After `submitted:true`: `run_service` create#UserAccount, then POST GroupUsers with the returned `userId`. Then a short confirmation (no more input form).
