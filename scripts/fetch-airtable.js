// Fetches the Airtable tables and saves them to data/airtable.json.
// Runs on GitHub's servers (see the workflow). The token comes from a GitHub secret, never from a file.
const fs = require('fs');

const token = process.env.AIRTABLE_TOKEN;
const baseId = process.env.AIRTABLE_BASE_ID;
if (!token || !baseId) {
  console.error('Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID');
  process.exit(1);
}

// Same mapping as in app.js: dashboard sheet -> Airtable table and fields.
// { link, to } = a linked-record field; Airtable returns record ids, which we translate to the ID text (e.g. "P001").
const AT = {
  Branches:        { table:'Branches',        key:'Branch ID',   fields:{ branch_id:'Branch ID', branch_name:'Branch Name', city:'City' } },
  Suppliers:       { table:'Suppliers',       key:'Supplier ID', fields:{ supplier_id:'Supplier ID', supplier_name:'Supplier Name' } },
  Products:        { table:'Products',        key:'Product ID',  fields:{ product_id:'Product ID', sku:'SKU', product_name:'Product Name', brand:'Brand', category:'Category', reorder_level:'Reorder Level', reorder_quantity:'Reorder Quantity', supplier_id:{ link:'Supplier', to:'Suppliers' }, status:'Status' } },
  Orders:          { table:'Orders',          key:'Order ID',    fields:{ order_id:'Order ID', branch_id:{ link:'Branch', to:'Branches' }, order_date:'Order Date', status:'Status' } },
  Order_Items:     { table:'Order_Items',     fields:{ order_item_id:'order_item_id', order_id:'order_id', product_id:'product_id', quantity:'quantity', line_total:'line_total' } },
  Purchase_Orders: { table:'Purchase Orders', key:'PO ID',       fields:{ po_id:'PO ID', supplier_id:{ link:'Supplier', to:'Suppliers' }, branch_id:{ link:'Branch', to:'Branches' }, order_date:'Order Date', expected_date:'Expected Date', received_date:'Received Date', status:'Status' } },
  PO_Items:        { table:'PO_Items',        fields:{ po_item_id:'po_item_id', po_id:'po_id', product_id:'product_id', quantity_ordered:'quantity_ordered', quantity_received:'quantity_received' } },
  Inventory:       { table:'Inventory',       key:'Inventory ID', fields:{ inventory_id:'Inventory ID', product_id:{ link:'Product', to:'Products' }, branch_id:{ link:'Branch', to:'Branches' }, quantity_on_hand:'Quantity On Hand', quantity_reserved:'Quantity Reserved', quantity_available:'Quantity Available', quantity_on_order:'Quantity On Order', min_stock_level:'Min Stock Level', storage_location:'Storage Location', last_stock_count_date:'Last Stock Count Date', last_updated:'Last Updated' } },
  Stock_Movements: { table:'Stock_Movements', fields:{ movement_id:'movement_id', movement_date:'movement_date', product_id:'product_id', branch_id:'branch_id', movement_type:'movement_type', quantity:'quantity' } },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastRequestAt = 0;

// Airtable allows 5 requests per second per base: space requests out, retry on 429.
async function atFetch(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastRequestAt + 230 - Date.now();
    lastRequestAt = Math.max(Date.now(), lastRequestAt + 230);
    if (wait > 0) await sleep(wait);
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 429) { await sleep(1500); continue; }
    if (!r.ok) throw new Error(`Airtable error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  throw new Error('Airtable is rate-limiting requests.');
}

// All records of one table, 100 per page.
async function fetchTable(def) {
  const records = [];
  let offset = '';
  do {
    const names = Object.values(def.fields).map(f => typeof f === 'string' ? f : f.link);
    const qs = names.map(n => 'fields%5B%5D=' + encodeURIComponent(n)).join('&') + (offset ? '&offset=' + offset : '');
    const j = await atFetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(def.table)}?pageSize=100&${qs}`);
    records.push(...j.records);
    offset = j.offset || '';
  } while (offset);
  return records;
}

(async () => {
  const sheets = Object.keys(AT);
  const raw = {};
  for (const s of sheets) {
    raw[s] = await fetchTable(AT[s]);
    console.log(`${s}: ${raw[s].length} records`);
  }

  // record id -> ID text, for every table that others link to
  const idText = {};
  for (const s of sheets) if (AT[s].key) for (const rec of raw[s]) idText[rec.id] = rec.fields[AT[s].key];

  const db = {};
  for (const s of sheets) {
    db[s] = raw[s].map(rec => {
      const row = {};
      for (const [col, f] of Object.entries(AT[s].fields)) {
        if (typeof f === 'string') row[col] = rec.fields[f] ?? null;
        else { const ids = rec.fields[f.link] || []; row[col] = ids.length ? (idText[ids[0]] ?? null) : null; }
      }
      return row;
    }).filter(row => Object.values(row).some(v => v !== null));   // skip completely empty rows
  }

  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/airtable.json', JSON.stringify({ fetchedAt: new Date().toISOString(), db }));
  console.log('Saved data/airtable.json');
})().catch(e => { console.error(e.message); process.exit(1); });