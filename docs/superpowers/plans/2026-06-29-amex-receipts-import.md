# Amex statement import for /receipts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `/receipts` import American Express statement CSVs alongside bank-statement CSVs, distinguish bank vs credit-card transactions in the UI, capture cardholder/merchant metadata, and keep every existing post-import behaviour intact.

**Architecture:** Reuse the existing import → dedupe → rules → AI → list → export pipeline. Add a `source_type` ('bank'|'amex') plus Amex metadata columns (additive migration), a second CSV parser, a parser branch in `performImportReceiptStatement`, source/cardholder filters + badges in the UI, and source-aware fixes to duplicate-candidate detection and P&L. No fork of tables or pipeline.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript (strict), Supabase (service-role), PapaParse, Vitest, Tailwind v3, `@/ds` design system.

**Spec:** `docs/superpowers/specs/2026-06-29-amex-receipts-import-design.md`

**Working location:** isolated git worktree at `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools-amex` on branch `feat/receipts-amex-import`. Run all commands there.

**Conventions in this repo:** 2-space indent, single quotes, **no semicolons**, named exports, `console.warn`/`console.error` only. DB columns `snake_case`, TS `camelCase`. Tests use Vitest with globals; pure-helper tests are co-located.

---

## Task 1: Database migration (additive columns + indexes)

**Files:**
- Create: `supabase/migrations/20260714000000_receipts_amex_source.sql`

> Confirm at execution time that `20260714000000` is later than every existing migration (latest known is `20260713000000_mgd_machine_count.sql`). If a newer one exists, bump the timestamp.

- [ ] **Step 1: Write the migration**

```sql
-- Add source_type + Amex metadata to receipt transactions and batches.
-- Purely additive: existing rows backfill to 'bank' via the column default.

ALTER TABLE public.receipt_transactions
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'bank',
  ADD COLUMN IF NOT EXISTS card_member TEXT,
  ADD COLUMN IF NOT EXISTS card_account TEXT,
  ADD COLUMN IF NOT EXISTS merchant_category TEXT,
  ADD COLUMN IF NOT EXISTS merchant_town TEXT,
  ADD COLUMN IF NOT EXISTS external_reference TEXT;

ALTER TABLE public.receipt_transactions
  DROP CONSTRAINT IF EXISTS receipt_transactions_source_type_check;
ALTER TABLE public.receipt_transactions
  ADD CONSTRAINT receipt_transactions_source_type_check
  CHECK (source_type IN ('bank', 'amex'));

ALTER TABLE public.receipt_batches
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'bank';
ALTER TABLE public.receipt_batches
  DROP CONSTRAINT IF EXISTS receipt_batches_source_type_check;
ALTER TABLE public.receipt_batches
  ADD CONSTRAINT receipt_batches_source_type_check
  CHECK (source_type IN ('bank', 'amex'));

CREATE INDEX IF NOT EXISTS idx_receipt_transactions_source_type
  ON public.receipt_transactions (source_type);

CREATE INDEX IF NOT EXISTS idx_receipt_transactions_card_member
  ON public.receipt_transactions (card_member)
  WHERE source_type = 'amex';

-- Help the duplicate-file guard pre-check (see service layer).
CREATE INDEX IF NOT EXISTS idx_receipt_batches_source_hash
  ON public.receipt_batches (source_hash);
```

- [ ] **Step 2: Validate the SQL parses / dry-run**

Run: `cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools-amex && npx supabase db push --dry-run`
Expected: lists the new migration with no errors. (If the CLI is not linked locally, instead eyeball the SQL — it is additive and idempotent.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260714000000_receipts_amex_source.sql
git commit -m "feat(receipts): add source_type + Amex metadata columns"
```

> The duplicate-candidate detection is handled in Task 16 (it may live in SQL or TS — decide there). Do not modify it here unless Task 16's investigation finds it is SQL, in which case fold that change into a follow-up migration.

---

## Task 2: Core types + validation schema

**Files:**
- Modify: `src/types/database.ts` (ReceiptTransaction ~163-234, status/source types ~100-107)
- Modify: `src/lib/validation.ts` (near `receiptExpenseCategorySchema` ~164-189)
- Modify: `src/services/receipts/types.ts` (CsvRow/ParsedTransactionRow ~31-48, ReceiptWorkspaceFilters ~56-69)
- Test: `src/lib/__tests__/receiptSourceType.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/receiptSourceType.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { receiptSourceTypeSchema } from '@/lib/validation'

describe('receiptSourceTypeSchema', () => {
  it('accepts bank and amex', () => {
    expect(receiptSourceTypeSchema.parse('bank')).toBe('bank')
    expect(receiptSourceTypeSchema.parse('amex')).toBe('amex')
  })

  it('rejects anything else', () => {
    expect(receiptSourceTypeSchema.safeParse('visa').success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/receiptSourceType.test.ts`
Expected: FAIL — `receiptSourceTypeSchema` is not exported.

- [ ] **Step 3: Add the schema**

In `src/lib/validation.ts`, immediately after `receiptExpenseCategorySchema`'s closing `]);` add:

```ts
export const receiptSourceTypeSchema = z.enum(['bank', 'amex'])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/receiptSourceType.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend `src/types/database.ts`**

Add the source type next to `ReceiptClassificationSource`:

```ts
export type ReceiptSourceType = 'bank' | 'amex';
```

Add to the `ReceiptBatch` interface (after `source_hash`):

```ts
  source_type: ReceiptSourceType;
```

Add to the `ReceiptTransaction` interface (after `dedupe_hash`):

```ts
  source_type: ReceiptSourceType;
  card_member: string | null;
  card_account: string | null;
  merchant_category: string | null;
  merchant_town: string | null;
  external_reference: string | null;
```

- [ ] **Step 6: Extend `src/services/receipts/types.ts`**

Add an import at the top (merge into the existing `@/types/database` import if present):

```ts
import type {
  ReceiptSourceType,
  ReceiptTransactionStatus,
  ReceiptExpenseCategory,
  ReceiptClassificationSource,
} from '@/types/database'
```

Add the Amex CSV row shape next to `CsvRow`:

```ts
export type AmexCsvRow = {
  Date: string
  Description: string
  'Card Member': string
  'Account #': string
  Amount: string
  'Extended Details': string
  'Appears On Your Statement As': string
  'Town/City': string
  Reference: string
  Category: string
}
```

Replace `ParsedTransactionRow` with the extended version (existing fields unchanged, new optional fields appended):

```ts
export type ParsedTransactionRow = {
  transactionDate: string
  details: string
  transactionType: string | null
  amountIn: number | null
  amountOut: number | null
  balance: number | null
  dedupeHash: string
  // Source + Amex extensions. Bank rows omit these (treated as defaults downstream).
  sourceType?: ReceiptSourceType
  cardMember?: string | null
  cardAccount?: string | null
  merchantCategory?: string | null
  merchantTown?: string | null
  externalReference?: string | null
  status?: ReceiptTransactionStatus
  receiptRequired?: boolean
  expenseCategory?: ReceiptExpenseCategory | null
  expenseCategorySource?: ReceiptClassificationSource | null
  vendorName?: string | null
  vendorSource?: ReceiptClassificationSource | null
}
```

Extend `ReceiptWorkspaceFilters` (add two fields):

```ts
  sourceType?: 'bank' | 'amex' | 'all'
  cardMember?: string
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no NEW errors from these files. (Some pre-existing repo errors may exist; confirm none reference the receipt types you touched.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/validation.ts src/types/database.ts src/services/receipts/types.ts src/lib/__tests__/receiptSourceType.test.ts
git commit -m "feat(receipts): types + validation for source_type and Amex metadata"
```

---

## Task 3: `parseSignedAmount` helper

**Files:**
- Modify: `src/services/receipts/receiptHelpers.ts`
- Test: `src/services/receipts/receiptHelpers.amex.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/services/receipts/receiptHelpers.amex.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseSignedAmount } from './receiptHelpers'

describe('parseSignedAmount', () => {
  it('parses a positive spend', () => {
    expect(parseSignedAmount('261.99')).toBe(261.99)
  })

  it('keeps a negative payment/credit signed', () => {
    expect(parseSignedAmount('-2358.05')).toBe(-2358.05)
  })

  it('strips commas and currency symbols', () => {
    expect(parseSignedAmount('£1,234.50')).toBe(1234.5)
  })

  it('returns null for blank, zero, or invalid', () => {
    expect(parseSignedAmount('')).toBeNull()
    expect(parseSignedAmount('0')).toBeNull()
    expect(parseSignedAmount('abc')).toBeNull()
    expect(parseSignedAmount(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/receipts/receiptHelpers.amex.test.ts -t parseSignedAmount`
Expected: FAIL — `parseSignedAmount` not exported.

- [ ] **Step 3: Implement**

In `src/services/receipts/receiptHelpers.ts`, add directly below `parseCurrency`:

```ts
// Amex statements use a single signed Amount column (positive = spend, negative =
// payment/credit). Unlike parseCurrency this PRESERVES the sign. parseCurrency is left
// untouched so the bank path keeps rejecting negatives.
export function parseSignedAmount(value: string | null | undefined): number | null {
  if (!value) return null
  const cleaned = value.replace(/[£,]/g, '').trim()
  if (!cleaned) return null
  const result = Number.parseFloat(cleaned)
  if (!Number.isFinite(result) || result === 0) return null
  return Number(result.toFixed(2))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/receipts/receiptHelpers.amex.test.ts -t parseSignedAmount`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/receipts/receiptHelpers.ts src/services/receipts/receiptHelpers.amex.test.ts
git commit -m "feat(receipts): parseSignedAmount for Amex signed amounts"
```

---

## Task 4: `createAmexTransactionHash` helper

**Files:**
- Modify: `src/services/receipts/receiptHelpers.ts`
- Test: `src/services/receipts/receiptHelpers.amex.test.ts`

- [ ] **Step 1: Add the failing test** (append to the same describe file)

```ts
import { createAmexTransactionHash, createTransactionHash } from './receiptHelpers'

describe('createAmexTransactionHash', () => {
  const base = {
    transactionDate: '2026-04-16',
    signedAmount: 261.99,
    cardAccount: '71001',
    rawCardMember: 'MR P PITCHER',
    externalReference: 'AT261060074000010265389',
  }

  it('is stable for identical raw input', () => {
    expect(createAmexTransactionHash(base)).toBe(createAmexTransactionHash({ ...base }))
  })

  it('ignores display casing (uses raw fields only)', () => {
    // Hash takes rawCardMember; a differently-cased DISPLAY name must not change it.
    const a = createAmexTransactionHash(base)
    const b = createAmexTransactionHash({ ...base, rawCardMember: 'MR P PITCHER' })
    expect(a).toBe(b)
  })

  it('differs from the bank hash for the same date+amount', () => {
    const bank = createTransactionHash({
      transactionDate: '2026-04-16',
      details: 'AMZNMKTPLACE',
      transactionType: null,
      amountIn: null,
      amountOut: 261.99,
      balance: null,
    })
    expect(createAmexTransactionHash(base)).not.toBe(bank)
  })

  it('changes when the reference changes', () => {
    expect(createAmexTransactionHash(base)).not.toBe(
      createAmexTransactionHash({ ...base, externalReference: 'DIFFERENT' }),
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/services/receipts/receiptHelpers.amex.test.ts -t createAmexTransactionHash`
Expected: FAIL — function not exported.

- [ ] **Step 3: Implement** (add below `createTransactionHash` in `receiptHelpers.ts`)

```ts
// Dedup hash for Amex rows. Uses RAW, stable fields only — never the display-normalised
// `details` or title-cased card member — so formatting changes can't alter dedup identity.
// The 'amex' prefix guarantees no collision with bank hashes.
export function createAmexTransactionHash(input: {
  transactionDate: string
  signedAmount: number
  cardAccount: string | null
  rawCardMember: string | null
  externalReference: string | null
}): string {
  const hash = createHash('sha256')
  hash.update(
    [
      'amex',
      input.transactionDate,
      input.signedAmount.toFixed(2),
      input.cardAccount ?? '',
      input.rawCardMember ?? '',
      input.externalReference ?? '',
    ].join('|'),
  )
  return hash.digest('hex')
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/services/receipts/receiptHelpers.amex.test.ts -t createAmexTransactionHash`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/receipts/receiptHelpers.ts src/services/receipts/receiptHelpers.amex.test.ts
git commit -m "feat(receipts): createAmexTransactionHash using raw stable fields"
```

---

## Task 5: `parseAmexCsv` parser + non-purchase classification

**Files:**
- Modify: `src/services/receipts/receiptHelpers.ts`
- Test: `src/services/receipts/receiptHelpers.amex.test.ts`

- [ ] **Step 1: Add failing tests** (append)

```ts
import { parseAmexCsv } from './receiptHelpers'

const AMEX_HEADER =
  'Date,Description,Card Member,Account #,Amount,Extended Details,Appears On Your Statement As,Address,Town/City,Postcode,Country,Reference,Category'

function amexBuffer(rows: string[]): Buffer {
  return Buffer.from([AMEX_HEADER, ...rows].join('\n'), 'utf-8')
}

describe('parseAmexCsv', () => {
  it('throws a clear error when given a bank CSV', () => {
    const bank = Buffer.from('Date,Details,Transaction Type,In,Out,Balance\n01/01/2026,X,,1.00,,5.00', 'utf-8')
    expect(() => parseAmexCsv(bank)).toThrow(/American Express/i)
  })

  it('maps a positive amount to amount_out and a purchase to pending', () => {
    const rows = parseAmexCsv(amexBuffer([
      "16/04/2026,AMZNMKTPLACE,MR P PITCHER,-71001,261.99,,AMZNMKTPLACE,1 PLACE,LONDON,EC2A 2BA,UK,'AT261060074000010265389',General Purchases-Online Purchases",
    ]))
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.amountOut).toBe(261.99)
    expect(row.amountIn).toBeNull()
    expect(row.sourceType).toBe('amex')
    expect(row.status).toBe('pending')
    expect(row.receiptRequired).toBe(true)
    expect(row.cardMember).toBe('Mr P Pitcher')
    expect(row.cardAccount).toBe('71001')
    expect(row.merchantCategory).toBe('General Purchases-Online Purchases')
    expect(row.merchantTown).toBe('LONDON')
    expect(row.externalReference).toBe('AT261060074000010265389')
    expect(row.transactionDate).toBe('2026-04-16')
  })

  it('maps a negative payment to amount_in and no_receipt_required', () => {
    const rows = parseAmexCsv(amexBuffer([
      "31/05/2026,PAYMENT RECEIVED - THANK YOU,MR P PITCHER,-71001,-2358.05,,PAYMENT RECEIVED,,,,,'100000',",
    ]))
    expect(rows[0].amountIn).toBe(2358.05)
    expect(rows[0].amountOut).toBeNull()
    expect(rows[0].status).toBe('no_receipt_required')
    expect(rows[0].receiptRequired).toBe(false)
    expect(rows[0].vendorName).toBe('American Express')
    expect(rows[0].expenseCategory).toBeNull()
  })

  it('routes interest/fee rows to Bank Charges with import source', () => {
    const rows = parseAmexCsv(amexBuffer([
      "19/06/2026,INTEREST CHARGE,MR P PITCHER,-71001,17.02,,INTEREST CHARGE,,,,,'100001',",
      "14/05/2026,LATE PAYMENT FEE,MR P PITCHER,-71001,12.00,,LATE PAYMENT FEE,,,,,'100002',",
      "19/04/2026,MEMBERSHIP FEE,MR P PITCHER,-71001,250.00,,MEMBERSHIP FEE,,,,,'100003',",
    ]))
    for (const row of rows) {
      expect(row.status).toBe('no_receipt_required')
      expect(row.receiptRequired).toBe(false)
      expect(row.expenseCategory).toBe('Bank Charges/Credit Card Commission')
      expect(row.expenseCategorySource).toBe('import')
      expect(row.vendorName).toBe('American Express')
    }
  })

  it('treats a credit-for/refund as no_receipt_required with no category', () => {
    const rows = parseAmexCsv(amexBuffer([
      "26/05/2026,CREDIT FOR INTEREST CHARGE,MR P PITCHER,-71001,-0.08,,CREDIT,,,,,'100004',",
    ]))
    expect(rows[0].status).toBe('no_receipt_required')
    expect(rows[0].amountIn).toBe(0.08)
    expect(rows[0].expenseCategory).toBeNull()
  })

  it('is idempotent: identical rows hash identically', () => {
    const line = "16/04/2026,AMZNMKTPLACE,MR P PITCHER,-71001,261.99,,AMZN,1 PLACE,LONDON,EC2A 2BA,UK,'AT261060074000010265389',General Purchases-Online Purchases"
    const a = parseAmexCsv(amexBuffer([line]))[0]
    const b = parseAmexCsv(amexBuffer([line]))[0]
    expect(a.dedupeHash).toBe(b.dedupeHash)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/services/receipts/receiptHelpers.amex.test.ts -t parseAmexCsv`
Expected: FAIL — `parseAmexCsv` not exported.

- [ ] **Step 3: Implement** (add to `receiptHelpers.ts`; import `AmexCsvRow` from `./types` — merge into existing type import)

```ts
const AMEX_VENDOR = 'American Express'
const AMEX_FEE_CATEGORY: ReceiptExpenseCategory = 'Bank Charges/Credit Card Commission'

function toTitleCase(value: string): string {
  return value.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase())
}

type AmexClassification = Pick<
  ParsedTransactionRow,
  'status' | 'receiptRequired' | 'expenseCategory' | 'expenseCategorySource' | 'vendorName' | 'vendorSource'
>

function classifyAmexRow(details: string, signedAmount: number): AmexClassification {
  const upper = details.toUpperCase()
  const isPayment = upper.includes('PAYMENT RECEIVED') || upper.startsWith('CREDIT FOR')
  const isFee =
    upper.includes('INTEREST CHARGE') ||
    upper.includes('MEMBERSHIP FEE') ||
    upper.includes('LATE PAYMENT FEE') ||
    /\bFEE\b/.test(upper)

  if (isPayment) {
    return {
      status: 'no_receipt_required',
      receiptRequired: false,
      expenseCategory: null,
      expenseCategorySource: null,
      vendorName: AMEX_VENDOR,
      vendorSource: 'import',
    }
  }
  if (isFee) {
    return {
      status: 'no_receipt_required',
      receiptRequired: false,
      expenseCategory: AMEX_FEE_CATEGORY,
      expenseCategorySource: 'import',
      vendorName: AMEX_VENDOR,
      vendorSource: 'import',
    }
  }
  if (signedAmount < 0) {
    // Merchant refund / other credit — not a purchase to chase.
    return {
      status: 'no_receipt_required',
      receiptRequired: false,
      expenseCategory: null,
      expenseCategorySource: null,
      vendorName: null,
      vendorSource: null,
    }
  }
  // Genuine spend — vendor/expense left for the rules + AI pass.
  return {
    status: 'pending',
    receiptRequired: true,
    expenseCategory: null,
    expenseCategorySource: null,
    vendorName: null,
    vendorSource: null,
  }
}

export function parseAmexCsv(buffer: Buffer): ParsedTransactionRow[] {
  const csvText = buffer.toString('utf-8')
  const parsed = Papa.parse<AmexCsvRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })

  if (parsed.errors.length) {
    console.warn('Amex CSV parsing encountered issues:', parsed.errors.slice(0, 3))
  }

  const fields = parsed.meta.fields ?? []
  if (!fields.includes('Card Member') || !fields.includes('Amount')) {
    throw new Error(
      "This doesn't look like an American Express statement — expected 'Card Member' and 'Amount' columns.",
    )
  }

  const records = parsed.data.filter((record) => record && Object.keys(record).length > 0)
  const rows: ParsedTransactionRow[] = []

  for (const record of records) {
    const details = sanitizeText(record.Description || record['Appears On Your Statement As'] || '')
    if (!details) continue

    const transactionDate = record.Date ? normaliseDate(record.Date) : null
    if (!transactionDate) continue

    const signedAmount = parseSignedAmount(record.Amount)
    if (signedAmount == null) continue

    const amountOut = signedAmount > 0 ? Number(signedAmount.toFixed(2)) : null
    const amountIn = signedAmount < 0 ? Number(Math.abs(signedAmount).toFixed(2)) : null

    const rawCardMember = sanitizeText(record['Card Member'] || '') || null
    const cardMember = rawCardMember ? toTitleCase(rawCardMember) : null
    const cardAccount = (record['Account #'] || '').replace(/[^0-9]/g, '') || null
    const merchantCategory = sanitizeText(record.Category || '') || null
    const merchantTown = sanitizeText(record['Town/City'] || '') || null
    const externalReference = (record.Reference || '').replace(/^'+|'+$/g, '').trim() || null

    const classification = classifyAmexRow(details, signedAmount)

    rows.push({
      transactionDate,
      details,
      transactionType: null,
      amountIn,
      amountOut,
      balance: null,
      dedupeHash: createAmexTransactionHash({
        transactionDate,
        signedAmount,
        cardAccount,
        rawCardMember,
        externalReference,
      }),
      sourceType: 'amex',
      cardMember,
      cardAccount,
      merchantCategory,
      merchantTown,
      externalReference,
      ...classification,
    })
  }

  return rows
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/services/receipts/receiptHelpers.amex.test.ts`
Expected: PASS (all parseAmexCsv tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect no new errors).

```bash
git add src/services/receipts/receiptHelpers.ts src/services/receipts/receiptHelpers.amex.test.ts
git commit -m "feat(receipts): parseAmexCsv with non-purchase classification"
```

---

## Task 6: Bank-path header guard (reliable toggle)

**Files:**
- Modify: `src/services/receipts/receiptHelpers.ts` (`parseCsv`, ~182-233)
- Test: `src/services/receipts/receiptHelpers.test.ts` (existing) or the amex test file

- [ ] **Step 1: Add the failing test** (append to `receiptHelpers.amex.test.ts`)

```ts
import { parseCsv } from './receiptHelpers'

describe('parseCsv header guard', () => {
  it('throws when an Amex CSV is uploaded under the bank toggle', () => {
    const amex = Buffer.from(
      "Date,Description,Card Member,Account #,Amount\n16/04/2026,X,MR P,-71001,1.00",
      'utf-8',
    )
    expect(() => parseCsv(amex)).toThrow(/bank statement/i)
  })

  it('still parses a valid bank CSV', () => {
    const bank = Buffer.from(
      'Date,Details,Transaction Type,In,Out,Balance\n01/01/2026,TEST,Card,1.50,,10.00',
      'utf-8',
    )
    const rows = parseCsv(bank)
    expect(rows).toHaveLength(1)
    expect(rows[0].amountIn).toBe(1.5)
  })
})
```

- [ ] **Step 2: Run to verify the first test fails**

Run: `npx vitest run src/services/receipts/receiptHelpers.amex.test.ts -t "header guard"`
Expected: FAIL — `parseCsv` does not throw on the Amex buffer.

- [ ] **Step 3: Implement the guard**

In `parseCsv`, immediately after the `if (parsed.errors.length) { ... }` block and before `const records = ...`, add:

```ts
  const fields = parsed.meta.fields ?? []
  const hasDetails = fields.includes('Details')
  const hasAmountColumn = fields.includes('In') || fields.includes('Out')
  if (!hasDetails || !hasAmountColumn) {
    throw new Error(
      "This doesn't look like a bank statement CSV — expected 'Details' and 'In'/'Out' columns.",
    )
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/services/receipts/receiptHelpers.amex.test.ts -t "header guard"`
Expected: PASS, and the existing `receiptHelpers.test.ts` still passes:
Run: `npx vitest run src/services/receipts/receiptHelpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/receipts/receiptHelpers.ts src/services/receipts/receiptHelpers.amex.test.ts
git commit -m "feat(receipts): validate bank CSV headers so the source toggle is reliable"
```

---

## Task 7: Import service — branch, duplicate-file guard, per-row columns, per-row log status

**Files:**
- Modify: `src/services/receipts/receiptMutations.ts` (`performImportReceiptStatement`, ~607-751)

> This task changes a DB-coupled function; we verify by typecheck + the action test in Task 8 and the manual run in Task 19. Keep the diff surgical.

- [ ] **Step 1: Change the signature**

```ts
export async function performImportReceiptStatement(
  userId: string,
  userEmail: string,
  receiptFile: File,
  buffer: Buffer,
  sourceType: ReceiptSourceType = 'bank'
): Promise<{
  success?: boolean
  error?: string
  inserted?: number
  skipped?: number
  autoApplied?: number
  autoClassified?: number
  batch?: any
  warning?: string
}> {
```

Add `ReceiptSourceType` to the existing `@/types/database` import in this file, and `parseAmexCsv` to the existing `./receiptHelpers` import.

- [ ] **Step 2: Replace the parse + add the duplicate-file guard**

Replace the opening:

```ts
  const rows = parseCsv(buffer)

  if (!rows.length) {
    return { error: 'No valid transactions found in the CSV file.' }
  }

  const supabase = createAdminClient()
```

with:

```ts
  let rows: ParsedTransactionRow[]
  try {
    rows = sourceType === 'amex' ? parseAmexCsv(buffer) : parseCsv(buffer)
  } catch (parseError) {
    return {
      error: parseError instanceof Error ? parseError.message : 'Could not read the CSV file.',
    }
  }

  if (!rows.length) {
    return { error: 'No valid transactions found in the CSV file.' }
  }

  const supabase = createAdminClient()

  const sourceHash = createHash('sha256').update(buffer).digest('hex')
  const { data: existingBatch } = await supabase
    .from('receipt_batches')
    .select('id')
    .eq('source_hash', sourceHash)
    .maybeSingle()

  if (existingBatch) {
    return {
      success: true,
      inserted: 0,
      skipped: rows.length,
      autoApplied: 0,
      autoClassified: 0,
      batch: existingBatch,
      warning: 'This file has already been imported.',
    }
  }
```

Import `ParsedTransactionRow` from `./types` in this file if not already imported.

- [ ] **Step 3: Add `source_type` + reuse `sourceHash` in the batch insert**

Change the `receipt_batches` insert object to:

```ts
    .insert({
      original_filename: receiptFile.name,
      source_hash: sourceHash,
      source_type: sourceType,
      row_count: rows.length,
      uploaded_by: userId,
    })
```

- [ ] **Step 4: Map the new per-row columns in the payload**

Replace the `payload` map with:

```ts
  const payload = rows.map((row) => ({
    batch_id: batch.id,
    source_type: row.sourceType ?? 'bank',
    transaction_date: row.transactionDate,
    details: row.details,
    transaction_type: row.transactionType,
    amount_in: row.amountIn,
    amount_out: row.amountOut,
    balance: row.balance,
    dedupe_hash: row.dedupeHash,
    status: (row.status ?? 'pending') satisfies ReceiptTransaction['status'],
    receipt_required: row.receiptRequired ?? true,
    card_member: row.cardMember ?? null,
    card_account: row.cardAccount ?? null,
    merchant_category: row.merchantCategory ?? null,
    merchant_town: row.merchantTown ?? null,
    external_reference: row.externalReference ?? null,
    vendor_name: row.vendorName ?? null,
    vendor_source: row.vendorSource ?? null,
    expense_category: row.expenseCategory ?? null,
    expense_category_source: row.expenseCategorySource ?? null,
    marked_by: null,
    marked_by_email: null,
    marked_by_name: null,
    marked_at: null,
    marked_method: null,
    rule_applied_id: null,
    notes: null,
    created_at: now,
    updated_at: now,
  }))
```

- [ ] **Step 5: Use the real per-row status in the import logs**

Replace the import-logs block. The upsert already does `.select('id, status')` into `inserted`; use it:

```ts
  if (inserted && inserted.length) {
    const logs = inserted.map<Omit<ReceiptTransactionLog, 'id'>>((row) => ({
      transaction_id: row.id,
      previous_status: null,
      new_status: row.status,
      action_type: 'import',
      note: `Imported via ${receiptFile.name}`,
      performed_by: userId,
      rule_id: null,
      performed_at: now,
    }))

    const { error: importLogError } = await supabase.from('receipt_transaction_logs').insert(logs)
    if (importLogError) {
      console.error('Failed to record import transaction logs', importLogError)
    }
  }
```

> Leave the `applyAutomationRules`, `enqueueReceiptAiClassificationJobs`,
> `enqueueReceiptSystemJob('reconcile_receipt_invoice_payments', ...)`, and
> `enqueueReceiptSystemJob('refresh_receipt_duplicate_candidates', ...)` calls EXACTLY as
> they are. Do not remove or reorder them.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (`inserted` is `{ id, status }[]`; `row.status` is the status enum.)

- [ ] **Step 7: Commit**

```bash
git add src/services/receipts/receiptMutations.ts
git commit -m "feat(receipts): branch import on sourceType, dedup-file guard, per-row status/columns"
```

---

## Task 8: Server action — accept `sourceType`, audit it, extend filters

**Files:**
- Modify: `src/app/actions/receipts.ts` (`importReceiptStatement` ~422-458)
- Test: `tests/actions/receipts.amexImport.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/actions/receipts.amexImport.test.ts`. Mirror the mocking style already used in `tests/actions/receipts.test.ts` (open that file first and copy its `vi.mock(...)` setup for `@/app/actions/rbac`, `@/services/receipts/receiptMutations`, `@/lib/audit`/`logAuditEvent`, and `requireCurrentUser`). The behavioural assertions to add:

```ts
// (after copying the established mocks from tests/actions/receipts.test.ts)
import { describe, expect, it, vi, beforeEach } from 'vitest'

describe('importReceiptStatement sourceType', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes sourceType=amex through to the service', async () => {
    const { importReceiptStatement } = await import('@/app/actions/receipts')
    const { performImportReceiptStatement } = await import('@/services/receipts/receiptMutations')
    ;(performImportReceiptStatement as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true, inserted: 1, skipped: 0, batch: { id: 'b1' },
    })

    const fd = new FormData()
    fd.append('statement', new File(['Date,Description,Card Member,Account #,Amount\n'], 'amex.csv', { type: 'text/csv' }))
    fd.append('sourceType', 'amex')

    await importReceiptStatement(fd)

    expect(performImportReceiptStatement).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), expect.any(File), expect.any(Buffer), 'amex',
    )
  })

  it('defaults to bank when sourceType is missing', async () => {
    const { importReceiptStatement } = await import('@/app/actions/receipts')
    const { performImportReceiptStatement } = await import('@/services/receipts/receiptMutations')
    ;(performImportReceiptStatement as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, batch: { id: 'b' } })

    const fd = new FormData()
    fd.append('statement', new File(['Date,Details,In,Out\n'], 'bank.csv', { type: 'text/csv' }))

    await importReceiptStatement(fd)
    expect(performImportReceiptStatement).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), expect.any(File), expect.any(Buffer), 'bank',
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/actions/receipts.amexImport.test.ts`
Expected: FAIL — the 5th arg is `undefined` (sourceType not yet wired).

- [ ] **Step 3: Implement**

Add to the top imports in `src/app/actions/receipts.ts`:

```ts
import { receiptSourceTypeSchema } from '@/lib/validation'
```

In `importReceiptStatement`, after the `fileSchema` check and before computing `buffer`, add:

```ts
  const sourceTypeRaw = formData.get('sourceType')
  const sourceType = receiptSourceTypeSchema
    .catch('bank')
    .parse(typeof sourceTypeRaw === 'string' ? sourceTypeRaw : 'bank')
```

Change the service call to pass it:

```ts
  const result = await performImportReceiptStatement(user_id, user_email, receiptFile, buffer, sourceType)
```

Add `source_type` to the audit `additional_info`:

```ts
      additional_info: {
        filename: receiptFile.name,
        source_type: sourceType,
        inserted: result.inserted,
        skipped: result.skipped,
        auto_applied: result.autoApplied,
        auto_classified: result.autoClassified,
      },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/actions/receipts.amexImport.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/receipts.ts tests/actions/receipts.amexImport.test.ts
git commit -m "feat(receipts): action accepts sourceType, audits it"
```

---

## Task 9: Queries — source/cardholder filters + `availableCardMembers`

**Files:**
- Modify: `src/services/receipts/receiptQueries.ts` (filter block ~259-301; the workspace-data assembly + `ReceiptWorkspaceData` type)
- Modify: `src/services/receipts/types.ts` (`ReceiptWorkspaceData`)

- [ ] **Step 1: Add the filters** — in the filter block, after the `filters.search` block, add:

```ts
  if (filters.sourceType && filters.sourceType !== 'all') {
    baseQuery = baseQuery.eq('source_type', filters.sourceType)
  }

  if (filters.cardMember) {
    baseQuery = baseQuery.eq('card_member', filters.cardMember)
  }
```

- [ ] **Step 2: Compute `availableCardMembers`** — find where `availableMonths` is built in `queryReceiptWorkspaceData` and add alongside it:

```ts
  const { data: cardMemberRows } = await supabase
    .from('receipt_transactions')
    .select('card_member')
    .eq('source_type', 'amex')
    .not('card_member', 'is', null)

  const availableCardMembers = Array.from(
    new Set((cardMemberRows ?? []).map((row) => row.card_member).filter((value): value is string => Boolean(value))),
  ).sort((a, b) => a.localeCompare(b))
```

Add `availableCardMembers` to the returned `ReceiptWorkspaceData` object (next to `availableMonths`).

- [ ] **Step 3: Extend the type** — in `src/services/receipts/types.ts`, add to `ReceiptWorkspaceData`:

```ts
  availableCardMembers: string[]
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: error(s) only where `ReceiptWorkspaceData` is constructed without `availableCardMembers` — fix by adding the field (Step 2). No other new errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/receipts/receiptQueries.ts src/services/receipts/types.ts
git commit -m "feat(receipts): source/cardholder filters and availableCardMembers"
```

---

## Task 10: Page — parse `source` + `cardMember` params, pass `availableCardMembers`

**Files:**
- Modify: `src/app/(authenticated)/receipts/page.tsx`

- [ ] **Step 1: Add the parsing** — near the other `resolvedParams` reads, add:

```ts
  const rawSource = typeof resolvedParams?.source === 'string' ? resolvedParams.source : undefined
  const sourceType = rawSource === 'bank' || rawSource === 'amex' ? rawSource : 'all'

  const cardMember = typeof resolvedParams?.cardMember === 'string' ? resolvedParams.cardMember : undefined
```

- [ ] **Step 2: Thread into `filters`** — add to the `filters` object:

```ts
    sourceType: sourceType !== 'all' ? sourceType : undefined,
    cardMember: cardMember || undefined,
```

- [ ] **Step 3: Pass to the client** — add to the `<ReceiptsClient ... initialFilters={{ ... }}>` props:

```tsx
        availableCardMembers={data.availableCardMembers}
```

and inside `initialFilters`:

```tsx
          sourceType,
          cardMember: cardMember ?? '',
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in `ReceiptsClient`/`ReceiptFilters` prop types until Tasks 11–13 land. Note them; proceed.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(authenticated)/receipts/page.tsx"
git commit -m "feat(receipts): parse source/cardMember URL params"
```

---

## Task 11: Upload — Bank/Amex toggle

**Files:**
- Modify: `src/app/(authenticated)/receipts/_components/ui/ReceiptUpload.tsx`

- [ ] **Step 1: Add state + Select** — add `Select` to the `@/ds` import, a state field, and render the toggle above the file `Input`:

```tsx
  const [sourceType, setSourceType] = useState<'bank' | 'amex'>('bank')
```

In the form, before the file `<Input ...>`:

```tsx
          <Select
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value as 'bank' | 'amex')}
            options={[
              { value: 'bank', label: 'Bank statement' },
              { value: 'amex', label: 'American Express statement' },
            ]}
          />
```

> Match the `Select` API used in `ReceiptFilters.tsx` (it passes `options`/`value`/`onChange`). If that component instead renders `<option>` children, mirror that shape here.

- [ ] **Step 2: Append to FormData** — in `handleStatementSubmit`, after `formData.append('statement', statementFile)`:

```ts
    formData.append('sourceType', sourceType)
```

- [ ] **Step 3: Build + manual check** — covered by Task 19. Typecheck now:

Run: `npx tsc --noEmit` (expect no new errors from this file).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(authenticated)/receipts/_components/ui/ReceiptUpload.tsx"
git commit -m "feat(receipts): Bank/Amex source toggle on upload"
```

---

## Task 12: ReceiptsClient — thread source filter state + `availableCardMembers`

**Files:**
- Modify: `src/app/(authenticated)/receipts/_components/ReceiptsClient.tsx`

- [ ] **Step 1: Extend props** — open the file, find the props interface and `initialFilters` shape. Add to the props:

```ts
  availableCardMembers: string[]
```

Add to the `initialFilters` type and initial state: `sourceType: 'bank' | 'amex' | 'all'` and `cardMember: string`.

- [ ] **Step 2: Pass through to `ReceiptFilters`** — where `<ReceiptFilters ... />` is rendered, add:

```tsx
        availableCardMembers={availableCardMembers}
```

and include `sourceType` + `cardMember` in the `filters` object passed to it (mirror how `month`/`search` are already threaded).

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` (errors now only in `ReceiptFilters` until Task 13).

```bash
git add "src/app/(authenticated)/receipts/_components/ReceiptsClient.tsx"
git commit -m "feat(receipts): thread source/cardholder filter state"
```

---

## Task 13: ReceiptFilters — Source + Cardholder controls

**Files:**
- Modify: `src/app/(authenticated)/receipts/_components/ui/ReceiptFilters.tsx`

- [ ] **Step 1: Extend props**

```ts
  filters: {
    status: ReceiptWorkspaceFilters['status'] | 'all'
    direction: 'in' | 'out' | 'all'
    sourceType: 'bank' | 'amex' | 'all'
    cardMember: string
    showOnlyOutstanding: boolean
    groupByVendor: boolean
    missingVendorOnly: boolean
    missingExpenseOnly: boolean
    search: string
    month?: string
  }
  availableMonths: string[]
  availableCardMembers: string[]
```

- [ ] **Step 2: Add option lists** (next to `statusOptions`/`directionOptions`):

```ts
  const sourceOptions = useMemo(() => ([
    { value: 'all', label: 'All sources' },
    { value: 'bank', label: 'Bank' },
    { value: 'amex', label: 'Amex' },
  ]), [])

  const cardMemberOptions = useMemo(() => ([
    { value: '', label: 'All cardholders' },
    ...availableCardMembers.map((name) => ({ value: name, label: name })),
  ]), [availableCardMembers])
```

- [ ] **Step 3: Render the controls** — beside the existing Source/direction selects, add a Source `Select` bound to `source` and (conditionally) a Cardholder `Select` bound to `cardMember`. Follow the existing pattern where a select change pushes a URL param via the router. Concretely, mirror the existing `direction` select's onChange handler but write to the `source` / `cardMember` query params:

```tsx
        <Select
          value={filters.sourceType}
          onChange={(event) => updateParam('source', event.target.value === 'all' ? null : event.target.value)}
          options={sourceOptions}
        />
        {availableCardMembers.length > 0 && (
          <Select
            value={filters.cardMember}
            onChange={(event) => updateParam('cardMember', event.target.value || null)}
            options={cardMemberOptions}
          />
        )}
```

> Use whatever the existing param-update mechanism is named in this file (e.g. a helper that sets/clears a search param and calls `router.push`). Reuse it — do not invent a new navigation pattern.

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit` (expect clean for the filter chain now).

```bash
git add "src/app/(authenticated)/receipts/_components/ui/ReceiptFilters.tsx"
git commit -m "feat(receipts): Source + Cardholder filter controls"
```

---

## Task 14: Row badges — Bank vs Amex + cardholder

**Files:**
- Modify: `src/app/(authenticated)/receipts/_components/ui/ReceiptTableRow.tsx`
- Modify: `src/app/(authenticated)/receipts/_components/ui/ReceiptMobileCard.tsx`

- [ ] **Step 1: Add a shared SourceBadge** — in `ReceiptTableRow.tsx`, beside the existing `ClassificationBadge`, add (and `export` it so the mobile card reuses it):

```tsx
export function SourceBadge({ sourceType }: { sourceType: ReceiptTransaction['source_type'] }) {
  const isAmex = sourceType === 'amex'
  const className = isAmex
    ? 'bg-blue-50 text-blue-700 border-blue-100'
    : 'bg-gray-100 text-gray-600 border-gray-200'
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${className}`}>
      {isAmex ? 'Amex' : 'Bank'}
    </span>
  )
}
```

- [ ] **Step 2: Render it in the desktop row** — in the Details cell, render `<SourceBadge sourceType={transaction.source_type} />` next to the details text, and for Amex show the cardholder:

```tsx
        {transaction.source_type === 'amex' && transaction.card_member && (
          <span className="text-xs text-text-muted">{transaction.card_member}</span>
        )}
```

- [ ] **Step 3: Render it in the mobile card** — import `SourceBadge` from `./ReceiptTableRow` and show it next to the date/details, plus the cardholder line for Amex (same conditional as Step 2).

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit` (expect no new errors).

```bash
git add "src/app/(authenticated)/receipts/_components/ui/ReceiptTableRow.tsx" "src/app/(authenticated)/receipts/_components/ui/ReceiptMobileCard.tsx"
git commit -m "feat(receipts): source badge + cardholder on rows"
```

---

## Task 15: Export — Source + Cardholder columns

**Files:**
- Investigate then modify: `src/app/(authenticated)/receipts/_components/ui/ReceiptExport.tsx` and its server action / lib (search for the export route/lib that builds the CSV/PDF, e.g. `grep -rn "receipt" src/app/api | grep -i export` and the export action used by `ReceiptExport`).

- [ ] **Step 1: Find the export data builder**

Run: `grep -rniE "export" src/services/receipts src/app/api 2>/dev/null | grep -i receipt | grep -iE "csv|export|pnl"`
Identify the function that assembles export rows and the column header list.

- [ ] **Step 2: Add columns** — in the row mapper, add `source_type` (label "Source": `Bank`/`Amex`) and `card_member` (label "Cardholder") to both the header array and each row. Keep existing columns/order; append the two new columns at the end so existing consumers don't break.

- [ ] **Step 3: Typecheck + (if a test exists) run it**

Run: `npx tsc --noEmit`
Run: `npx vitest run tests/lib/receiptExportDefaultPeriod.test.ts tests/api/receipts-export.test.ts`
Expected: PASS (update snapshots/assertions if they pin the exact column set — add the two new columns).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(receipts): add Source + Cardholder columns to export"
```

---

## Task 16: Duplicate-candidate detection — make it source-aware

**Files:**
- Investigate: the `refresh_receipt_duplicate_candidates` job handler and the query/RPC it runs.

- [ ] **Step 1: Locate the logic**

Run: `grep -rniE "refresh_receipt_duplicate_candidates|duplicate_candidate|receipt_duplicate" src supabase/migrations | head -40`
Determine whether candidates are built in TS (a service function) or SQL (an RPC / migration function).

- [ ] **Step 2: Add the source predicate**

- If **TS**: in the candidate query, add `source_type` to the grouping/match keys so two rows only pair when `source_type` matches (or explicitly skip pairs whose `source_type` differs).
- If **SQL**: add `AND a.source_type = b.source_type` to the self-join / matching predicate, and ship the change as part of the Task 1 migration (or a sibling migration with a later timestamp). Re-run `npx supabase db push --dry-run`.

- [ ] **Step 3: Test**

If a duplicate-detection test exists (`grep -rni "duplicate" tests`), extend it with a bank+Amex same-date/amount pair and assert they are NOT flagged. Otherwise add a focused test for the TS path.

Run: `npx vitest run <the relevant test>`
Expected: PASS — cross-source rows are not duplicates.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix(receipts): duplicate detection ignores cross-source matches"
```

---

## Task 17: AI classification — pass Amex merchant hints

**Files:**
- Modify: `src/lib/receipts/ai-classification.ts` (batch input builder)

- [ ] **Step 1: Locate the batch input mapping** — find where each transaction is turned into the model input (details, amount, direction, type).

- [ ] **Step 2: Add hints for Amex rows** — when `transaction.source_type === 'amex'`, include `transaction.merchant_category` and `transaction.merchant_town` in the per-transaction context object/string passed to the model (additive field, e.g. `merchantHint: [merchant_category, merchant_town].filter(Boolean).join(' · ')`). Bank rows unchanged.

- [ ] **Step 3: Typecheck + existing AI test**

Run: `npx tsc --noEmit`
Run: `npx vitest run tests/lib/receipt-ai-classification.test.ts`
Expected: PASS (update the test if it asserts the exact input shape — include the new optional hint).

- [ ] **Step 4: Commit**

```bash
git add src/lib/receipts/ai-classification.ts tests/lib/receipt-ai-classification.test.ts
git commit -m "feat(receipts): feed Amex merchant category/town into AI classification"
```

---

## Task 18: P&L — avoid double-counting bank→Amex payments

**Files:**
- Investigate: `src/app/(authenticated)/receipts/pnl/*` and its data query.

- [ ] **Step 1: Determine whether bank Amex-payment lines are in scope**

Run: `grep -rniE "pnl|profit" src/services/receipts src/app/(authenticated)/receipts/pnl | head -30`
Read the aggregation. Establish: does P&L sum raw outgoing (`amount_out`) regardless of category, or does it key off `expense_category`?

- [ ] **Step 2: Decide + act (gated on the OPEN question in the spec)**

- If P&L keys off **expense categories** and a bank payment to Amex has no expense category (or is `no_receipt_required`), it is already excluded → **no code change**; just note it in the PR.
- If P&L sums **raw `amount_out`**, add a rule/handling so bank lines whose `details` match `AMERICAN EXPRESS`/`AMEX` are excluded from expense totals (e.g. treat as a transfer / `no_receipt_required`). Implement the smallest exclusion that fits the existing aggregation.
- If the bank account is **not** imported into receipts at all, there is no double-count → **no change**; note it.

> This task has a user-facing decision flagged in the spec's "Affected downstream paths". If Step 1 shows raw-outflow summing AND bank Amex payments are present, confirm the exclusion approach with the user before implementing.

- [ ] **Step 3: Test (only if code changed)** — add/extend a P&L test asserting a bank "AMERICAN EXPRESS" payment is excluded from expense totals.

Run: `npx vitest run <pnl test>`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix(receipts): prevent Amex payment double-count in P&L"
```

---

## Task 19: Full verification + real-CSV smoke test

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all pass (new + existing).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: zero warnings. (Watch for `no-console` — only `console.warn`/`console.error` allowed.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors versus `main`.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Real-CSV smoke test** — write a throwaway script under the scratchpad that imports the three sample CSVs through `parseAmexCsv` and prints counts by status + a couple of sample rows, to confirm row counts and classifications against the real files:
  - `~/Library/Mobile Documents/com~apple~CloudDocs/Downloads/activity.csv`
  - `~/Library/Mobile Documents/com~apple~CloudDocs/Downloads/activity (1).csv`
  - `~/Library/Mobile Documents/com~apple~CloudDocs/Downloads/activity (2).csv`

Run it with `npx tsx <script>`. Expected: every purchase row `pending`; every PAYMENT/CREDIT row `no_receipt_required` with `amount_in` set; INTEREST/MEMBERSHIP/LATE FEE rows `no_receipt_required` + `Bank Charges/Credit Card Commission`. Delete the script after.

- [ ] **Step 6: Apply the migration to the live DB** (when ready to deploy)

Run: `npx supabase db push`
Expected: the new columns/indexes apply cleanly.

- [ ] **Step 7: Final commit / hand to /fix-function**

The feature is implemented. Next: run `/fix-function` on `/receipts` for the full audit pass the user requested, then open the PR.

---

## Self-review notes (author)

- **Spec coverage:** every spec section maps to a task — migration (T1), types/validation (T2), parser+hash+signed amount (T3–T5), bank guard (T6), import service incl. dup-guard/per-row status/preserved jobs (T7), action (T8), queries+contract (T9), page/client/filters/badges (T10–T14), export (T15), duplicate-candidate source-awareness (T16), AI hints (T17), P&L double-count (T18), verification incl. real CSVs (T19).
- **Type consistency:** `ReceiptSourceType`, `parseSignedAmount`, `createAmexTransactionHash`, `parseAmexCsv`, `availableCardMembers`, `source_type`/`card_member` column names are used identically across tasks.
- **Investigate-then-edit tasks** (T15–T18) intentionally start with a `grep` because the exact files were not all enumerated in discovery; each still specifies the concrete change and a verification command, not a placeholder.
