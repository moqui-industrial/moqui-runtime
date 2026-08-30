---
name: place-sales-order
title: Place a sales order
description: Create a sales order with line items for an existing customer (two canvases)
risk: confirm
screens: [/rest/s1/mantle/orders]
---
# Sales order — two canvases (two user clicks)

Demo IDs (do not look them up): customer `CustJqp` (Joe Q Public), vendor `ORG_ZIZI_RETAIL`, store `POPC_DEFAULT`, products `DEMO_1_1` and `DEMO_1_2`.

**Canvas 1 — header only.** Fields: `customerPartyId`, `vendorPartyId`, `productStoreId`, `orderName`. Action: POST `/rest/s1/mantle/orders` (JSON; returns `orderId`, `orderPartSeqId`).

**After header submit:** `request` that POST, then `writeThrough: true` a **second** canvas: display `orderId` and `orderPartSeqId`, fields `productId`, `quantity`. Action path `/rest/s1/mantle/orders/{orderId}/items` method POST, `bodyFromFields:["orderPartSeqId","productId","quantity"]`. Prefill first item `DEMO_1_1` qty `2`.

**After item submit:** `request` POST items for `DEMO_1_1` qty 2 and `DEMO_1_2` qty 1 (use `orderId`/`orderPartSeqId` from the previous result). Then confirm with those ids.
