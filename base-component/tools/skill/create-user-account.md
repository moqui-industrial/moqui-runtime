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

First canvas (`kind=form`) fields (all `text-line`, prefill from the user message): `username`, `firstName`, `lastName`, `emailAddress`, `newPassword`, `newPasswordVerify`, `userGroupId` (default `ADMIN`).

Actions to declare:

- `{id:"createUser", label:"Create user", method:"POST", path:"/apps/system/Security/UserAccount/UserAccountList/createUserAccount", primary:true, bodyFromFields:["username","firstName","lastName","emailAddress","newPassword","newPasswordVerify"]}`
- `{id:"addGroup", label:"Add to ADMIN", method:"POST", path:"/apps/system/Security/UserGroup/GroupUsers/createUserGroupMember", dependsOn:["createUser"], bodyFromFields:["userId","userGroupId"]}`

After `submitted:true`: `run_service` create#UserAccount, then POST GroupUsers with the returned `userId`. Then a short confirmation (no more input form).
