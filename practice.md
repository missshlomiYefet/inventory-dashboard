# practice.md — Project Conventions & Working Practices

Rules for anyone (or any AI assistant) working on this project. If something here conflicts with `SPEC.md`, SPEC wins for *what* to build and this file wins for *how*.

## 1. Project at a glance

- **What:** Inventory-only dashboard for TechNest Computers, a small store (branches: Tel Aviv, Jerusalem, Ariel) selling computers, tablets and PC-related electronics and software. It shows no revenue or prices.
- **Users:** store owner, business owner, inventory manager.
- **Key docs:** `SPEC.md` (design), `ER.md` (data model), `data/` (Excel sources), `index.html` + `app.js` (dashboard). Run with `npx serve .`.

## 2. Language

- **All user-facing text is English** (labels, tooltips, errors, button text, number and date formats).
- Code, comments, commit messages and docs are in English too.
- Dates display as `Mon 9 Nov 2026` or `2026-11-09`; numbers with thousands separators; currency as `$1,234.50`.

## 3. Visual style — blues and light grays

| Role | Color | Hex |
|---|---|---|
| Primary (header, main series) | Navy blue | `#1F4E79` |
| Secondary series | Medium blue | `#2E75B6` |
| Tertiary series | Sky blue | `#9DC3E6` |
| Highlight / hover | Bright blue | `#4A90D9` |
| Page background | Very light gray | `#F2F4F7` |
| Card background | White | `#FFFFFF` |
| Borders / gridlines | Light gray | `#D9DEE5` |
| Muted text | Slate gray | `#5B6675` |
| Main text | Near-black blue-gray | `#1B2430` |

- Keep the whole interface within blues and grays.
- **Status exception:** alerts need to be recognizable, so use a muted amber `#D98E04` (low stock) and a muted red `#C0392B` (out of stock / errors) **sparingly**, only for status, always with a text label or icon. Do not use them for decoration.
- Charts: use shades of blue for categories; at most 5 distinct hues of blue/gray in one chart (group the rest as "Other").
- Font: system sans-serif stack (Segoe UI, Roboto, Arial). KPI numbers large and bold; labels small and gray.
- Cards with 8 px corner radius and a thin light-gray border; generous white space; no heavy shadows or gradients.

## 4. Data rules

- The Excel files in `data/` are the **single source of truth**. The dashboard never stores or hard-codes figures.
- Do not rename sheets or columns without updating `ER.md`, `SPEC.md` and the dashboard code together.
- Column names are `snake_case`; IDs are text with a prefix (`P001`, `C001`, `S01`, `ORD-0001`, `PO-0001`).
- After any change to the data, re-check the 9 validation rules in `SPEC.md` section 9. Never "fix" a mismatch by editing a total; fix the underlying rows or movements.
- Sample data is fictional. Do not put real customer information in the repository.

## 5. Code practices

- Keep it simple: plain HTML/JS, minimal dependencies, pinned versions for libraries loaded from a CDN.
- One place defines each metric (see `SPEC.md` section 5); charts and tables reuse those functions.
- Handle missing files, missing columns, and empty results with a clear on-screen message.
- No silent failures: if validation fails, show it.
- Name things by business meaning (`availableUnits`, `needsReorder`), not by implementation.

## 6. Accessibility & usability

- Text contrast of at least 4.5:1; never rely on color alone.
- Everything usable by keyboard; tooltips also available on focus.
- Numbers in tables are right-aligned; tables are sortable.

## 7. Git & workflow

- Small, focused commits with imperative messages (e.g. `Add reorder list to dashboard`).
- Work on feature branches; merge to `main` when the change is tested.
- Do not commit anything outside this project folder.

## 8. Testing & review checklist (before calling something done)

- [ ] Dashboard loads with no console errors.
- [ ] Refresh re-reads the files (edit a quantity in Excel, refresh, see the change).
- [ ] All 9 validation checks pass on the sample data (badge in the header says ✔).
- [ ] KPI numbers match a manual check (e.g. total on the shelves = 943 and really available = 908 on the sample data).
- [ ] Filters work and the "no results" state looks right.
- [ ] Palette, English text and layout match this file.

## 9. Communication

- Ask the owner when a business rule is unclear (see `SPEC.md` section 12) instead of guessing.
- Record decisions by updating `SPEC.md`, not in chat only.
