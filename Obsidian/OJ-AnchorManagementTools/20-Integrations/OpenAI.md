---
title: OpenAI
aliases:
  - AI Classification
  - GPT Integration
  - Transaction Classification
tags:
  - type/reference
  - integration/openai
  - status/active
integration: openai
created: 2026-03-14
updated: 2026-03-14
---

← [[Integrations MOC]]

## Overview

OpenAI is used exclusively by the [[Receipts]] module to classify raw bank transaction descriptions into vendor names and expense categories. This replaces manual categorisation for imported bank statements.

## Environment Variables

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Secret key for the OpenAI API |

## Library Files

| File | Purpose |
|---|---|
| `src/lib/openai.ts` | Low-level OpenAI API client configuration |
| `src/lib/receipts/ai-classification.ts` | Classification logic, prompt construction, result parsing |

## Model

**GPT-4o-mini** — selected for cost efficiency on high-volume transaction classification. The classification task does not require frontier model capability; speed and cost per token are the primary concerns.

## What the AI Classifies

Given a raw bank transaction description (e.g. `SPOTIFY AB 123456`), the model returns:

| Output Field | Example | Notes |
|---|---|---|
| Vendor name | `Spotify` | Cleaned, human-readable |
| Expense category | `Software Subscriptions` | Maps to the venue's chart of accounts |
| Confidence score | `0.94` | 0–1 float; low scores flagged for manual review |
| Suggested keyword rules | `["SPOTIFY"]` | Proposed pattern for the rules engine |

Few-shot examples are included in the prompt to anchor output format and improve category accuracy for hospitality-specific vendors.

## Classification Flow

```
Import CSV
  → Parse transactions
  → For each unclassified transaction:
      → Check manual rules engine (if match → skip AI)
      → Call OpenAI GPT-4o-mini
      → Parse and validate response
      → Store result in receipt_transaction_log
      → User can review and override
```

> [!NOTE] Manual rules take priority
> If a transaction matches a user-defined keyword rule (e.g. all transactions containing "SPOTIFY" → Software Subscriptions), the AI call is skipped entirely. This reduces cost and improves consistency for known recurring vendors.

## Manual Rules Engine

Users can promote an AI suggestion (or create their own) into a permanent pattern → vendor/category rule. On subsequent imports, matching transactions bypass the AI entirely and are classified instantly.

This means AI call volume decreases over time as rules accumulate for recurring vendors.

## Cost & Usage Logging

Token usage and estimated cost are logged per transaction to `receipt_transaction_log`. This allows:
- Monthly AI spend tracking
- Identification of transactions that consistently require high token counts
- Audit trail of AI-generated classifications vs manual overrides

> [!TIP] Reviewing AI accuracy
> Staff can override any AI classification in the [[Receipts]] UI. Override events are stored alongside the original AI result, enabling future prompt tuning if accuracy degrades.

> [!WARNING] API key exposure
> `OPENAI_API_KEY` must never be included in client-side code or exposed via a public API route. All classification calls happen in server actions only.

## Used By

| Module | Purpose |
|---|---|
| [[Receipts]] | Bank transaction classification on CSV import |

This integration is not used by any other module.

## Related

- [[Receipts]]
- [[Integrations MOC]]
