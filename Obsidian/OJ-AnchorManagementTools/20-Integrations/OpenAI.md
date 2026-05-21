---
title: OpenAI
aliases:
  - AI Classification
  - GPT Integration
  - Transaction Classification
  - Event SEO Generation
tags:
  - type/reference
  - integration/openai
  - status/active
integration: openai
created: 2026-03-14
updated: 2026-05-21
---

← [[Integrations MOC]]

## Overview

OpenAI is used by multiple modules in AMS:

1. **[[Receipts]]** — classifies raw bank transaction descriptions into vendor names and expense categories
2. **[[Events]]** — generates SEO-optimised content (meta titles, descriptions, long descriptions, FAQs, keywords, alt text) for event pages

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
| [[Events]] | SEO content generation for event pages |

## Event SEO Content Generation

### Purpose

Generates complete SEO content packages for event pages, including meta title, meta description, short description, long description (450-650 words), highlights, FAQs, keywords, slug, and image alt text.

### Architecture: Facts-First Pipeline

The generation pipeline follows a facts-first approach where all verifiable data is extracted and validated before any OpenAI call:

1. **Facts Builder** (`src/lib/event-seo/generation.ts`) — `buildEventSeoFacts(input)` assembles a typed `EventSeoFacts` object from form data and/or database records, normalising keywords and deduplicating across tiers
2. **Preflight Check** (`preflightCheck(facts)`) — validates that minimum required fields are present (name, date, at least one primary keyword, at least one detail source). Returns hard errors that block generation and soft warnings that allow generation with caveats
3. **Prompt Construction** (`src/lib/event-seo/prompts.ts`) — `buildGenerationMessages(facts)` builds a two-message array (system + user). Static prompt sections (venue context, quality rubric, field rules, keyword placement rules) appear first for OpenAI prompt caching. Dynamic facts JSON is appended last
4. **Quality Gate** (`src/lib/seo-validation.ts`) — `validateGeneratedContent(parsed, options)` runs 30+ deterministic checks on the generated output (field lengths, keyword placement, formatting, filler phrases, FAQ structure)
5. **Deterministic Repair** (`applyDeterministicRepair(draft, facts)`) — code-level fixes (strip markdown, normalise slug, cap arrays, remove URLs/placeholders) that do not require an LLM call
6. **Retry** — if validation still fails after repair, a second OpenAI call with the failed draft and specific issues listed can attempt a targeted fix

### Model Configuration

| Variable | Purpose | Default |
|---|---|---|
| `OPENAI_EVENT_SEO_MODEL` | Model override for event SEO generation | Falls back to events model config |

### Library Files

| File | Purpose |
|---|---|
| `src/lib/event-seo/generation.ts` | Facts builder, preflight check, retry/timeout constants |
| `src/lib/event-seo/prompts.ts` | System role, static prompt sections, message builders |
| `src/lib/seo-validation.ts` | Quality gate (30+ checks), deterministic repair utilities |
| `src/app/actions/event-content.ts` | Server action orchestrating the full pipeline |

### Eval Harness

Golden test fixtures live in `tasks/fixtures/event-seo-generation/`. Run:

```bash
npm run eval:seo
```

This tests the deterministic pipeline (facts building, preflight, prompt construction) against 7 fixtures covering live music, quiz nights, food events, family events, comedy, missing-performer edge cases, and deliberately sparse input that should fail preflight.

## Related

- [[Receipts]]
- [[Integrations MOC]]
