# Inventory Dashboard — TechNest Computers

An inventory-only dashboard for a small computer store with three branches (Tel Aviv, Jerusalem, Ariel). It reads its data **live from an Airtable base** through the Airtable API (the Excel files in `data/` are the original sample data and an offline fallback) and shows what is on the shelves, what is already ordered by customers, what is *really* available, what is running low, what is arriving from suppliers, and where each item is.

## Run it

Browsers block reading local files directly, so start a tiny local server in this folder:

```bash
npx serve .
```

Then open the address it prints (usually http://localhost:3000). On Windows you can also double-click `start-dashboard.bat`.

## Connect it to Airtable

1. Create an Airtable base with these 9 tables (the Excel files in `data/` can be imported; `Order_Items`, `PO_Items` and `Stock_Movements` are the second sheets of `orders.xlsx`, `purchase_orders.xlsx` and `inventory.xlsx`): Branches, Suppliers, Products, Orders, Order_Items, Purchase Orders, PO_Items, Inventory, Stock_Movements. Column names must match the mapping at the top of the Airtable section in [app.js](app.js) (`const AT = {...}`).
2. Create a Personal Access Token at https://airtable.com/create/tokens with the scope `data.records:read` and access to that base.
3. Copy `airtable-config.example.js` to `airtable-config.js` and fill in your **base ID** (the `app...` part of the base URL) and the **token**. This file is in `.gitignore`, so the token is never uploaded.
4. Start the server (see above) and open the dashboard. The header should say **Source: Airtable (live)**.

Without `airtable-config.js` (or with the placeholder token) the dashboard falls back to the Excel files in `data/`.

## How to see that the data comes from Airtable, not from a static file

- The header shows **Source: Airtable (live)** and the time of the last load. The data-checks panel (header badge) lists every `Airtable › <table>` that was fetched.
- Open the browser DevTools (F12) → **Network** → click **↻ Refresh data**: you will see requests to `api.airtable.com` and none to `data/*.xlsx`.
- Add, edit or delete a row in Airtable, then click **↻ Refresh data**: the change appears immediately, and no file in this repo was touched.
- The code is in [app.js](app.js): `AT` (table and field mapping), `atTable` / `loadAirtable` (fetching, paging and resolving linked records) and `loadAll` (chooses Airtable or Excel).

Note: Airtable limits API calls (5 requests per second per base; 1,000 calls per month on the Free plan, 100,000 on Team). One full load is about 34 calls, so the dashboard refreshes only on load and when you click the button, not on a timer.

## Features

- Filters: branch, category, brand, stock status, search
- Really available = on the shelves − ordered by customers (for example 33 HP laptops on shelves, 3 ordered → 30 available: Tel Aviv 16, Jerusalem 8, Ariel 6)
- **Insights** (bell icon): out of stock, running low, late deliveries, suggested transfers between branches, overdue stock counts and more
- Per-branch stock, deliveries on the way, product detail with stock-movement history
- Data checks run on every load (badge in the header)

## Contents

| File / folder | Description |
|---|---|
| `index.html`, `styles.css`, `app.js` | The dashboard |
| `airtable-config.example.js` | Template for your private `airtable-config.js` (base ID and token) |
| `lib/` | SheetJS (reads Excel) and Chart.js, bundled so it works offline |
| `data/` | Excel source data: branches, products, suppliers, customers, orders, purchase orders, inventory |
| `ER.md` | Entity-relationship diagram (Mermaid) with primary and foreign keys |
| `ER.drawio` | The same ERD for draw.io / diagrams.net |
| `SPEC.md` | Detailed dashboard design |
| `practice.md` | Project conventions (English, blue and light-gray palette, data rules) |

## Data

All data is **fictional** and was generated for this project. It covers 2026-01-01 to 2026-11-09: 66 products, 3 branches, 40 customers, 300 orders and 222 purchase orders.
