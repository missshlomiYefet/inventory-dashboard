# SPEC — Inventory Dashboard (TechNest Computers)

Status: Draft v1 · Date: 2026-11-09

## 1. Purpose

A single-page web dashboard that shows, at a glance, what the store has in stock, what is running low, what is on order, and how sales are moving. It replaces opening five Excel files and counting by hand.

## 2. Users

| User | What they need to know | Typical questions |
|---|---|---|
| **Store owner / business owner** | Business health | How much money is tied up in stock? What are the best sellers? Revenue and margin trend? |
| **Inventory manager** (also called *inventory controller*, *stock controller*, or *warehouse / stockroom manager* in small shops) | Day-to-day stock position | What must I reorder today? What is out of stock? What is arriving and when? |
| **Purchasing / procurement officer** (often the same person in a small store) | Supplier follow-up | Which purchase orders are late? Which supplier is slow? |

Yes — "Inventory Manager" or "Inventory Controller" is the usual job title for the person in charge of inventory.

## 3. Non-negotiable requirements

1. **Refresh on every load.** Every browser refresh (and a Refresh button) re-reads the Excel files. No cached results, no hard-coded numbers. The dashboard shows a "Data as of" timestamp and the files' last-modified times.
2. **Data accuracy.** Every figure is calculated from the source tables, never typed in. See section 8 (validation) for the checks that run on each load. If a check fails, a red banner names the problem instead of showing numbers silently.
3. **Language:** English. **Palette:** blues and light grays (see `practice.md`).

## 4. Data sources

All files are in `data/`. See `ER.md` for keys and relationships.

| File | Sheets | Rows (sample) |
|---|---|---|
| `products.xlsx` | Products | 66 |
| `suppliers.xlsx` | Suppliers | 6 |
| `customers.xlsx` | Customers | 40 |
| `orders.xlsx` | Orders, Order_Items | 300 / 639 |
| `purchase_orders.xlsx` | Purchase_Orders, PO_Items | 110 / 164 |
| `inventory.xlsx` | Inventory, Stock_Movements, Stock_By_Brand_Category | 66 / 886 / derived |

Sample period: 2026-01-01 to 2026-11-09. Currency: USD ($). Prices exclude tax.

## 5. Definitions (single source of truth)

| Term | Definition |
|---|---|
| On hand | `Inventory.quantity_on_hand` (physically in the store) |
| Reserved | Units on orders with status *Processing* |
| Available | On hand − Reserved |
| On order | Units on purchase orders with status *Ordered* |
| Stock value (at cost) | Σ on hand × `unit_cost` |
| Retail value | Σ on hand × `unit_price` |
| Out of stock | Available = 0 |
| Low stock | 0 < Available ≤ `reorder_level` |
| Needs reorder | Active product where Available + On order ≤ `reorder_level` |
| Revenue | Σ `order_total` of orders whose status is *Completed*, *Processing* or *Returned*, excluding *Cancelled*. Returned orders are shown separately and deducted in the net-revenue KPI. |
| Gross margin | Σ line_total − Σ quantity × `unit_cost` over the same orders |
| Days of stock | Available ÷ average daily units sold over the last 90 days |
| Late PO | Status *Ordered* and `expected_date` < today |

Discontinued products are never flagged "needs reorder"; they appear in a separate "sell-through" list while stock remains.

## 6. Dashboard layout

Single page, desktop-first (1440 px), usable on tablet. Top to bottom:

**A. Header bar:** title, "Data as of" time, Refresh button, validation status badge (✔ Data checks passed / ✖ n issues).

**B. KPI row (6 cards):**
1. Total units on hand
2. Stock value at cost
3. Out-of-stock products (count)
4. Low-stock products (count)
5. Open purchase orders (count, with number late)
6. Revenue — last 30 days (with change vs. previous 30 days)

**C. Filters (apply to everything below):** Category, Brand, Supplier, Date range (affects sales charts only), Product status.

**D. Stock section:**
- **Stock by category:** horizontal bar chart (units on hand).
- **Stock by brand within category:** table with *Brand, Category, Products, On hand, Available, Value* — e.g. "HP · Laptops · 3 · 24". Click a row to filter.
- **Stock health donut:** Healthy / Low / Out of stock (product counts).

**E. Action lists (the most-used part for the inventory manager):**
- **Reorder list:** products needing reorder: product, available, on order, reorder level, suggested order qty (`reorder_quantity`), supplier, supplier lead time. Sorted by urgency (lowest days of stock first). Export to CSV button.
- **Out of stock:** product, last sale date, open PO and expected date if any.
- **Open purchase orders:** PO, supplier, order date, expected date, items, total, late flag.

**F. Sales section:**
- Revenue and units by month (column + line).
- Top 10 products by units and by revenue.
- Revenue by category and by sales channel (In-Store vs Online).
- Orders by status (Completed, Processing, Returned, Cancelled).
- Top 5 customers; Individual vs Business split.

**G. Product detail drawer (click any product):** current stock numbers, price/cost/margin, supplier, a movement history table, and a sparkline of stock level over time (reconstructed from Stock_Movements).

## 7. Behavior

- **Load sequence:** fetch all 6 files with cache disabled → parse → run validation → compute metrics → render. Show a loading skeleton, and an error panel if a file is missing or a required column is absent.
- **Refresh:** repeats the load sequence; keeps filters selected.
- **Empty/edge states:** no results for a filter → "No products match these filters" with a Clear button. Zero-stock products display `0`, never blank.
- **Interactivity:** hover tooltips with exact values; click a chart bar/row to cross-filter; sortable table columns; search box for product name or SKU.
- **Accessibility:** color is never the only signal (status also has a text label/icon); contrast ≥ 4.5:1 for text; full keyboard navigation.
- **Performance:** full render under 2 seconds for the sample data (≈ 2,000 rows total); designed to stay responsive up to ~50,000 rows.

## 8. Data validation (run on every load)

| # | Check | Severity |
|---|---|---|
| 1 | Primary keys are unique in every table | Error |
| 2 | Every foreign key points to an existing row (see `ER.md`) | Error |
| 3 | `quantity_on_hand` = Σ Stock_Movements per product | Error |
| 4 | `quantity_available` = on hand − reserved; no negative stock | Error |
| 5 | `quantity_reserved` = units on Processing orders | Error |
| 6 | `quantity_on_order` = units on Ordered purchase orders | Error |
| 7 | `order_total` = Σ its `line_total`; `line_total` = qty × price × (1 − discount) | Error |
| 8 | `po_total` = Σ its `line_total` | Error |
| 9 | Σ `quantity_received` on PO items = Σ "Purchase Received" movements | Error |
| 10 | `unit_price` > `unit_cost` for every product | Warning |
| 11 | Dates are valid and not in the future (except PO `expected_date`) | Warning |

The sample data in `data/` passes all 11 checks (verified when generated).

## 9. Technology (decided: web app, HTML/JS)

- Static page (`index.html` + JS) that reads the `.xlsx` files in `data/` using **SheetJS** and draws charts with a lightweight library (e.g. Chart.js).
- Browsers block file reads from `file://`, so it runs from a tiny local server (e.g. `npx serve .`). Nothing is sent to the internet; data stays on the machine.
- To update data, the user saves the Excel files in `data/` and refreshes the browser.
- Fetch uses `cache: 'no-store'` plus a timestamp query string so refresh always gets the newest file.

## 10. Out of scope (v1)

Writing data back to Excel, user logins and roles, barcode scanning, multi-store / multi-warehouse, tax and shipping, automatic emailing of purchase orders, forecasting beyond "days of stock".

## 11. Open questions for the owner

1. Should *Processing* orders count as revenue, or only *Completed*? (Currently: counted.)
2. Is "low stock" defined by each product's own reorder level (current) or one store-wide rule?
3. Do you want an alert (email / on-screen sound) when a product hits zero, or is the dashboard list enough?
4. Should prices be shown with sales tax, or without (current)?
5. Will the Excel files be edited by hand, or exported from another system? (Affects how strict the validation should be.)
6. Who needs access: only on the shop computer, or also from home / phone?
