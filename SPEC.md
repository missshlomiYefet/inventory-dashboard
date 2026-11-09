# SPEC — Inventory Dashboard (TechNest Computers)

Status: v2 · Date: 2026-11-09 · Implemented in `index.html`, `styles.css`, `app.js`

## 1. Purpose

A single-page web dashboard for **managing inventory only**: what is on the shelves, how much of it is really free to sell, what is about to run out, what is on the way from suppliers, and where each item is (Tel Aviv, Jerusalem or Ariel). It deliberately shows **no revenue and no prices**.

## 2. Users

| User | What they need | Typical questions |
|---|---|---|
| **Store owner / business owner** | Quick health check | Are we out of anything? Which branch is short? |
| **Inventory manager** (also called *inventory controller*, *stock controller*, *warehouse / stockroom manager*) | Daily stock position | What do I reorder today? What should I move between branches? |
| **Purchasing officer** (often the same person) | Supplier follow-up | Which deliveries are late? |

## 3. Non-negotiable requirements

1. **Updated on every refresh.** Every browser refresh (and the *Refresh data* button) re-reads all Excel files with caching disabled. Nothing is hard-coded. The header shows "Stock as of" (latest `last_updated` in the data) and the time of loading.
2. **Accurate data.** Every figure is calculated from the Excel tables. A set of checks (section 9) runs on each load; the header badge shows ✔ or ✖ and a panel lists each check.
3. **English**, blue and light-gray palette (see `practice.md`).

## 4. Data sources (`data/`)

| File | Sheets | Rows (sample) |
|---|---|---|
| `branches.xlsx` | Branches | 3 |
| `products.xlsx` | Products | 66 |
| `suppliers.xlsx` | Suppliers | 6 |
| `customers.xlsx` | Customers | 40 |
| `orders.xlsx` | Orders, Order_Items | 300 / 637 |
| `purchase_orders.xlsx` | Purchase_Orders, PO_Items | 222 / 342 |
| `inventory.xlsx` | Inventory, Stock_Movements, Stock_By_Brand_Category | 198 / 1,160 / derived |

See `ER.md` for keys and relationships. Sample period: 2026-01-01 to 2026-11-09. The dashboard needs these sheets: Branches, Products, Suppliers, Orders, Order_Items, Purchase_Orders, PO_Items, Inventory, Stock_Movements. (Customers and Stock_By_Brand_Category are not read.) If a file, sheet or required column is missing, the page shows a clear error instead of numbers.

## 5. Definitions

| Term | Definition (per product, per branch, or summed) |
|---|---|
| **On the shelves** | `quantity_on_hand` — physically in the branch |
| **Ordered by customers** | `quantity_reserved` — units on orders still *Processing* |
| **Really available** | On the shelves − Ordered by customers. Example: 25 HP laptops on shelves, 3 ordered → 22 available |
| **Coming from suppliers** | `quantity_on_order` — units on open purchase orders |
| **Minimum level** | `min_stock_level` of that branch (sum of the branches when "All branches" is selected) |
| **Out of stock** | Really available = 0 |
| **Running low** | 0 < Really available ≤ minimum level |
| **Healthy** | Really available > minimum level |
| **Days left** | Really available ÷ average daily net units sold over the last 90 days (sales minus returns). Shown as "—" with no recent sales and "365+" when very high |
| **Late delivery** | Open purchase order whose expected date is before the "as of" date |

KPI "Out of stock" and "Running low" count **active** products only; discontinued items are shown in lists but never flagged for reorder. With "All branches" selected, the Out-of-stock card also says how many *branch gaps* exist (a product that is gone from one branch while others still have it).

## 6. Layout

1. **Header:** title, "Stock as of", data-checks badge (opens the list of checks), *Refresh data*, and the **bell icon** that opens the Insights panel. The bell shows the number of urgent + heads-up items.
2. **Filters:** Branch · Category · Brand · Stock status · Search by product name or SKU · Clear filters. Everything below responds to them.
3. **KPI cards:** On the shelves · Already ordered by customers · **Really available** (highlighted, with the subtraction written out) · Out of stock · Running low · Coming from suppliers (with late count). Out-of-stock and Running-low cards are clickable shortcuts to filter.
4. **Branch cards** (Tel Aviv, Jerusalem, Ariel): available, ordered, running-low and out-of-stock counts, last stock count date (flagged when overdue). Click a card to filter to that branch.
5. **Charts:** available vs ordered by branch; available units by category, split by branch.
6. **Stock by brand & category table:** columns *Products, On shelves, Ordered, Available, one column per branch, On order*, plus totals. Group by Brand + category / Category / Brand. Click a row to expand it into products. Example: `HP · Laptops — 33 on shelves, 3 ordered, 30 available (Tel Aviv 16, Jerusalem 8, Ariel 6)`.
7. **All products table:** sortable; per-branch availability with amber/red cells where a branch is low or out; days left; status badge; Download CSV of the current view.
8. **Deliveries on the way:** open purchase orders with supplier, branch, expected date, items, units and a Late / Due today / In N days badge.
9. **Product drawer** (click any product, table row or insight): totals, per-branch table (on shelves, ordered, available, minimum, on order, location in the branch), open deliveries, last 12 stock movements.

## 7. Insights (bell icon)

Notification-style list, grouped by importance, each clickable to open the product:

| Level | Insight | Rule |
|---|---|---|
| **Urgent** | Out of stock in all branches | Total available = 0, active product. Shows the next delivery date, or a suggested order size if none is open |
| **Urgent** | Out of stock in a branch | Branch available = 0 while other branches still have stock |
| **Heads-up** | Running low in a branch | 0 < available ≤ branch minimum; shows incoming delivery if any |
| **Heads-up** | May run out soon | Days left ≤ 14 at the recent sales pace |
| **Heads-up** | Late delivery | Open purchase order past its expected date |
| **Heads-up** | Stock count overdue | A branch's last count is more than 30 days old |
| **Good to know** | Suggested transfer | One branch is short with nothing on order while another has at least 2 units above double its minimum. Suggests moving a quantity |
| **Good to know** | Delivery arriving within 3 days | Open purchase order due soon |
| **Good to know** | Short shipment | A delivery in the last 30 days arrived with fewer units than ordered |
| **Good to know** | Mostly ordered | At least half of the shelf stock is promised to customers |
| **Good to know** | Slow mover | 6+ units available and no sales in 90 days |
| **Good to know** | Discontinued | Units remain; do not reorder |

Thresholds (30 days, 90 days, 14 days, 3 days) are constants at the top of `app.js`.

## 8. Behavior

- **Load:** fetch all files (no cache) → parse → validate → build insights → render. Errors show a red message naming the problem file.
- **Refresh keeps your filters.**
- **Empty states:** "No products match these filters". Zero is always shown as `0`.
- **Accessibility:** status is never color only (it also has a text badge); keyboard operable rows, buttons and panels; Esc closes panels.
- **Responsive:** works from tablet width and up; usable on a phone.

## 9. Data validation (every load)

| # | Check |
|---|---|
| 1 | IDs unique in every table (and SKUs) |
| 2 | Exactly one Inventory row per product and branch |
| 3 | Every foreign key points to an existing row |
| 4 | On the shelves = sum of Stock_Movements for that product and branch |
| 5 | Available = on shelves − ordered; nothing negative |
| 6 | Ordered by customers = units on Processing orders (per branch) |
| 7 | On order = units on open purchase orders (per branch) |
| 8 | Units received on purchase orders = "Purchase Received" movements |
| 9 | Stock never dropped below zero at any point in history |

The sample data passes all 9 checks.

## 10. Technology

Static page: `index.html` + `styles.css` + `app.js`, with **SheetJS** (reads `.xlsx`) and **Chart.js** (charts) bundled in `lib/` so it works offline. Browsers block reading local files from `file://`, so run it from a small local server:

```bash
npx serve .
```

then open the address it prints. To update the data, save the Excel files in `data/` and refresh the browser.

## 11. Out of scope

Revenue and price reporting, writing data back to Excel, logins and roles, barcode scanning, automatically emailing suppliers, forecasting beyond "days left".

## 12. Open questions

1. Are the minimum levels per branch right (currently a share of each product's reorder level: Tel Aviv 50%, Jerusalem 30%, Ariel 20%)? Should the inventory manager be able to set them per product and branch in Excel? (They already can: edit `min_stock_level`.)
2. Should transfers between branches be recorded as their own movement type (Transfer Out / Transfer In)?
3. Would an email or phone alert for urgent insights be useful, beyond the bell?
4. Will anyone need to see the dashboard away from the shop computer?
