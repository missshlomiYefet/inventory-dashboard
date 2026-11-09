/* Inventory Dashboard — reads the Excel files in /data on every load. Nothing is hard-coded. */
'use strict';

/* ---------- Config ---------- */
const SCHEMA = {
  'branches.xlsx':        { Branches: ['branch_id','branch_name','city'] },
  'products.xlsx':        { Products: ['product_id','sku','product_name','brand','category','reorder_level','reorder_quantity','supplier_id','status'] },
  'suppliers.xlsx':       { Suppliers: ['supplier_id','supplier_name'] },
  'orders.xlsx':          { Orders: ['order_id','branch_id','order_date','status'], Order_Items: ['order_item_id','order_id','product_id','quantity','line_total'] },
  'purchase_orders.xlsx': { Purchase_Orders: ['po_id','supplier_id','branch_id','order_date','expected_date','received_date','status'], PO_Items: ['po_item_id','po_id','product_id','quantity_ordered','quantity_received'] },
  'inventory.xlsx':       { Inventory: ['inventory_id','product_id','branch_id','quantity_on_hand','quantity_reserved','quantity_available','quantity_on_order','min_stock_level','storage_location','last_stock_count_date','last_updated'],
                            Stock_Movements: ['movement_id','movement_date','product_id','branch_id','movement_type','quantity'] },
};
const STOCK_COUNT_MAX_DAYS = 30;   // a branch stock count older than this raises an insight
const VELOCITY_DAYS = 90;          // sales window used for "days of stock left"
const DAYS_LEFT_WARN = 14;
const DUE_SOON_DAYS = 3;

/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DAY = 86400000;
const serialToDate = v => typeof v === 'number' ? new Date(Math.round((v - 25569) * DAY)) : (v ? new Date(v) : null);
const fmtD = d => d ? d.toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric', timeZone:'UTC'}) : '—';
const dayDiff = (a, b) => Math.round((a - b) / DAY);
const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const K = (pid, b) => pid + '|' + b;
const fmtDays = d => d === null ? '—' : (d > 365 ? '365+' : Math.max(1, Math.round(d)));

let M = null;          // model built from the Excel files
let charts = {};
const state = { branch:'ALL', category:'ALL', brand:'ALL', status:'ALL', q:'', group:'brandCat', sort:{key:'name', dir:1}, expanded:new Set(), insightSev:'all' };

/* ---------- Loading ---------- */
async function readBook(file) {
  const r = await fetch(`data/${file}?_=${Date.now()}`, { cache: 'no-store' });   // never use a cached copy
  if (!r.ok) throw new Error(`Cannot load data/${file} (HTTP ${r.status}). Is the file in the data folder?`);
  const wb = XLSX.read(await r.arrayBuffer(), { type: 'array' });
  return { wb, modified: r.headers.get('last-modified') };
}
async function loadAll() {
  const db = {}, mod = {};
  const names = Object.keys(SCHEMA);
  const books = await Promise.all(names.map(readBook));
  names.forEach((f, i) => {
    mod[f] = books[i].modified;
    for (const [sheet, cols] of Object.entries(SCHEMA[f])) {
      const ws = books[i].wb.Sheets[sheet];
      if (!ws) throw new Error(`data/${f}: sheet "${sheet}" is missing.`);
      const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
      const have = new Set(Object.keys(rows[0] || {}));
      const header = XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || [];
      header.forEach(h => have.add(h));
      const missing = cols.filter(c => !have.has(c));
      if (missing.length) throw new Error(`data/${f} › ${sheet}: missing column(s): ${missing.join(', ')}.`);
      db[sheet] = rows;
    }
  });
  return { db, mod };
}

/* ---------- Model ---------- */
function buildModel(db, mod) {
  const branches = db.Branches;
  const brById = Object.fromEntries(branches.map(b => [b.branch_id, b]));
  const prodById = Object.fromEntries(db.Products.map(p => [p.product_id, p]));
  const supById = Object.fromEntries(db.Suppliers.map(s => [s.supplier_id, s]));
  const rows = db.Inventory.map(r => ({
    ...r, p: prodById[r.product_id], b: brById[r.branch_id],
    last_stock_count_date: serialToDate(r.last_stock_count_date), last_updated: serialToDate(r.last_updated),
  }));
  const asOf = new Date(Math.max(...rows.map(r => r.last_updated ? +r.last_updated : 0)));
  const rowsByProd = {};  rows.forEach(r => (rowsByProd[r.product_id] ||= []).push(r));
  const rowByKey = Object.fromEntries(rows.map(r => [K(r.product_id, r.branch_id), r]));

  // Net units sold in the velocity window, per product+branch (sales minus returns)
  const movements = db.Stock_Movements.map(m => ({ ...m, movement_date: serialToDate(m.movement_date) }));
  const since = +asOf - VELOCITY_DAYS * DAY;
  const sold = {};
  movements.forEach(m => {
    if ((m.movement_type === 'Sale' || m.movement_type === 'Customer Return') && +m.movement_date > since)
      sold[K(m.product_id, m.branch_id)] = (sold[K(m.product_id, m.branch_id)] || 0) - m.quantity;
  });

  const pos = db.Purchase_Orders.map(p => ({ ...p, order_date: serialToDate(p.order_date), expected_date: serialToDate(p.expected_date), received_date: serialToDate(p.received_date) }));
  const poById = Object.fromEntries(pos.map(p => [p.po_id, p]));
  const poItems = db.PO_Items;
  const poItemsByPo = {}; poItems.forEach(i => (poItemsByPo[i.po_id] ||= []).push(i));
  const openPOs = pos.filter(p => p.status === 'Ordered');
  const orders = db.Orders.map(o => ({ ...o, order_date: serialToDate(o.order_date) }));

  return { db, mod, branches, brById, prodById, supById, rows, rowsByProd, rowByKey, asOf, movements, sold, pos, poById, poItems, poItemsByPo, openPOs, orders,
           categories: [...new Set(db.Products.map(p => p.category))].sort(), brands: [...new Set(db.Products.map(p => p.brand))].sort() };
}

/* ---------- Validation (runs on every load) ---------- */
function validate(m) {
  const out = [], add = (name, bad, detail) => out.push({ name, ok: bad.length === 0, detail: bad.length ? `${bad.length} problem(s), e.g. ${bad.slice(0, 3).join('; ')}` : detail });
  const db = m.db, set = (a, k) => new Set(a.map(x => x[k]));
  const dups = (a, k) => a.length - set(a, k).size;
  const pid = set(db.Products, 'product_id'), bid = set(db.Branches, 'branch_id'), sid = set(db.Suppliers, 'supplier_id'), oid = set(db.Orders, 'order_id'), poid = set(db.Purchase_Orders, 'po_id');

  add('Primary keys are unique', [['products', dups(db.Products, 'product_id')], ['SKUs', dups(db.Products, 'sku')], ['inventory', dups(db.Inventory, 'inventory_id')], ['orders', dups(db.Orders, 'order_id')], ['purchase orders', dups(db.Purchase_Orders, 'po_id')], ['movements', dups(db.Stock_Movements, 'movement_id')]].filter(x => x[1]).map(x => `${x[0]} has ${x[1]} duplicate(s)`), 'No duplicate IDs in any table');
  const pairs = new Set(db.Inventory.map(r => r.product_id + '|' + r.branch_id));
  add('One inventory row per product and branch', [...(pairs.size !== db.Inventory.length ? ['duplicate product+branch rows'] : []), ...(db.Inventory.length !== db.Products.length * db.Branches.length ? [`expected ${db.Products.length * db.Branches.length} rows, found ${db.Inventory.length}`] : [])], `${db.Inventory.length} rows = ${db.Products.length} products × ${db.Branches.length} branches`);

  const fk = [];
  db.Products.forEach(r => { if (!sid.has(r.supplier_id)) fk.push(`product ${r.product_id}→supplier ${r.supplier_id}`); });
  db.Inventory.forEach(r => { if (!pid.has(r.product_id) || !bid.has(r.branch_id)) fk.push(`inventory ${r.inventory_id}`); });
  db.Stock_Movements.forEach(r => { if (!pid.has(r.product_id) || !bid.has(r.branch_id)) fk.push(`movement ${r.movement_id}`); });
  db.Orders.forEach(r => { if (!bid.has(r.branch_id)) fk.push(`order ${r.order_id}→branch`); });
  db.Order_Items.forEach(r => { if (!oid.has(r.order_id) || !pid.has(r.product_id)) fk.push(`order item ${r.order_item_id}`); });
  db.Purchase_Orders.forEach(r => { if (!sid.has(r.supplier_id) || !bid.has(r.branch_id)) fk.push(`PO ${r.po_id}`); });
  db.PO_Items.forEach(r => { if (!poid.has(r.po_id) || !pid.has(r.product_id)) fk.push(`PO item ${r.po_item_id}`); });
  add('Every foreign key points to an existing row', fk, 'All links between tables are valid');

  const mv = {}; db.Stock_Movements.forEach(x => mv[K(x.product_id, x.branch_id)] = (mv[K(x.product_id, x.branch_id)] || 0) + x.quantity);
  add('On shelves = sum of stock movements', db.Inventory.filter(r => r.quantity_on_hand !== (mv[K(r.product_id, r.branch_id)] || 0)).map(r => `${r.product_id}@${r.branch_id}`), 'Every product/branch matches its movement history');
  add('Available = on shelves − ordered; never negative', db.Inventory.filter(r => r.quantity_available !== r.quantity_on_hand - r.quantity_reserved || r.quantity_on_hand < 0 || r.quantity_available < 0).map(r => `${r.product_id}@${r.branch_id}`), 'Arithmetic is consistent and no stock is below zero');

  const ordBr = Object.fromEntries(db.Orders.map(o => [o.order_id, o]));
  const res = {}; db.Order_Items.forEach(l => { const o = ordBr[l.order_id]; if (o && o.status === 'Processing') res[K(l.product_id, o.branch_id)] = (res[K(l.product_id, o.branch_id)] || 0) + l.quantity; });
  add('Ordered-by-customers = units on Processing orders', db.Inventory.filter(r => r.quantity_reserved !== (res[K(r.product_id, r.branch_id)] || 0)).map(r => `${r.product_id}@${r.branch_id}`), 'Matches the customer orders still being prepared');

  const oo = {}; m.poItems.forEach(l => { const p = m.poById[l.po_id]; if (p && p.status === 'Ordered') oo[K(l.product_id, p.branch_id)] = (oo[K(l.product_id, p.branch_id)] || 0) + l.quantity_ordered; });
  add('On order = units on open purchase orders', db.Inventory.filter(r => r.quantity_on_order !== (oo[K(r.product_id, r.branch_id)] || 0)).map(r => `${r.product_id}@${r.branch_id}`), 'Matches the open supplier orders');

  const recvPO = sum(m.poItems, l => l.quantity_received), recvMv = sum(db.Stock_Movements.filter(x => x.movement_type === 'Purchase Received'), x => x.quantity);
  add('Received units on POs = "Purchase Received" movements', recvPO === recvMv ? [] : [`POs say ${recvPO}, movements say ${recvMv}`], `${recvPO} units received, both sources agree`);

  const run = {}, neg = [];
  [...db.Stock_Movements].sort((a, b) => a.movement_date - b.movement_date).forEach(x => { const k = K(x.product_id, x.branch_id); run[k] = (run[k] || 0) + x.quantity; if (run[k] < 0) neg.push(k); });
  add('Stock was never negative at any point in history', neg, 'Running balance stays at zero or above');
  return out;
}

/* ---------- Aggregation ---------- */
const scopeBranches = () => state.branch === 'ALL' ? M.branches.map(b => b.branch_id) : [state.branch];
function aggRows(rows) {
  const a = { onHand: 0, reserved: 0, available: 0, onOrder: 0, min: 0, byBranch: {}, sold: 0 };
  rows.forEach(r => {
    a.onHand += r.quantity_on_hand; a.reserved += r.quantity_reserved; a.available += r.quantity_available; a.onOrder += r.quantity_on_order; a.min += r.min_stock_level;
    a.byBranch[r.branch_id] = r; a.sold += M.sold[K(r.product_id, r.branch_id)] || 0;
  });
  a.perDay = a.sold / VELOCITY_DAYS;
  a.days = a.available > 0 && a.perDay > 0 ? a.available / a.perDay : null;
  a.status = a.available <= 0 ? 'OUT' : (a.available <= a.min ? 'LOW' : 'OK');
  return a;
}
const rowStatus = r => r.quantity_available <= 0 ? 'OUT' : (r.quantity_available <= r.min_stock_level ? 'LOW' : 'OK');

function filteredProducts() {
  const br = scopeBranches(), q = state.q.trim().toLowerCase();
  return M.db.Products.filter(p =>
    (state.category === 'ALL' || p.category === state.category) &&
    (state.brand === 'ALL' || p.brand === state.brand) &&
    (!q || p.product_name.toLowerCase().includes(q) || String(p.sku).toLowerCase().includes(q))
  ).map(p => {
    const rows = M.rowsByProd[p.product_id].filter(r => br.includes(r.branch_id));
    return { p, rows, a: aggRows(rows) };
  }).filter(x => {
    const s = state.status;
    if (s === 'ALL') return true;
    if (s === 'OUT') return x.a.status === 'OUT';
    if (s === 'LOW') return x.a.status === 'LOW';
    if (s === 'ATTN') return x.a.status !== 'OK';
    if (s === 'OK') return x.a.status === 'OK';
    if (s === 'DISC') return x.p.status === 'Discontinued';
    return true;
  });
}

/* ---------- Insights ---------- */
function buildInsights() {
  const list = [], bn = id => M.brById[id].branch_name, asOf = M.asOf;
  const push = (sev, title, text, pid) => list.push({ sev, title, text, pid });
  const nextPO = (pid, b) => M.openPOs.filter(p => p.branch_id === b && (M.poItemsByPo[p.po_id] || []).some(i => i.product_id === pid)).sort((a, b2) => a.expected_date - b2.expected_date)[0];

  M.db.Products.forEach(p => {
    const rows = M.rowsByProd[p.product_id], tot = aggRows(rows);
    const active = p.status === 'Active';
    if (tot.available <= 0) {
      if (!active) { push('info', `${p.product_name} is sold out`, 'Discontinued — no reorder needed.', p.product_id); }
      else {
        const inc = M.openPOs.filter(po => (M.poItemsByPo[po.po_id] || []).some(i => i.product_id === p.product_id)).sort((a, b) => a.expected_date - b.expected_date)[0];
        push('critical', `${p.product_name} is out of stock in all branches`, inc ? `Delivery expected ${fmtD(inc.expected_date)} (${inc.po_id}, ${bn(inc.branch_id)}).` : `No purchase order is open — suggested order: ${p.reorder_quantity} units.`, p.product_id);
      }
      return;
    }
    rows.forEach(r => {
      const st = rowStatus(r), po = nextPO(p.product_id, r.branch_id);
      if (!active) return;
      if (st === 'OUT') push('critical', `${p.product_name} is out of stock in ${bn(r.branch_id)}`, `${tot.available} still available in other branches. ` + (po ? `Delivery expected ${fmtD(po.expected_date)} (${po.po_id}).` : 'No purchase order is open.'), p.product_id);
      else if (st === 'LOW') push('warning', `${p.product_name} is running low in ${bn(r.branch_id)}`, `${plural(r.quantity_available, 'unit')} available (minimum ${r.min_stock_level}). ` + (po ? `Delivery expected ${fmtD(po.expected_date)} (${po.po_id}).` : 'No purchase order is open.'), p.product_id);
    });
    // Transfer suggestions: a branch is short while another has a comfortable surplus
    if (active) rows.forEach(a => {
      if (rowStatus(a) === 'OK' || a.quantity_on_order > 0) return;
      const donor = rows.filter(b => b.branch_id !== a.branch_id).map(b => ({ b, surplus: b.quantity_available - 2 * b.min_stock_level })).filter(x => x.surplus >= 2).sort((x, y) => y.surplus - x.surplus)[0];
      if (donor) { const qty = Math.min(donor.surplus, Math.max(1, 2 * a.min_stock_level - a.quantity_available)); push('info', `Move ${plural(qty, 'unit')} of ${p.product_name} to ${bn(a.branch_id)}`, `${bn(donor.b.branch_id)} has ${donor.b.quantity_available} available (minimum ${donor.b.min_stock_level}) and ${bn(a.branch_id)} has ${a.quantity_available} with nothing on order.`, p.product_id); }
    });
    // Running out soon at current sales pace
    if (active && tot.status === 'OK' && tot.days !== null && tot.days <= DAYS_LEFT_WARN)
      push('warning', `${p.product_name} may run out in about ${Math.max(1, Math.round(tot.days))} days`, `At the recent pace (${(tot.perDay * 7).toFixed(1)} per week) the ${tot.available} available units will not last.`, p.product_id);
    // Mostly promised to customers
    if (tot.onHand >= 4 && tot.reserved / tot.onHand >= 0.5)
      push('info', `Most ${p.product_name} stock is already ordered`, `${tot.reserved} of ${tot.onHand} units on shelves are promised to customers.`, p.product_id);
    // Slow movers
    if (tot.available >= 6 && tot.sold === 0 && active)
      push('info', `${p.product_name} has not sold in ${VELOCITY_DAYS} days`, `${tot.available} units are sitting in stock — avoid reordering.`, p.product_id);
    if (!active && tot.available > 0)
      push('info', `${p.product_name} is discontinued`, `${plural(tot.available, 'unit')} left to sell. Do not reorder.`, p.product_id);
  });

  M.openPOs.forEach(po => {
    const units = sum(M.poItemsByPo[po.po_id] || [], i => i.quantity_ordered), first = (M.poItemsByPo[po.po_id] || [])[0];
    const diff = dayDiff(po.expected_date, asOf);
    if (diff < 0) push('warning', `Delivery ${po.po_id} is ${plural(-diff, 'day')} late`, `${M.supById[po.supplier_id].supplier_name} → ${bn(po.branch_id)}, ${plural(units, 'unit')} were expected ${fmtD(po.expected_date)}.`, first && first.product_id);
    else if (diff <= DUE_SOON_DAYS) push('info', `Delivery ${po.po_id} arrives ${diff === 0 ? 'today' : 'in ' + plural(diff, 'day')}`, `${M.supById[po.supplier_id].supplier_name} → ${bn(po.branch_id)}, ${plural(units, 'unit')}.`, first && first.product_id);
  });

  // Short shipments in the last 30 days
  M.pos.filter(po => po.status === 'Received' && po.received_date && dayDiff(asOf, po.received_date) <= 30).forEach(po => {
    (M.poItemsByPo[po.po_id] || []).filter(i => i.quantity_received < i.quantity_ordered).forEach(i =>
      push('info', `Short shipment on ${po.po_id}`, `${M.prodById[i.product_id].product_name}: ordered ${i.quantity_ordered}, received ${i.quantity_received} (${bn(po.branch_id)}).`, i.product_id));
  });

  // Overdue stock counts
  M.branches.forEach(b => {
    const d = M.rows.find(r => r.branch_id === b.branch_id).last_stock_count_date, age = dayDiff(asOf, d);
    if (age > STOCK_COUNT_MAX_DAYS) push('warning', `${b.branch_name} stock count is overdue`, `Last count was ${fmtD(d)} (${age} days ago). Counts should be at most ${STOCK_COUNT_MAX_DAYS} days apart.`, null);
  });

  const order = { critical: 0, warning: 1, info: 2 };
  return list.sort((a, b) => order[a.sev] - order[b.sev]);
}

/* ---------- Rendering ---------- */
const statusBadge = s => ({ OUT: '<span class="badge out">Out of stock</span>', LOW: '<span class="badge low">Running low</span>', OK: '<span class="badge ok">Healthy</span>' }[s]);
const cellCls = s => s === 'OUT' ? 'cell-out' : s === 'LOW' ? 'cell-low' : '';

function renderFilters() {
  const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(t)}</option>`;
  $('#fBranch').innerHTML = opt('ALL', 'All branches', state.branch === 'ALL') + M.branches.map(b => opt(b.branch_id, b.branch_name, state.branch === b.branch_id)).join('');
  $('#fCategory').innerHTML = opt('ALL', 'All categories', state.category === 'ALL') + M.categories.map(c => opt(c, c, state.category === c)).join('');
  $('#fBrand').innerHTML = opt('ALL', 'All brands', state.brand === 'ALL') + M.brands.map(c => opt(c, c, state.brand === c)).join('');
  $('#fStatus').value = state.status; if ($('#fSearch').value !== state.q) $('#fSearch').value = state.q;
}

function renderKpis(items) {
  const t = aggRows(items.flatMap(x => x.rows));
  const out = items.filter(x => x.a.status === 'OUT' && x.p.status === 'Active').length;
  const low = items.filter(x => x.a.status === 'LOW' && x.p.status === 'Active').length;
  const gaps = state.branch === 'ALL' ? items.filter(x => x.a.status !== 'OUT' && x.p.status === 'Active').reduce((n, x) => n + x.rows.filter(r => rowStatus(r) === 'OUT').length, 0) : 0;
  const openPOs = M.openPOs.filter(p => (state.branch === 'ALL' || p.branch_id === state.branch));
  const late = openPOs.filter(p => p.expected_date < M.asOf).length;
  $('#kpis').innerHTML = `
    <div class="kpi"><div class="lab">On the shelves</div><div class="num">${t.onHand}</div><div class="note">units physically in the store</div></div>
    <div class="kpi"><div class="lab">Already ordered by customers</div><div class="num">${t.reserved}</div><div class="note">waiting to be picked up / shipped</div></div>
    <div class="kpi hl"><div class="lab">Really available</div><div class="num">${t.available}</div><div class="note">${t.onHand} on shelves − ${t.reserved} ordered</div></div>
    <button class="kpi click out" data-status="OUT"><div class="lab">Out of stock</div><div class="num">${out}</div><div class="note">${plural(out, 'product')}${gaps ? ` · plus ${plural(gaps, 'branch gap')}` : ''}</div></button>
    <button class="kpi click low" data-status="LOW"><div class="lab">Running low</div><div class="num">${low}</div><div class="note">${plural(low, 'product')} at or below minimum</div></button>
    <div class="kpi"><div class="lab">Coming from suppliers</div><div class="num">${t.onOrder}</div><div class="note">${plural(openPOs.length, 'open order')}${late ? ` · <b style="color:var(--red)">${late} late</b>` : ''}</div></div>`;
  $$('#kpis .kpi.click').forEach(b => b.onclick = () => { state.status = state.status === b.dataset.status ? 'ALL' : b.dataset.status; renderAll(); });
}

function renderBranchCards() {
  // Respect category/brand/search filters but not the branch filter, so the cards can switch branches.
  const q = state.q.trim().toLowerCase();
  const prods = M.db.Products.filter(p => (state.category === 'ALL' || p.category === state.category) && (state.brand === 'ALL' || p.brand === state.brand) && (!q || p.product_name.toLowerCase().includes(q) || String(p.sku).toLowerCase().includes(q))).map(p => p.product_id);
  $('#branchCards').innerHTML = M.branches.map(b => {
    const rows = M.rows.filter(r => r.branch_id === b.branch_id && prods.includes(r.product_id) && r.p.status === 'Active');
    const a = aggRows(M.rows.filter(r => r.branch_id === b.branch_id && prods.includes(r.product_id)));
    const out = rows.filter(r => rowStatus(r) === 'OUT').length, low = rows.filter(r => rowStatus(r) === 'LOW').length;
    const cnt = rows[0] ? rows[0].last_stock_count_date : null, age = cnt ? dayDiff(M.asOf, cnt) : null;
    return `<button class="bcard${state.branch === b.branch_id ? ' sel' : ''}" data-b="${esc(b.branch_id)}" aria-pressed="${state.branch === b.branch_id}">
      <h3>${esc(b.branch_name)}<span class="eq">${esc(b.address)}</span></h3>
      <div class="row"><div class="m"><b>${a.available}</b><span>available</span></div><div class="m"><b>${a.reserved}</b><span>ordered</span></div><div class="m l"><b>${low}</b><span>running low</span></div><div class="m o"><b>${out}</b><span>out of stock</span></div></div>
      <div class="cnt">Last stock count: ${fmtD(cnt)}${age > STOCK_COUNT_MAX_DAYS ? ` · <b style="color:var(--amber)">overdue (${age} days)</b>` : ''}</div></button>`;
  }).join('');
  $$('#branchCards .bcard').forEach(c => c.onclick = () => { state.branch = state.branch === c.dataset.b ? 'ALL' : c.dataset.b; renderAll(); });
}

function mkChart(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart($('#' + id), cfg); }
function renderCharts(items) {
  const BC = ['#1F4E79', '#4A90D9', '#9DC3E6'];
  const prodIds = new Set(M.db.Products.filter(p => (state.category === 'ALL' || p.category === state.category) && (state.brand === 'ALL' || p.brand === state.brand)).map(p => p.product_id));
  const per = M.branches.map(b => aggRows(M.rows.filter(r => r.branch_id === b.branch_id && prodIds.has(r.product_id))));
  const common = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#5B6675' } } },
    scales: { x: { stacked: true, grid: { display: false }, ticks: { color: '#5B6675' } }, y: { stacked: true, grid: { color: '#D9DEE5' }, ticks: { color: '#5B6675', precision: 0 }, beginAtZero: true } } };
  mkChart('chBranch', { type: 'bar', data: { labels: M.branches.map(b => b.branch_name), datasets: [
    { label: 'Available', data: per.map(a => a.available), backgroundColor: '#2E75B6' },
    { label: 'Ordered by customers', data: per.map(a => a.reserved), backgroundColor: '#9DC3E6' }] }, options: common });
  const cats = M.categories, br = scopeBranches();
  const inScope = M.rows.filter(r => br.includes(r.branch_id) && (state.brand === 'ALL' || r.p.brand === state.brand));
  mkChart('chCategory', { type: 'bar', data: { labels: cats, datasets: M.branches.filter(b => br.includes(b.branch_id)).map((b, i) => ({ label: b.branch_name, backgroundColor: BC[M.branches.indexOf(b) % 3],
    data: cats.map(c => sum(inScope.filter(r => r.branch_id === b.branch_id && r.p.category === c), r => r.quantity_available)) })) },
    options: { ...common, indexAxis: 'y', scales: { x: { ...common.scales.y, stacked: true }, y: { ...common.scales.x, stacked: true } } } });
}

function branchCols() { return M.branches.filter(b => scopeBranches().includes(b.branch_id)); }
function groupKey(p) { return state.group === 'category' ? p.category : state.group === 'brand' ? p.brand : `${p.brand} · ${p.category}`; }
function renderGroups(items) {
  const g = {}; items.forEach(x => (g[groupKey(x.p)] ||= []).push(x));
  const cols = branchCols();
  const head = `<thead><tr><th>${state.group === 'brandCat' ? 'Brand · category' : state.group === 'category' ? 'Category' : 'Brand'}</th><th class="n">Products</th><th class="n">On shelves</th><th class="n">Ordered</th><th class="n">Available</th>${cols.map(b => `<th class="n">${esc(b.branch_name)}</th>`).join('')}<th class="n">On order</th></tr></thead>`;
  const maxAvail = Math.max(1, ...Object.values(g).map(arr => sum(arr, x => x.a.available)));
  const brCell = (rows, id) => { const r = rows.filter(r => r.branch_id === id); const v = sum(r, x => x.quantity_available); return `<td class="n">${v}</td>`; };
  const body = Object.keys(g).sort().map(k => {
    const arr = g[k], rows = arr.flatMap(x => x.rows), a = aggRows(rows), open = state.expanded.has(k);
    let html = `<tr class="clickrow" data-g="${esc(k)}" tabindex="0" aria-expanded="${open}"><td><span class="caret">${open ? '▾' : '▸'}</span><b>${esc(k)}</b></td><td class="n">${arr.length}</td><td class="n">${a.onHand}</td><td class="n">${a.reserved}</td><td class="n"><b>${a.available}</b><span class="bar" style="width:${Math.round(a.available / maxAvail * 70)}px"></span></td>${cols.map(b => brCell(rows, b.branch_id)).join('')}<td class="n">${a.onOrder}</td></tr>`;
    if (open) html += arr.sort((x, y) => x.p.product_name.localeCompare(y.p.product_name)).map(x => `<tr class="child clickrow" data-pid="${esc(x.p.product_id)}" tabindex="0"><td>${esc(x.p.product_name)} ${x.p.status === 'Discontinued' ? '<span class="badge gray">Discontinued</span>' : ''}</td><td class="n">1</td><td class="n">${x.a.onHand}</td><td class="n">${x.a.reserved}</td><td class="n">${x.a.available}</td>${cols.map(b => { const r = x.a.byBranch[b.branch_id]; return `<td class="n ${r ? cellCls(rowStatus(r)) : ''}">${r ? r.quantity_available : '—'}</td>`; }).join('')}<td class="n">${x.a.onOrder}</td></tr>`).join('');
    return html;
  }).join('') || `<tr><td colspan="${6 + cols.length}" class="empty">No products match these filters.</td></tr>`;
  const t = aggRows(items.flatMap(x => x.rows));
  const foot = items.length ? `<tfoot><tr><td><b>Total</b></td><td class="n"><b>${items.length}</b></td><td class="n"><b>${t.onHand}</b></td><td class="n"><b>${t.reserved}</b></td><td class="n"><b>${t.available}</b></td>${cols.map(b => `<td class="n"><b>${sum(items.flatMap(x => x.rows).filter(r => r.branch_id === b.branch_id), r => r.quantity_available)}</b></td>`).join('')}<td class="n"><b>${t.onOrder}</b></td></tr></tfoot>` : '';
  $('#tblGroups').innerHTML = head + `<tbody>${body}</tbody>` + foot;
  $$('#tblGroups tr[data-g]').forEach(tr => { const f = () => { const k = tr.dataset.g; state.expanded.has(k) ? state.expanded.delete(k) : state.expanded.add(k); renderGroups(filteredProducts()); }; tr.onclick = f; tr.onkeydown = e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), f()); });
  bindProductRows('#tblGroups tr[data-pid]');
}

const SORTERS = {
  name: x => x.p.product_name.toLowerCase(), brand: x => x.p.brand, category: x => x.p.category,
  onHand: x => x.a.onHand, reserved: x => x.a.reserved, available: x => x.a.available, onOrder: x => x.a.onOrder,
  days: x => x.a.days ?? 1e9, status: x => ({ OUT: 0, LOW: 1, OK: 2 }[x.a.status]),
};
function renderProducts(items) {
  const s = state.sort, f = SORTERS[s.key];
  const sorted = [...items].sort((a, b) => { const x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : a.p.product_name.localeCompare(b.p.product_name)) * s.dir; });
  const cols = branchCols();
  const th = (k, t, n) => `<th class="sortable${n ? ' n' : ''}" data-sort="${k}" aria-sort="${s.key === k ? (s.dir > 0 ? 'ascending' : 'descending') : 'none'}">${t}${s.key === k ? (s.dir > 0 ? ' ▴' : ' ▾') : ''}</th>`;
  const head = `<thead><tr>${th('name', 'Product')}${th('brand', 'Brand')}${th('category', 'Category')}${th('onHand', 'On shelves', 1)}${th('reserved', 'Ordered', 1)}${th('available', 'Available', 1)}${cols.map(b => `<th class="n">${esc(b.branch_name)}</th>`).join('')}${th('onOrder', 'On order', 1)}${th('days', 'Days left*', 1)}${th('status', 'Status')}</tr></thead>`;
  const body = sorted.map(x => `<tr class="clickrow" data-pid="${esc(x.p.product_id)}" tabindex="0"><td><b>${esc(x.p.product_name)}</b><div class="eq">${esc(x.p.sku)}${x.p.status === 'Discontinued' ? ' · Discontinued' : ''}</div></td><td>${esc(x.p.brand)}</td><td>${esc(x.p.category)}</td><td class="n">${x.a.onHand}</td><td class="n">${x.a.reserved}</td><td class="n"><b>${x.a.available}</b></td>${cols.map(b => { const r = x.a.byBranch[b.branch_id]; return `<td class="n ${r ? cellCls(rowStatus(r)) : ''}">${r ? r.quantity_available : '—'}</td>`; }).join('')}<td class="n">${x.a.onOrder}</td><td class="n">${fmtDays(x.a.days)}</td><td>${statusBadge(x.a.status)}</td></tr>`).join('')
    || `<tr><td colspan="${9 + cols.length}" class="empty">No products match these filters. Try “Clear filters”.</td></tr>`;
  $('#tblProducts').innerHTML = head + `<tbody>${body}</tbody>`;
  $('#prodCount').textContent = `${items.length} of ${M.db.Products.length} products · *days left = available ÷ average daily sales over ${VELOCITY_DAYS} days`;
  $$('#tblProducts th[data-sort]').forEach(h => h.onclick = () => { const k = h.dataset.sort; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : 1 }; renderProducts(filteredProducts()); });
  bindProductRows('#tblProducts tr[data-pid]');
}
function bindProductRows(sel) { $$(sel).forEach(tr => { const f = e => { e.stopPropagation(); openDrawer(tr.dataset.pid); }; tr.onclick = f; tr.onkeydown = e => (e.key === 'Enter') && f(e); }); }

function renderPO() {
  const rows = M.openPOs.filter(p => state.branch === 'ALL' || p.branch_id === state.branch).sort((a, b) => a.expected_date - b.expected_date);
  const head = '<thead><tr><th>Order</th><th>Supplier</th><th>Delivering to</th><th>Ordered</th><th>Expected</th><th>Items</th><th class="n">Units</th><th>Status</th></tr></thead>';
  const body = rows.map(p => {
    const items = M.poItemsByPo[p.po_id] || [], diff = dayDiff(p.expected_date, M.asOf);
    const names = items.map(i => M.prodById[i.product_id].product_name);
    const st = diff < 0 ? `<span class="badge out">${plural(-diff, 'day')} late</span>` : diff === 0 ? '<span class="badge low">Due today</span>' : `<span class="badge ok">In ${plural(diff, 'day')}</span>`;
    return `<tr class="clickrow" data-pid="${esc(items[0] && items[0].product_id)}" tabindex="0"><td><b>${esc(p.po_id)}</b></td><td>${esc(M.supById[p.supplier_id].supplier_name)}</td><td>${esc(M.brById[p.branch_id].branch_name)}</td><td>${fmtD(p.order_date)}</td><td>${fmtD(p.expected_date)}</td><td>${esc(names.slice(0, 2).join(', '))}${names.length > 2 ? ` +${names.length - 2} more` : ''}</td><td class="n">${sum(items, i => i.quantity_ordered)}</td><td>${st}</td></tr>`;
  }).join('') || '<tr><td colspan="8" class="empty">No open purchase orders.</td></tr>';
  $('#tblPO').innerHTML = head + `<tbody>${body}</tbody>`;
  bindProductRows('#tblPO tr[data-pid]');
}

/* ---------- Panels ---------- */
function renderInsights() {
  const all = M.insights, cnt = s => all.filter(i => i.sev === s).length;
  const attn = cnt('critical') + cnt('warning');
  const bc = $('#bellCount'); bc.textContent = attn > 99 ? '99+' : attn; bc.hidden = attn === 0;
  $('#btnBell').setAttribute('aria-label', `Open insights, ${attn} need attention`);
  const chip = (k, t) => `<button class="chip${state.insightSev === k ? ' on' : ''}" data-sev="${k}">${t}</button>`;
  $('#insightChips').innerHTML = chip('all', `All (${all.length})`) + chip('critical', `Urgent (${cnt('critical')})`) + chip('warning', `Heads-up (${cnt('warning')})`) + chip('info', `Good to know (${cnt('info')})`);
  const label = { critical: 'Urgent', warning: 'Heads-up', info: 'Good to know' };
  const shown = all.filter(i => state.insightSev === 'all' || i.sev === state.insightSev);
  $('#insightList').innerHTML = shown.map((i, n) => `<button class="ins ${i.sev}" data-n="${all.indexOf(i)}"><div><div class="ic">${label[i.sev]}</div><div class="t">${esc(i.title)}</div><div class="d">${esc(i.text)}</div></div></button>`).join('') || '<div class="empty">Nothing needs your attention. 🎉</div>';
  $$('#insightChips .chip').forEach(c => c.onclick = () => { state.insightSev = c.dataset.sev; renderInsights(); });
  $$('#insightList .ins').forEach(b => b.onclick = () => { const i = all[+b.dataset.n]; if (i.pid) { closePanels(); openDrawer(i.pid); } });
}
function renderValidation() {
  const bad = M.checks.filter(c => !c.ok).length;
  $('#valBadge').innerHTML = bad ? `<span class="fail">✖ ${bad} data issue${bad > 1 ? 's' : ''}</span>` : '<span class="pass">✔ Data checks passed</span>';
  $('#valList').innerHTML = `<p class="kv">Run automatically every time the data loads. ${M.checks.length - bad} of ${M.checks.length} passed.</p>` +
    M.checks.map(c => `<div class="chk"><span class="mk ${c.ok ? 'pass' : 'fail'}">${c.ok ? '✔' : '✖'}</span><div><b>${esc(c.name)}</b><div class="kv">${esc(c.detail)}</div></div></div>`).join('') +
    `<h3>Files read</h3>` + Object.keys(M.mod).map(f => `<div class="kv">${esc(f)} — saved ${M.mod[f] ? esc(new Date(M.mod[f]).toLocaleString('en-GB')) : 'unknown'}</div>`).join('');
}
function openDrawer(pid) {
  const p = M.prodById[pid]; if (!p) return;
  const rows = M.rowsByProd[pid], a = aggRows(rows), sup = M.supById[p.supplier_id];
  const pos = M.openPOs.filter(po => (M.poItemsByPo[po.po_id] || []).some(i => i.product_id === pid));
  const mv = M.movements.filter(m => m.product_id === pid).sort((x, y) => y.movement_date - x.movement_date || y.movement_id.localeCompare(x.movement_id)).slice(0, 12);
  $('#drawerTitle').textContent = p.product_name;
  $('#drawerBody').innerHTML = `
    <div class="kv">${esc(p.sku)} · ${esc(p.brand)} · ${esc(p.category)} · Supplier: ${esc(sup.supplier_name)}${p.status === 'Discontinued' ? ' · <b>Discontinued</b>' : ''}</div>
    <div class="dgrid"><div><b>${a.onHand}</b><span>on shelves</span></div><div><b>${a.reserved}</b><span>ordered by customers</span></div><div><b>${a.available}</b><span>really available</span></div></div>
    <div>${statusBadge(a.status)} <span class="kv">${a.days === null ? 'No recent sales, so days left cannot be estimated.' : `About ${fmtDays(a.days)} days of stock at the recent sales pace.`}</span></div>
    <h3>By branch</h3>
    <table><thead><tr><th>Branch</th><th class="n">On shelves</th><th class="n">Ordered</th><th class="n">Available</th><th class="n">Minimum</th><th class="n">On order</th><th>Location</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.b.branch_name)}</td><td class="n">${r.quantity_on_hand}</td><td class="n">${r.quantity_reserved}</td><td class="n ${cellCls(rowStatus(r))}">${r.quantity_available}</td><td class="n">${r.min_stock_level}</td><td class="n">${r.quantity_on_order}</td><td>${esc(r.storage_location)}</td></tr>`).join('')}</tbody></table>
    <h3>Deliveries on the way</h3>
    ${pos.length ? `<table><tbody>${pos.map(po => `<tr><td><b>${esc(po.po_id)}</b></td><td>${esc(M.brById[po.branch_id].branch_name)}</td><td class="n">${sum((M.poItemsByPo[po.po_id] || []).filter(i => i.product_id === pid), i => i.quantity_ordered)} units</td><td>expected ${fmtD(po.expected_date)}</td></tr>`).join('')}</tbody></table>` : '<div class="kv">None. Suggested order size if needed: ' + p.reorder_quantity + ' units.</div>'}
    <h3>Recent stock movements</h3>
    <table><thead><tr><th>Date</th><th>Branch</th><th>Type</th><th class="n">Qty</th><th>Ref.</th></tr></thead><tbody>
    ${mv.map(m => `<tr><td>${fmtD(m.movement_date)}</td><td>${esc(M.brById[m.branch_id].branch_name)}</td><td>${esc(m.movement_type)}</td><td class="n">${m.quantity > 0 ? '+' : ''}${m.quantity}</td><td>${esc(m.reference)}</td></tr>`).join('')}</tbody></table>`;
  showPanel('drawer');
}
function showPanel(id) { closePanels(); $('#' + id).hidden = false; $('#scrim').hidden = false; $('#btnBell').setAttribute('aria-expanded', id === 'insightPanel'); }
function closePanels() { $$('.panel').forEach(p => p.hidden = true); $('#scrim').hidden = true; $('#btnBell').setAttribute('aria-expanded', 'false'); }

/* ---------- Orchestration ---------- */
function renderAll() {
  renderFilters();
  const items = filteredProducts();
  renderKpis(items); renderBranchCards(); renderCharts(items); renderGroups(items); renderProducts(items); renderPO();
  $$('.seg button').forEach(b => b.classList.toggle('on', b.dataset.group === state.group));
  $('#groupTitle').textContent = { brandCat: 'brand & category', category: 'category', brand: 'brand' }[state.group];
}
function csv() {
  const cols = branchCols(), items = filteredProducts();
  const head = ['Product', 'SKU', 'Brand', 'Category', 'On shelves', 'Ordered', 'Available', ...cols.map(b => 'Available ' + b.branch_name), 'On order', 'Status'];
  const lines = items.map(x => [x.p.product_name, x.p.sku, x.p.brand, x.p.category, x.a.onHand, x.a.reserved, x.a.available, ...cols.map(b => x.a.byBranch[b.branch_id] ? x.a.byBranch[b.branch_id].quantity_available : ''), x.a.onOrder, { OUT: 'Out of stock', LOW: 'Running low', OK: 'Healthy' }[x.a.status]]);
  const text = [head, ...lines].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })); a.download = 'inventory.csv'; a.click();
}

async function refresh() {
  $('#asof').textContent = 'Loading data…'; $('#btnRefresh').disabled = true;
  try {
    const { db, mod } = await loadAll();
    M = buildModel(db, mod);
    M.checks = validate(M);
    M.insights = buildInsights();
    $('#errorBox').hidden = true; $('#app').hidden = false;
    $('#asof').innerHTML = `Stock as of <b>${fmtD(M.asOf)}</b><br>Loaded ${new Date().toLocaleTimeString('en-GB')}`;
    renderValidation(); renderInsights(); renderAll();
    $('#foot').textContent = `${M.db.Products.length} products · ${M.branches.length} branches · ${M.db.Inventory.length} stock lines · ${M.db.Stock_Movements.length} stock movements. Data is re-read from the Excel files on every refresh.`;
  } catch (e) {
    console.error(e);
    $('#app').hidden = true; $('#errorBox').hidden = false;
    $('#errorBox').innerHTML = `<b>The dashboard could not load the data.</b><br>${esc(e.message)}<br><br>Make sure all Excel files are in the <code>data</code> folder and the page is opened through a local server (for example <code>npx serve .</code>), not by double-clicking the file.`;
    $('#asof').textContent = 'Load failed';
  } finally { $('#btnRefresh').disabled = false; }
}

/* ---------- Events ---------- */
$('#fBranch').onchange = e => { state.branch = e.target.value; renderAll(); };
$('#fCategory').onchange = e => { state.category = e.target.value; renderAll(); };
$('#fBrand').onchange = e => { state.brand = e.target.value; renderAll(); };
$('#fStatus').onchange = e => { state.status = e.target.value; renderAll(); };
$('#fSearch').oninput = e => { state.q = e.target.value; renderAll(); };
$('#btnClear').onclick = () => { Object.assign(state, { branch: 'ALL', category: 'ALL', brand: 'ALL', status: 'ALL', q: '' }); renderAll(); };
$('#btnRefresh').onclick = refresh;
$('#btnCsv').onclick = csv;
$('#btnBell').onclick = () => $('#insightPanel').hidden ? showPanel('insightPanel') : closePanels();
$('#btnValidation').onclick = () => showPanel('valPanel');
$('#scrim').onclick = closePanels;
$$('[data-close]').forEach(b => b.onclick = closePanels);
document.addEventListener('keydown', e => e.key === 'Escape' && closePanels());
$$('.seg button').forEach(b => b.onclick = () => { state.group = b.dataset.group; state.expanded.clear(); renderAll(); });

refresh();
