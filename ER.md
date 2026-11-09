# Entity-Relationship Diagram — TechNest Computers Inventory

Sample business: a small computer store selling laptops, desktops, tablets / iPads, monitors, peripherals, storage, networking gear, printers, accessories and software licenses. All sample data is fictional.

## Diagram

```mermaid
erDiagram
    SUPPLIERS ||--o{ PRODUCTS : "supplies"
    SUPPLIERS ||--o{ PURCHASE_ORDERS : "receives"
    PURCHASE_ORDERS ||--|{ PO_ITEMS : "contains"
    PRODUCTS ||--o{ PO_ITEMS : "is restocked via"
    CUSTOMERS ||--o{ ORDERS : "places"
    ORDERS ||--|{ ORDER_ITEMS : "contains"
    PRODUCTS ||--o{ ORDER_ITEMS : "is sold in"
    PRODUCTS ||--|| INVENTORY : "has current stock"
    PRODUCTS ||--o{ STOCK_MOVEMENTS : "is tracked by"

    SUPPLIERS {
        string supplier_id PK
        string supplier_name
        string contact_person
        string email
        string phone
        string address
        string city
        string state
        string zip_code
        int avg_lead_time_days
    }
    PRODUCTS {
        string product_id PK
        string sku UK
        string product_name
        string brand
        string category
        decimal unit_cost
        decimal unit_price
        int reorder_level
        int reorder_quantity
        string supplier_id FK
        string status
        date date_added
    }
    CUSTOMERS {
        string customer_id PK
        string customer_name
        string contact_person
        string customer_type
        string email
        string phone
        string address
        string city
        string state
        string zip_code
        date customer_since
    }
    ORDERS {
        string order_id PK
        string customer_id FK
        date order_date
        string status
        string sales_channel
        string payment_method
        string sales_rep
        decimal order_total
    }
    ORDER_ITEMS {
        string order_item_id PK
        string order_id FK
        string product_id FK
        int quantity
        decimal unit_price
        decimal discount_pct
        decimal line_total
    }
    PURCHASE_ORDERS {
        string po_id PK
        string supplier_id FK
        date order_date
        date expected_date
        date received_date
        string status
        decimal po_total
    }
    PO_ITEMS {
        string po_item_id PK
        string po_id FK
        string product_id FK
        int quantity_ordered
        int quantity_received
        decimal unit_cost
        decimal line_total
    }
    INVENTORY {
        string inventory_id PK
        string product_id FK "UK - one row per product"
        int quantity_on_hand
        int quantity_reserved
        int quantity_available
        int quantity_on_order
        string storage_location
        date last_stock_count_date
        date last_updated
    }
    STOCK_MOVEMENTS {
        string movement_id PK
        date movement_date
        string product_id FK
        string movement_type
        int quantity
        string reference
        string notes
    }
```

## Keys

| Table (Excel file → sheet) | Primary key | Foreign keys | Alternate (unique) keys |
|---|---|---|---|
| SUPPLIERS (`suppliers.xlsx` → Suppliers) | `supplier_id` | — | — |
| PRODUCTS (`products.xlsx` → Products) | `product_id` | `supplier_id` → SUPPLIERS | `sku` |
| CUSTOMERS (`customers.xlsx` → Customers) | `customer_id` | — | `email` |
| ORDERS (`orders.xlsx` → Orders) | `order_id` | `customer_id` → CUSTOMERS | — |
| ORDER_ITEMS (`orders.xlsx` → Order_Items) | `order_item_id` | `order_id` → ORDERS, `product_id` → PRODUCTS | (`order_id`, `product_id`) |
| PURCHASE_ORDERS (`purchase_orders.xlsx` → Purchase_Orders) | `po_id` | `supplier_id` → SUPPLIERS | — |
| PO_ITEMS (`purchase_orders.xlsx` → PO_Items) | `po_item_id` | `po_id` → PURCHASE_ORDERS, `product_id` → PRODUCTS | — |
| INVENTORY (`inventory.xlsx` → Inventory) | `inventory_id` | `product_id` → PRODUCTS | `product_id` (1:1) |
| STOCK_MOVEMENTS (`inventory.xlsx` → Stock_Movements) | `movement_id` | `product_id` → PRODUCTS | — |

`inventory.xlsx` also holds a convenience sheet, **Stock_By_Brand_Category** (e.g. HP + Laptops = 24 units on hand). It is a derived snapshot, not a table in the model; the dashboard recomputes it live.

## Design notes

- **Inventory is one row per product (SKU), not per brand.** "HP computers: 12 left" is a roll-up, so the dashboard sums `quantity_on_hand` across the HP products to get it. This keeps each model's stock, reorder level and cost separate.
- **Stock identity (must always hold):** `quantity_on_hand` = sum of `Stock_Movements.quantity` for the product. `quantity_available` = `quantity_on_hand` − `quantity_reserved`.
- `quantity_reserved` = units on orders with status *Processing* (not yet shipped).
- `quantity_on_order` = units on purchase orders with status *Ordered* (not yet received).
- `order_items.unit_price` is the price at time of sale, so later price changes do not rewrite history.
- **Movement types:** Opening Balance, Purchase Received (+), Sale (−), Customer Return (+), Adjustment (±).
