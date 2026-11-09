# Inventory Dashboard — TechNest Computers

An inventory-only dashboard for a small computer store with three branches (Tel Aviv, Jerusalem, Ariel). It reads Excel files and shows what is on the shelves, what is already ordered by customers, what is *really* available, what is running low, what is arriving from suppliers, and where each item is.

## Run it

Browsers block reading local files directly, so start a tiny local server in this folder:

```bash
npx serve .
```

Then open the address it prints (usually http://localhost:3000). Edit the Excel files in `data/`, save, and refresh the page: the dashboard re-reads them every time.

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
| `lib/` | SheetJS (reads Excel) and Chart.js, bundled so it works offline |
| `data/` | Excel source data: branches, products, suppliers, customers, orders, purchase orders, inventory |
| `ER.md` | Entity-relationship diagram (Mermaid) with primary and foreign keys |
| `ER.drawio` | The same ERD for draw.io / diagrams.net |
| `SPEC.md` | Detailed dashboard design |
| `practice.md` | Project conventions (English, blue and light-gray palette, data rules) |

## Data

All data is **fictional** and was generated for this project. It covers 2026-01-01 to 2026-11-09: 66 products, 3 branches, 40 customers, 300 orders and 222 purchase orders.
