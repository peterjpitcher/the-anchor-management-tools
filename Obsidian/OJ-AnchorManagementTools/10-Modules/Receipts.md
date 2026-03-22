---
title: Receipts
aliases:
  - Bank Transactions
  - Expense Classification
tags:
  - type/reference
  - module/receipts
  - status/active
module: receipts
route: /receipts
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# Receipts

The Receipts module handles bank transaction import and AI-powered expense classification. It provides a workflow for ingesting raw bank statement exports, automatically categorising transactions via OpenAI, and maintaining an auditable record of all financial activity.

---

## Permissions

| Permission | Description |
|---|---|
| `receipts.view` | View all transactions and classification results |
| `receipts.create` | Import new bank statement CSVs |
| `receipts.edit` | Override AI classifications and edit transaction details |
| `receipts.delete` | Remove transactions from the system |

---

## Key Features

### CSV Import

Bank statement CSV exports are uploaded directly in the UI. The importer parses each row, deduplicates against existing records by transaction reference, and queues new rows for classification.

### AI Classification

Each transaction description is sent to OpenAI GPT-4o-mini for classification. The model returns:

| Field | Description |
|---|---|
| Vendor name | Normalised merchant name extracted from the raw description |
| Expense category | Assigned category (e.g. Utilities, Supplies, Wages) |
| Confidence score | 0–1 float indicating model certainty |
| Suggested keyword rule | A pattern the user can save to auto-classify similar future transactions |

> [!NOTE]
> The AI classification uses few-shot examples embedded in the prompt to improve accuracy on venue-specific transaction patterns. Token usage and cost are logged per transaction for cost monitoring.

### Manual Rules Engine

Users can define pattern → vendor/category mappings. When a new transaction is imported and its description matches a saved rule, classification is applied automatically without an AI call.

> [!TIP]
> After accepting an AI suggestion, the system prompts the user to save a rule. Accepting this suggestion over time eliminates AI cost for recurring vendors.

### Manual Override

Any AI-assigned vendor or category can be overridden manually. All overrides are recorded in the audit trail.

### Receipt File Attachments

Receipt scans or PDFs can be uploaded and linked to individual transactions. Supported formats: PDF, PNG, JPG.

### Navigation Badge

An outstanding unprocessed count is displayed in the navigation badge, drawing attention to transactions that have not yet been reviewed or classified.

---

## Business Rules

> [!WARNING]
> AI classification is a suggestion only. All classifications must be reviewed by a staff member before the transaction is marked as processed. Never treat AI output as authoritative without human review.

---

## Database Tables

| Table | Purpose |
|---|---|
| `receipt_transactions` | Primary transaction records imported from bank statements |
| `receipt_rules` | User-defined pattern → vendor/category mapping rules |
| `receipt_files` | Uploaded receipt scans and PDFs linked to transactions |
| `receipt_transaction_log` | Audit trail of all status and category changes |

---

## Code Locations

| Path | Purpose |
|---|---|
| `src/services/receipts.ts` | Business logic service layer |
| `src/lib/receipts/ai-classification.ts` | OpenAI prompt construction, response parsing, confidence scoring |
| `src/lib/openai/` | Shared OpenAI client and token cost utilities |

---

## Integration: OpenAI

Classification calls are made via the shared [[OpenAI]] client. The model used is `gpt-4o-mini`. Prompt structure uses few-shot examples and returns structured JSON. Token usage is logged per call for cost attribution.

> [!NOTE]
> See [[OpenAI]] for API key configuration, rate limiting, and cost monitoring conventions used across the platform.

---

## Related

- [[Modules MOC]]
- [[OpenAI]]
- [[Cashing Up]]
- [[Settings]]
