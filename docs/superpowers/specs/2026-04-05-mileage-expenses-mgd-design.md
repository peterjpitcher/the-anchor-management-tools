# Mileage, Expenses & Machine Games Duty — Design Spec

**Date:** 2026-04-05
**Status:** Draft (post-QA review)
**Modules:** Mileage, Expenses, MGD
**Approach:** Three separate modules under Finance nav (Approach A)
**QA Review:** `tasks/codex-qa-review/2026-04-05-mileage-expenses-mgd-codex-qa-report.md`

---

## 1. Overview

Three new modules for The Anchor, Stanwell Moor Village management tools:

1. **Mileage** — Track business trips for HMRC-rate reimbursement from the business. Multi-stop routes from the pub (TW19 6AQ), with saved destinations and a distance cache that builds organically. OJ-Projects mileage auto-syncs in.
2. **Expenses** — Track petty cash / personal spend to claim back from the business. Receipt image upload with server-side optimisation. Matches the current spreadsheet workflow (date, company, justification, amount, VAT).
3. **MGD (Machine Games Duty)** — Record machine collections and track quarterly HMRC return periods. Single premises. The system totals collections per quarter; the user submits to HMRC manually.

All three integrate into the existing `/receipts` quarterly export as additional CSV files, expense receipt images, and a Claim Summary PDF showing the total mileage + expenses amount to transfer to the owner.

---

## 2. Access Control

- **RBAC modules:** `mileage`, `expenses`, `mgd`
- **Actions:** `view`, `manage` (covers create/edit/delete)
- **Roles:** `super_admin` only — no other roles have access
- **No approval workflow** — owners enter directly

### 2.1 Type Registration

Add `'mileage'`, `'expenses'`, and `'mgd'` to the `ModuleName` union type in `src/types/rbac.ts`. The `ActionType` union already includes `'view'` and `'manage'` — no changes needed there.

### 2.2 RLS Policies

All new tables must use **role-aware RLS**, not bare `authenticated` policies. Create a shared SQL function:

```sql
CREATE OR REPLACE FUNCTION public.is_super_admin(user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = $1 AND r.name = 'super_admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

Apply to every new table:
```sql
CREATE POLICY "super_admin_all" ON mileage_trips
  FOR ALL USING (public.is_super_admin(auth.uid()));
```

This ensures that even if a non-super_admin user reaches a table through the anon client, RLS blocks access.

### 2.3 Export Permission

The enhanced quarterly export must check `super_admin` status explicitly. The existing `receipts:export` permission is granted beyond super_admin, so the new finance data (mileage, expenses, MGD, claim summary PDF) must only be included when the requesting user is a super_admin. Non-super_admin users still get the existing receipts-only export.

---

## 3. Data Model

### 3.1 Mileage

#### `mileage_destinations`

The Anchor itself is stored as a real row (sentinel) — not represented by NULL. This avoids PostgreSQL's NULL-inequality problem with unique constraints.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | TEXT NOT NULL | e.g. "Tesco - Ashford" |
| postcode | TEXT | e.g. "TW19 7PZ" |
| is_home_base | BOOLEAN DEFAULT FALSE | TRUE for The Anchor only |
| created_by | UUID FK → auth.users | |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | Trigger-managed |

- **Constraint:** Only one row can have `is_home_base = TRUE` (partial unique index)
- The Anchor row is seeded with `name = 'The Anchor'`, `postcode = 'TW19 6AQ'`, `is_home_base = TRUE`

#### `mileage_destination_distances`

Caches the distance between any two points. Built organically — when a user enters miles for a leg, the value is stored here for future pre-fill.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| from_destination_id | UUID FK → mileage_destinations NOT NULL | |
| to_destination_id | UUID FK → mileage_destinations NOT NULL | |
| miles | NUMERIC(8,1) NOT NULL | One-way distance |
| last_used_at | TIMESTAMPTZ | Updated on each use |

- **Constraint:** UNIQUE on canonical pair — store with the smaller UUID in `from_destination_id` to avoid A→B / B→A duplicates. Distances are symmetric.
- When a user enters a new distance for an existing pair, the cached value is updated.
- Both columns are NOT NULL (The Anchor is a real row, not NULL).

#### `mileage_trips`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| trip_date | DATE NOT NULL | |
| description | TEXT | Purpose / justification |
| total_miles | NUMERIC(8,1) NOT NULL | Sum of all legs (enforced on save) |
| miles_at_standard_rate | NUMERIC(8,1) NOT NULL | Miles at £0.45 |
| miles_at_reduced_rate | NUMERIC(8,1) NOT NULL DEFAULT 0 | Miles at £0.25 (above 10k threshold) |
| amount_due | NUMERIC(10,2) NOT NULL | Calculated by server action |
| source | TEXT NOT NULL CHECK (source IN ('manual', 'oj_projects')) | |
| oj_entry_id | UUID FK → oj_entries | NULL if manual. UNIQUE — one sync per OJ entry |
| created_by | UUID FK → auth.users | |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | Trigger-managed |

- **Constraint:** `CHECK (total_miles = miles_at_standard_rate + miles_at_reduced_rate)`
- **Constraint:** `CHECK (amount_due = miles_at_standard_rate * 0.45 + miles_at_reduced_rate * 0.25)`

**HMRC rate logic:** The server action calculates rates based on cumulative miles in the tax year (6 April → 5 April). All date calculations use London timezone via `dateUtils.ts`.

- First 10,000 miles: £0.45/mile
- Above 10,000 miles: £0.25/mile
- If a trip crosses the threshold, it is split into `miles_at_standard_rate` and `miles_at_reduced_rate`
- Example: 9,950 cumulative + 100-mile trip → `miles_at_standard_rate = 50`, `miles_at_reduced_rate = 50`, `amount_due = £35.00`

**Trip ordering:** Cumulative miles are calculated using `ORDER BY trip_date ASC, created_at ASC`. The `created_at` column provides a stable, deterministic tiebreaker for same-day trips.

**Recalculation on mutation:** On any trip INSERT, UPDATE, or DELETE:
1. Acquire an advisory lock on the tax year (prevents concurrent recalculations from corrupting totals)
2. If an UPDATE changes the date across a tax year boundary (6 April), recalculate BOTH the old and new tax years
3. Use a single SQL CTE with a window function to batch-recalculate all affected trips:
   ```sql
   WITH cumulative AS (
     SELECT id, total_miles,
       SUM(total_miles) OVER (ORDER BY trip_date, created_at
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total
     FROM mileage_trips
     WHERE trip_date BETWEEN :tax_year_start AND :tax_year_end
   )
   -- Apply threshold split logic and batch-update
   ```
4. This turns N sequential queries into 1 query — comfortably under 100ms at 200 trips/year.

#### `mileage_trip_legs`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| trip_id | UUID FK → mileage_trips | ON DELETE CASCADE |
| leg_order | SMALLINT NOT NULL | 1, 2, 3... |
| from_destination_id | UUID FK → mileage_destinations NOT NULL | |
| to_destination_id | UUID FK → mileage_destinations NOT NULL | |
| miles | NUMERIC(8,1) NOT NULL | Distance for this leg |

- First leg: `from_destination_id` = The Anchor's UUID
- Last leg: `to_destination_id` = The Anchor's UUID
- Middle legs chain: leg N's `to_destination_id` = leg N+1's `from_destination_id`
- **Constraint:** UNIQUE(trip_id, leg_order)

**Atomic save:** The server action always replaces the full leg set in a single transaction:
1. DELETE all existing legs for the trip
2. INSERT the new complete set
3. Validate: contiguous `1..N` ordering, first leg starts at Anchor, last leg ends at Anchor, chain continuity (`leg_n.to = leg_n+1.from`)
4. Set `total_miles` = SUM of all leg miles
5. Any validation failure rolls back the entire transaction

**OJ-Projects synced trips have NO legs** — see §4.1 for details.

### 3.2 Expenses

#### `expenses`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| expense_date | DATE NOT NULL | |
| company_ref | TEXT NOT NULL | e.g. "Tesco", "Mr Fizz" |
| justification | TEXT NOT NULL | e.g. "Groceries", "Gas", "Meeting" |
| amount | NUMERIC(10,2) NOT NULL CHECK (amount > 0) | Gross amount spent |
| vat_applicable | BOOLEAN DEFAULT FALSE | |
| vat_amount | NUMERIC(10,2) DEFAULT 0 CHECK (vat_amount >= 0) | Manually entered, not auto-calculated |
| notes | TEXT | Optional |
| created_by | UUID FK → auth.users | |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | Trigger-managed |

#### `expense_files`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| expense_id | UUID FK → expenses | ON DELETE CASCADE |
| storage_path | TEXT NOT NULL | Path in Supabase storage |
| file_name | TEXT NOT NULL | Original filename |
| mime_type | TEXT NOT NULL | |
| file_size_bytes | INTEGER | After optimisation |
| uploaded_by | UUID FK → auth.users | |
| uploaded_at | TIMESTAMPTZ | DEFAULT now() |

- **Storage bucket:** `expense-receipts` (private, service-role access)
- **Accepted types:** JPEG, PNG, WebP, HEIC, PDF
- **Optimisation:** Server-side via `sharp` — images resized to max 2000px longest edge, compressed to 80% quality. HEIC converted to JPEG. PDFs stored as-is.
- **Multiple images per expense** supported (max 10 files per expense)

### 3.3 MGD

#### `mgd_collections`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| collection_date | DATE NOT NULL | |
| net_take | NUMERIC(10,2) NOT NULL CHECK (net_take >= 0) | Machine takings after payout |
| mgd_amount | NUMERIC(10,2) GENERATED ALWAYS AS (net_take * 0.20) STORED | 20% duty |
| vat_on_supplier | NUMERIC(10,2) NOT NULL CHECK (vat_on_supplier >= 0) | VAT from machine supplier |
| notes | TEXT | |
| created_by | UUID FK → auth.users | |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | Trigger-managed |

#### `mgd_returns`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| period_start | DATE NOT NULL | e.g. 2025-02-01 |
| period_end | DATE NOT NULL | e.g. 2025-04-30 |
| total_net_take | NUMERIC(12,2) | Aggregated from collections |
| total_mgd | NUMERIC(12,2) | Aggregated from collections |
| total_vat_on_supplier | NUMERIC(12,2) | Aggregated from collections |
| status | TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'paid')) | |
| submitted_at | TIMESTAMPTZ | When marked as submitted |
| submitted_by | UUID FK → auth.users | Who submitted |
| date_paid | DATE | When HMRC payment was made |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | Trigger-managed |

- **Constraint:** UNIQUE(period_start, period_end)
- **Constraint:** `CHECK (period_start < period_end)`
- **Constraint:** `date_paid` only set when `status = 'paid'`

**MGD quarter cycle and month→period mapping:**

| Month | MGD Quarter | period_start | period_end |
|-------|-------------|-------------|------------|
| February, March, April | Feb-Apr | YYYY-02-01 | YYYY-04-30 |
| May, June, July | May-Jul | YYYY-05-01 | YYYY-07-31 |
| August, September, October | Aug-Oct | YYYY-08-01 | YYYY-10-31 |
| November, December, January | Nov-Jan | YYYY-11-01 | (YYYY+1)-01-31 |

Example: A collection on 2026-01-15 belongs to **Nov 2025 — Jan 2026** (period_start = 2025-11-01, period_end = 2026-01-31). The `period_start` year is used for labelling.

**Auto-creation:** When a collection is inserted and no return exists for its period, one is created automatically with `status = 'open'`.

**Totals recalculated** on each collection INSERT/UPDATE/DELETE via trigger.

**Lifecycle rules:**
- `open` → `submitted`: Locks the return. Collections within this period can no longer be added, edited, or deleted. Sets `submitted_at` and `submitted_by`.
- `submitted` → `paid`: Sets `date_paid`. Remains locked.
- `submitted` → `open`: Reopens for corrections. Clears `submitted_at`/`submitted_by`. Totals recalculated.
- `paid` → reopening requires explicit confirmation (destructive action).

---

## 4. OJ-Projects Integration

### 4.1 Mileage Sync

A PostgreSQL trigger on `oj_entries` handles the sync. The trigger is **lightweight** — it only syncs the single row and defers HMRC rate recalculation to the application layer.

**Trigger behaviour matrix:**

| Trigger Event | OLD.entry_type | NEW.entry_type | Action |
|--------------|----------------|----------------|--------|
| INSERT | — | 'mileage' | Create `mileage_trips` row |
| INSERT | — | other | No-op |
| UPDATE | 'mileage' | 'mileage' | Update the synced `mileage_trips` row |
| UPDATE | other | 'mileage' | Create `mileage_trips` row (entering mileage) |
| UPDATE | 'mileage' | other | Delete the synced `mileage_trips` row (leaving mileage) |
| UPDATE | other | other | No-op |
| DELETE | 'mileage' | — | Delete the synced `mileage_trips` row |
| DELETE | other | — | No-op |

**Synced trip representation:**
- `source = 'oj_projects'`, `oj_entry_id` = the OJ entry ID
- `total_miles` = `oj_entries.miles` (the round-trip miles as entered in OJ)
- **No child legs** (`mileage_trip_legs`). OJ-Projects doesn't capture multi-stop routes, so synced trips are leg-less summary rows.
- Route display in UI/CSV: "OJ Projects — [description]" instead of a destination chain
- `description` = OJ entry description or "[OJ Project Name] — [date]"
- Synced trips are **read-only** in the mileage module — edits go through OJ-Projects

**HMRC rate recalculation:** The trigger does NOT perform rate calculations. After the trigger fires, the OJ-Projects server action calls the shared mileage rate recalculation function (same function used by manual trip saves). This avoids:
- Hidden latency in OJ-Projects saves
- Deadlocks between trigger and manual mileage edits
- Duplicated rate calculation logic

**Backfill on deployment:** Existing OJ-Projects mileage entries are NOT automatically backfilled. The sync begins from the trigger activation date. If historical OJ mileage needs claiming, it can be manually entered as mileage trips.

### 4.2 Rate Update

The OJ-Projects vendor billing default mileage rate will be updated from £0.42 to £0.45. This is a one-time data migration. The HMRC rate enforcement (£0.45/£0.25 threshold) applies to the mileage module only — OJ-Projects continues to bill clients at whatever rate is configured per vendor (which will now default to £0.45).

---

## 5. Routes & Pages

All new pages must use the `PageLayout` + `HeaderNav` pattern from `src/components/ui-v2/`. All date display must use `formatDateInLondon()` from `src/lib/dateUtils.ts`. Tax year boundary calculations must use London timezone.

### 5.1 Mileage

| Route | Purpose |
|-------|---------|
| `/mileage` | Trip list with stats cards (quarter total, tax year total, miles to threshold), filters, and "New Trip" entry |
| `/mileage/destinations` | Saved destination CRUD — name, postcode, miles from Anchor, trip count |

**Nav entries for `financeNavigation[]` in `AppNavigation.tsx`:**
```typescript
{ name: 'Mileage', href: '/mileage', icon: MapIcon, permission: { module: 'mileage', action: 'view' } },
{ name: 'Destinations', href: '/mileage/destinations', icon: MapPinIcon, permission: { module: 'mileage', action: 'view' }, subItem: true },
```

**Page states:**
- **Loading:** Skeleton loaders for stats cards and trip list
- **Empty:** "No trips recorded yet — add your first trip" with prominent CTA
- **Error:** Toast notification for failed saves; inline error for failed data loads

### 5.2 Expenses

| Route | Purpose |
|-------|---------|
| `/expenses` | Expense list with stats cards (quarter total, VAT reclaimable, missing receipts count), filters, "New Expense" entry with receipt upload |

**Nav entry:**
```typescript
{ name: 'Expenses', href: '/expenses', icon: BanknotesIcon, permission: { module: 'expenses', action: 'view' } },
```

**Page states:**
- **Loading:** Skeleton loaders for stats cards and expense list
- **Empty:** "No expenses recorded yet — add your first expense"
- **Error:** Toast for failed saves; inline error for failed loads; toast for failed image uploads with retry option

### 5.3 MGD

| Route | Purpose |
|-------|---------|
| `/mgd` | Current return period summary at top, collections list, return history. "Record Collection" entry. Status transitions on returns (open → submitted → paid). |

**Nav entry:**
```typescript
{ name: 'MGD', href: '/mgd', icon: CurrencyPoundIcon, permission: { module: 'mgd', action: 'view' } },
```

**Page states:**
- **Loading:** Skeleton loaders for return summary and collections list
- **Empty:** "No collections recorded yet — record your first machine collection"
- **Error:** Toast for failed saves; confirmation dialog for status transitions (especially reopen from paid)

---

## 6. Trip Entry UX

The mileage trip form uses a route builder pattern:

1. **Origin** is always The Anchor (TW19 6AQ) — shown but not editable
2. **Stops** are added sequentially — each stop is a dropdown of saved destinations + a miles input
3. **Miles pre-fill** — when a destination is selected, the system looks up the distance from the previous stop in `mileage_destination_distances`. If found, pre-fills the miles (editable). If not found, the field is blank with an amber hint "New route — enter miles manually".
4. **Final leg** always returns to The Anchor — miles pre-filled if the distance from the last stop to The Anchor is cached
5. **"+ Add Stop"** button adds another leg. Removing a middle stop re-chains the legs automatically.
6. **Total** shown live: sum of all leg miles, with rate breakdown if near/past the 10k threshold. For threshold-crossing trips, show: "X mi @ £0.45 + Y mi @ £0.25 = £Z.ZZ"
7. On save: legs replaced atomically (DELETE + INSERT), distances cached, trip total and HMRC amount calculated via shared recalculation function

---

## 7. Quarterly Export Enhancement

### 7.1 MGD Quarter Mapping

The receipts export uses **calendar quarters** (Q1 = Jan-Mar, Q2 = Apr-Jun, Q3 = Jul-Sep, Q4 = Oct-Dec). MGD uses HMRC quarters (Feb-Apr, May-Jul, Aug-Oct, Nov-Jan). These do not align.

**Resolution:** The MGD CSV included in the export contains data for the **MGD quarter that overlaps most** with the selected calendar quarter:

| Calendar Quarter | MGD Quarter Included | Note |
|-----------------|---------------------|------|
| Q1 (Jan-Mar) | Feb-Apr | 2 months overlap (Feb-Mar) |
| Q2 (Apr-Jun) | May-Jul | 2 months overlap (May-Jun) |
| Q3 (Jul-Sep) | Aug-Oct | 2 months overlap (Aug-Sep) |
| Q4 (Oct-Dec) | Nov-Jan | 2 months overlap (Nov-Dec) |

The MGD CSV header clearly states its actual period dates (e.g. "Period: 1 Feb 2026 — 30 Apr 2026") regardless of the calendar quarter selected. The Claim Summary PDF also shows the MGD period explicitly.

### 7.2 ZIP Bundle Structure

```
receipts_q{Q}_{YYYY}.zip
├── Claim_Summary_Q{Q}_{YYYY}.pdf        ← NEW
├── Receipts_Q{Q}_{YYYY}.csv             (existing)
├── receipts/                             (existing)
│   └── {receipt files}
├── Mileage_Q{Q}_{YYYY}.csv              ← NEW
├── Expenses_Q{Q}_{YYYY}.csv             ← NEW
├── expense-receipts/                     ← NEW
│   └── {YYYY-MM-DD}_{Company}_{Amount}.{ext}
└── MGD_{Period}_{YYYY}.csv              ← NEW (named by actual MGD period)
```

**Zero-data policy:** CSVs are always included even if empty (header row only, summary shows zero totals). The `expense-receipts/` folder is omitted if there are no images. The Claim Summary PDF is always included.

**Expense receipt images:** If an expense_file's storage object is missing (deleted or corrupted), log a warning and skip the file silently — do not fail the entire export. This matches the existing receipts export behaviour.

**The enhanced bundle (mileage, expenses, MGD, claim PDF) is only included for super_admin users.** Non-super_admin users who can export receipts still get the existing receipts-only bundle.

### 7.3 Claim Summary PDF

Generated server-side using `pdfkit` (lightweight, streaming-capable). Pipe directly into the archiver stream — do not buffer the entire PDF in memory.

**Header:**
- "The Anchor, Stanwell Moor Village"
- "Quarterly Financial Claims Summary"
- "Q{N} {YYYY} ({Month} — {Month})"
- Generation timestamp

**Section 1 — Mileage:**
- Total trips, total miles
- Rate breakdown: X miles at £0.45, Y miles at £0.25 (if threshold crossed)
- Mileage claim total

**Section 2 — Expenses (Petty Cash):**
- Total entries, gross total, VAT reclaimable, expenses claim total

**Section 3 — Machine Games Duty (informational):**
- Period: [actual MGD dates, not calendar quarter]
- Collections in period, total net takings, MGD due (20%), VAT on supplier
- Clearly labelled: "For information only — MGD is paid directly to HMRC and is not included in the claim total"

**Footer — Amount to Transfer to Owner:**
- Mileage: £X
- Expenses: £Y
- **Grand Total: £Z**

**Supporting documents note:** Lists all files in the bundle.

### 7.4 CSV Formats

Each CSV follows the existing receipts CSV pattern:
- BOM prefix (`\ufeff`) for Excel compatibility
- Summary header block at top (key-value pairs)
- Blank row separator
- Column headers
- Data rows
- Formula injection protection (tab-prefix on leading `=`, `+`, `-`, `@`)

**Mileage CSV columns:** Date, Route (human-readable: "Anchor → Stop 1 → Anchor" for legged trips, "OJ Projects — [desc]" for synced), Total Miles, Miles @ £0.45, Miles @ £0.25, Amount (£), Source (Manual/OJ Projects)

**Expenses CSV columns:** Date, Company, Justification, Amount (£), VAT Applicable, VAT Amount (£), Has Receipt (Yes/No), Notes

**MGD CSV columns:** Collection Date, Net Take (£), MGD 20% (£), VAT on Supplier (£)

### 7.5 Expense Receipt Image Naming

Pattern: `{YYYY-MM-DD}_{CompanySanitised}_{Amount}.{ext}`
- Multiple images for same expense: append `_2`, `_3`, etc.
- If two different expenses produce the same filename, append expense UUID prefix to disambiguate
- Company name sanitised: spaces removed, special characters stripped, truncated to 30 characters
- HEIC files are stored as JPEG after conversion — exported with `.jpg` extension

### 7.6 Export UI

The existing `ReceiptExport.tsx` component is updated to show a preview of what the bundle contains — listing all file types with counts (e.g. "42 mileage trips, 156 expenses, 8 MGD collections"). The preview data is loaded when the user selects a year/quarter.

### 7.7 Export Performance

The expanded bundle (potentially hundreds of expense receipt images) must handle memory and timeout constraints:
- **Stream images** directly into the archiver — download the blob and pipe it rather than buffering with `arrayBuffer()` then `Buffer.from()`
- **Increase download concurrency** to 6-8 for expense receipt images (smaller than full receipt scans)
- **Batch processing** if needed — append images in batches of 50, allowing GC between batches
- Current 300-second timeout should be sufficient at this scale but monitor

---

## 8. Image Handling

### 8.1 Upload Flow

1. User drops/selects files in the expense form
2. Client validates file type (JPEG, PNG, WebP, HEIC, PDF) and shows preview thumbnails
3. Files sent to server action via FormData
4. **Server-side validation (before processing):**
   - Validate magic bytes to confirm actual file type matches extension
   - Max 20MB per file
   - Max 10 files per expense
   - Max 50 megapixels for images (prevents decompression bombs)
   - Reject invalid files before any `sharp` processing
5. Server action processing:
   - For images: resize to max 2000px longest edge, compress to 80% quality via `sharp`. HEIC converted to JPEG. Process multiple files in parallel (`Promise.all`).
   - For PDFs: stored as-is (max 20MB)
   - Upload to Supabase storage bucket `expense-receipts`
   - Insert metadata into `expense_files`

### 8.2 Storage

- **Bucket:** `expense-receipts` (private)
- **Path pattern:** `{expense_id}/{uuid}.{ext}`
- **Access:** Service-role client only (same pattern as `receipts` bucket)
- **File access pattern:** Never accept raw `storage_path` from callers. Always resolve by `expense_files.id`, join to `expenses`, verify super_admin, then issue short-lived signed URL or server-side download.
- **Bucket creation:** Via migration, with RLS policies matching the `is_super_admin()` function.

---

## 9. Server Action Contracts

All server actions follow the project pattern: `'use server'` directive, auth via `requireCurrentUser()` or equivalent, permission check via `checkUserPermission()`, typed return `Promise<{ success?: boolean; error?: string }>`, `logAuditEvent()` for mutations, `revalidatePath()` after mutations.

### 9.1 Mileage Actions

| Action | Permission | Zod Schema | Audit | Revalidate |
|--------|-----------|------------|-------|-----------|
| `createTrip` | `mileage:manage` | trip_date (date string), description (text, max 500), legs[] (destination_id UUID, miles > 0) | resource_type: 'mileage_trip', op: 'create' | `/mileage` |
| `updateTrip` | `mileage:manage` | id (UUID), trip_date, description, legs[] | resource_type: 'mileage_trip', op: 'update' | `/mileage` |
| `deleteTrip` | `mileage:manage` | id (UUID). Reject if source = 'oj_projects' | resource_type: 'mileage_trip', op: 'delete' | `/mileage` |
| `createDestination` | `mileage:manage` | name (text, max 200), postcode (text, max 10, optional) | resource_type: 'mileage_destination', op: 'create' | `/mileage/destinations` |
| `updateDestination` | `mileage:manage` | id, name, postcode | resource_type: 'mileage_destination', op: 'update' | `/mileage/destinations` |
| `deleteDestination` | `mileage:manage` | id. Reject if referenced by trip legs. | resource_type: 'mileage_destination', op: 'delete' | `/mileage/destinations` |

### 9.2 Expense Actions

| Action | Permission | Zod Schema | Audit | Revalidate |
|--------|-----------|------------|-------|-----------|
| `createExpense` | `expenses:manage` | expense_date, company_ref (max 200), justification (max 500), amount (> 0), vat_applicable (bool), vat_amount (>= 0), notes (max 2000, optional) | resource_type: 'expense', op: 'create' | `/expenses` |
| `updateExpense` | `expenses:manage` | id, same fields as create | resource_type: 'expense', op: 'update' | `/expenses` |
| `deleteExpense` | `expenses:manage` | id. Cascades to expense_files (storage cleanup). | resource_type: 'expense', op: 'delete' | `/expenses` |
| `uploadExpenseFile` | `expenses:manage` | expense_id (UUID), file (FormData). Max 10 files per expense, max 20MB each. | resource_type: 'expense_file', op: 'create' | `/expenses` |
| `deleteExpenseFile` | `expenses:manage` | id (UUID). Deletes from storage and DB. | resource_type: 'expense_file', op: 'delete' | `/expenses` |

### 9.3 MGD Actions

| Action | Permission | Zod Schema | Audit | Revalidate |
|--------|-----------|------------|-------|-----------|
| `createCollection` | `mgd:manage` | collection_date, net_take (>= 0), vat_on_supplier (>= 0), notes (optional). Reject if the return for this period is submitted/paid. | resource_type: 'mgd_collection', op: 'create' | `/mgd` |
| `updateCollection` | `mgd:manage` | id, same fields. Reject if return is submitted/paid. | resource_type: 'mgd_collection', op: 'update' | `/mgd` |
| `deleteCollection` | `mgd:manage` | id. Reject if return is submitted/paid. | resource_type: 'mgd_collection', op: 'delete' | `/mgd` |
| `updateReturnStatus` | `mgd:manage` | id, status ('submitted' or 'paid' or 'open'), date_paid (if paid). Confirmation required for reopening a paid return. | resource_type: 'mgd_return', op: 'update' | `/mgd` |

---

## 10. Seed Data & Rollout Checklist

### 10.1 Database Migration

1. Create all tables (mileage_destinations, mileage_destination_distances, mileage_trips, mileage_trip_legs, expenses, expense_files, mgd_collections, mgd_returns)
2. Create `is_super_admin()` SQL function (or reuse if already exists)
3. Apply RLS policies using `is_super_admin()` on all new tables
4. Create `expense-receipts` storage bucket (private) with RLS policies
5. Create OJ-Projects sync trigger on `oj_entries`
6. Create MGD return auto-creation trigger on `mgd_collections`

### 10.2 Permission Seeding

Insert permissions for the three new modules:
```sql
INSERT INTO permissions (module_name, action, description) VALUES
  ('mileage', 'view', 'View mileage trips and destinations'),
  ('mileage', 'manage', 'Create, edit, and delete mileage trips and destinations'),
  ('expenses', 'view', 'View expenses'),
  ('expenses', 'manage', 'Create, edit, and delete expenses and receipt files'),
  ('mgd', 'view', 'View MGD collections and returns'),
  ('mgd', 'manage', 'Create, edit, and delete MGD collections; manage return status');
```

Assign all six permissions to the `super_admin` role.

### 10.3 Destination Seed Data

Import the 43 existing destinations from the mileage spreadsheet Lookup sheet into `mileage_destinations`. Seed The Anchor as the home base row. Cache distances from The Anchor in `mileage_destination_distances`.

### 10.4 OJ-Projects Rate Update

One-time data migration: update the default mileage rate from £0.42 to £0.45 in `oj_vendor_billing_settings` and the UI default in `clients/page.tsx`.

### 10.5 Historical Data

Historical data from the spreadsheets will NOT be migrated — the system starts fresh. OJ-Projects mileage entries created before the trigger activation are not backfilled. Users can back-enter data if needed.

---

## 11. Testing Requirements

### 11.1 Priority Test Areas

1. **HMRC rate calculation** (highest priority):
   - Happy path: all trips below 10k threshold
   - Threshold crossing: trip straddles the boundary
   - Post-threshold: all trips above 10k
   - Recalculation: insert/delete a trip in the middle of the year shifts subsequent rates
   - Tax year boundary: trips near 5/6 April
   - Same-day ordering: deterministic results with `created_at` tiebreaker

2. **MGD quarter mapping:**
   - January collection → Nov-Jan period
   - Boundary dates (1 Feb, 30 Apr, etc.)
   - Auto-creation of return when first collection in period is entered

3. **CSV generation:**
   - BOM prefix present
   - Formula injection protection on text fields
   - Mileage rate breakdown columns correct for split trips

4. **OJ-Projects sync trigger:**
   - entry_type transitions (time→mileage, mileage→time, mileage→mileage)
   - Delete entry removes synced trip
   - Synced trip is read-only in mileage module

5. **Image upload:**
   - File type validation (magic bytes, not just extension)
   - Size limit enforcement
   - HEIC→JPEG conversion

### 11.2 Mock Strategy

Mock: Supabase client, `sharp` (for unit tests), storage bucket operations
Don't mock: HMRC rate calculation logic, MGD quarter mapping, CSV generation utilities

---

## 12. Technical Notes

- **PDF generation:** Use `pdfkit` (lightweight, streaming). Stream directly into archiver. Do NOT use `@react-pdf/renderer` (heavier, requires React rendering pipeline).
- **Image optimisation:** `sharp` — process multiple uploads in parallel via `Promise.all`. Add 10-second timeout per image with fallback to storing original.
- **OJ-Projects trigger:** Lightweight PL/pgSQL function — sync the single row only, no rate calculation. App layer calls shared recalculation function after.
- **MGD return auto-creation:** SQL function maps collection_date to its MGD quarter period, then upserts the return row.
- **Snake_case → camelCase:** All DB query results must be handled through the project's standard pattern before use in TypeScript code.
- **Audit logging:** All mutations call `logAuditEvent()` per existing codebase pattern.
- **Service layer:** Consider extracting business logic into `src/services/mileage/`, `src/services/expenses/`, `src/services/mgd/` following the receipts module pattern.

---

## 13. Out of Scope

- Historical data migration from spreadsheets (start fresh)
- OJ-Projects mileage backfill (sync starts from trigger activation)
- Approval workflows for expenses
- Mapping API integration for distance calculation
- MGD formal return document generation
- Multiple premises support for MGD
- Non-super_admin access to any of the three modules
