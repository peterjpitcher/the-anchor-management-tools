**Findings**

- `SPEC-001` High: FAQ preservation is not specified. The spec adds FAQ generation and says `event_faqs` stays, but it never requires the edit flow to load, display, preserve, or explicitly overwrite existing FAQs. In current code, the edit page does not load `event_faqs` ([page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/[id]/edit/page.tsx:27)), the form never sends them ([EventFormGrouped.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/events/EventFormGrouped.tsx:126)), missing `faqs` becomes `[]` ([events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/events.ts:163)), and update SQL deletes all FAQs whenever `p_faqs IS NOT NULL` ([20260420000024_event_interest_audience_and_event_type.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260420000024_event_interest_audience_and_event_type.sql:63)).

- `SPEC-002` High: Section 7 points at the wrong type surface. The spec says to update [the spec file](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-11-event-seo-keyword-engine-design.md:325) `src/types/event.ts`, but the live app imports `Event` from [src/types/database.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.ts:3), and schema truth lives in [src/types/database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:2786). `src/types/event.ts` is stale legacy surface ([src/types/event.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/event.ts:13)).

- `SPEC-003` High: The API/backwards-compat story is overstated. The spec says new fields will be available “automatically” to the brand site ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-11-event-seo-keyword-engine-design.md:417)), but both `/api/events` and `/api/events/[id]` manually serialize responses ([route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/events/route.ts:142), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/events/[id]/route.ts:175)). Every new field needs explicit API mapping and test coverage.

- `SPEC-004` High: The spec introduces `social_copy_facebook`/`social_copy_whatsapp` without defining their relationship to existing promotion fields. The repo already has `facebook_event_name`, `facebook_event_description`, `gbp_event_title`, and `gbp_event_description` in the schema ([database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:2799)), and the current UI uses that split Facebook/GBP model ([EventPromotionContentCard.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/events/EventPromotionContentCard.tsx:71)). No source-of-truth, migration, or coexistence rule is defined.

- `SPEC-005` Medium: The spec says the brief is required for AI generation ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-11-event-seo-keyword-engine-design.md:135)) but never defines behavior when keywords exist and the brief is empty. Current UI only blocks generation when `name` is missing ([EventFormGrouped.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/events/EventFormGrouped.tsx:257)).

- `SPEC-006` Medium: The spec ignores the current stale-state risk from `DebouncedTextarea`. The component only propagates parent state after a 300ms timer and can overwrite fresher values later ([DebouncedTextarea.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/forms/DebouncedTextarea.tsx:18)). Save and generate both read parent state, not live textarea state ([EventFormGrouped.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/events/EventFormGrouped.tsx:126), [EventFormGrouped.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/events/EventFormGrouped.tsx:257)).

- `SPEC-007` Medium: Category cascading is specified as an extension of the current pattern, but the current pattern already has broken mappings. `prepareEventDataFromFormData()` still selects `event_categories.image_url` and `brief` ([events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/events.ts:65)), while generated category schema exposes `default_image_url` and no `brief` column ([database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:2337)). The spec also omits changes to [EventCategoryFormGrouped.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/events/EventCategoryFormGrouped.tsx) and category actions, so the new defaults would have no authoring UI.

- `SPEC-008` Medium: `accessibility_notes` defaulting is contradictory. Group 3 says venue-level default ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-11-event-seo-keyword-engine-design.md:90)), section 4 adds category columns ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-11-event-seo-keyword-engine-design.md:229)), and section 9 says category-level cascade ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-11-event-seo-keyword-engine-design.md:404)). No actual storage location is chosen.

- `SPEC-009` Medium: SEO health scoring has weights but no execution boundary. The spec does not say whether the score is computed client-side, server-side, or both; when it recomputes; whether it is returned by the API; or how FAQ count/keyword checks stay consistent across clients.

- `SPEC-010` Medium: Validation is incomplete and internally inconsistent. Group 3 field limits are `~125/~300/~200/~200/~150/~200/~300` ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-11-event-seo-keyword-engine-design.md:83)), but proposed Zod limits are `200/500/300/500/300/500/500` ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-11-event-seo-keyword-engine-design.md:387)). Keyword textarea rules also omit max per-field item count, max per-keyword length, case-folded dedupe, and error behavior.

- `SPEC-011` Medium: AI non-invention rules conflict with required outputs. The prompt forbids inventing details ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-11-event-seo-keyword-engine-design.md:179)), but `previous_event_summary` asks AI to invent a template recap ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-11-event-seo-keyword-engine-design.md:198)), and `attendance_note` depends on history/capacity data that is not in the declared AI input set ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-11-event-seo-keyword-engine-design.md:88), [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-11-event-seo-keyword-engine-design.md:132)).

- `SPEC-012` Medium: Legacy keyword migration is missing. Existing events and categories only have flat `keywords`; the spec removes that UI field and rewrites `keywords` from the new arrays, but never defines how old `keywords` populate `primary/secondary/local` on first edit. That risks silent SEO data loss.

- `SPEC-013` Low: The brand-site section contradicts itself. Non-goals say no rendering changes are needed because the brand site “already consumes the fields” ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-11-event-seo-keyword-engine-design.md:19)), while section 10 says separate brand-site updates are needed to render them ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-11-event-seo-keyword-engine-design.md:417)).

Spec verdict: directionally sound, but not implementation-ready against this repo without explicit fixes for FAQ persistence, type targets, API serialization, category defaults, and the AI/validation edge cases.

**Requirement Inventory**

- `REQ-001` Add three keyword fields after Event Brief in `EventFormGrouped.tsx`.
- `REQ-002` Use textarea inputs for those fields with help text and a visible entered-keyword count.
- `REQ-003` Accept comma-separated, newline-separated, and mixed keyword input.
- `REQ-004` Normalize keywords on blur/save by splitting on comma/newline, trimming, deduping, and dropping empties.
- `REQ-005` Store the new keyword tiers in `primary_keywords`, `secondary_keywords`, and `local_seo_keywords` JSONB columns.
- `REQ-006` Keep legacy `keywords`, remove its UI field, and auto-populate it as ordered deduped union of the three tiers.
- `REQ-007` Restructure SEO & Content into Meta & URL, Content, AI-Generated Content, and SEO Health groups.
- `REQ-008` Make slug, meta title, and meta description keyword-aware with the stated limits and placement rules.
- `REQ-009` Make short description, long description, and highlights keyword-aware with the stated limits and structure.
- `REQ-010` Add new event fields for image alt text, FAQs, Facebook copy, WhatsApp copy, previous event summary, attendance note, cancellation policy, and accessibility notes.
- `REQ-011` Add a non-blocking SEO health indicator with completeness checks, keyword checks, color bands, and 0-100 score.
- `REQ-012` Apply the listed scoring weights exactly.
- `REQ-013` Replace the current SEO generator with a single “Generate All Content” button.
- `REQ-014` Send brief, keyword tiers, and core event metadata to AI in one call.
- `REQ-015` Receive one structured JSON payload containing all generated SEO/content outputs.
- `REQ-016` Enforce primary/secondary/local keyword placement rules across title, description, body, FAQ, social, slug, and alt text.
- `REQ-017` Enforce AI constraints: no stuffing, natural language, UK English, venue tone, no invention, no markdown, respect limits, fallback when no keywords.
- `REQ-018` Generate 3-5 FAQs with the specified topical mix and word-count constraints.
- `REQ-019` Generate Facebook and WhatsApp copy with the specified channel rules.
- `REQ-020` Generate previous-event summary and cancellation policy using the specified logic.
- `REQ-021` Add new columns on `events` for keyword tiers and the new content fields.
- `REQ-022` Add matching default columns on `event_categories`, excluding instance-specific summary/attendance fields.
- `REQ-023` Leave `keywords`, `event_faqs`, and existing SEO columns intact.
- `REQ-024` Extend `/api/events` to expose the new fields and keep `keywords` as ordered union.
- `REQ-025` Extend `eventToSchema()` with image alt, accessibility/refund, and attendance enhancements while keeping FAQ schema support.
- `REQ-026` Update `EventFormGrouped` state and layout for the new fields.
- `REQ-027` Update event and category type definitions for the new fields.
- `REQ-028` Extend `generateEventSeoContent()` input, output, and prompt logic.
- `REQ-029` Extend `createEvent()`/`updateEvent()`, keyword unioning, RPC payloads, and `eventSchema`.
- `REQ-030` Extend category cascading to fill empty event fields from category defaults.
- `REQ-031` Roll out via additive migration steps: DB, RPCs, types/schemas/actions, form/UI, AI, SEO health component, API, and Schema.org.

**Coverage Matrix**

| Topic | Spec status | Audit answer |
|---|---|---|
| Existing FAQ deletion bug | Missing | No, the spec does not require FAQ load/preserve semantics before adding FAQ generation. |
| Stale type file | Conflict | No, it targets `src/types/event.ts` instead of the live `database.ts` / generated schema surface. |
| RPC PostgreSQL functions | Covered | Yes, explicitly mentioned in sections 8 and 11, but still needs action/schema/API whitelist updates. |
| `social_copy_facebook` vs existing Facebook/GBP fields | Missing | No source-of-truth or migration path is defined. |
| Keywords present but brief empty | Missing | No UX, validation, or fallback behavior is specified. |
| DebouncedTextarea stale state | Missing | No flush-on-submit/generate requirement is present. |
| Keyword textarea validation | Partial | Parsing/dedupe is defined; hard validation and error rules are not. |
| Existing category cascading bugs | Missing | No, the spec assumes the current cascade is reliable and does not require fixing known field-name issues. |
| SEO health score client vs server | Missing | No execution owner or recomputation model is defined. |
| `accessibility_notes` venue default storage | Missing/contradictory | Venue-level and category-level defaults are both claimed; actual storage is undefined. |
| Manual API serialization | Missing | No, the spec incorrectly assumes API fields appear automatically. |
| Legacy `keywords` migration/load path | Missing | No backfill or first-load mapping from flat `keywords` to the three-tier model is defined. |

Direct answers to your key questions: FAQ deletion bug `No`; stale type file `No`; RPC PostgreSQL functions `Yes`; social-copy vs existing Facebook/GBP fields `No`; keywords with empty brief `No`; DebouncedTextarea stale state `No`; keyword textarea validation `Partial`; category cascading bugs `No`; SEO health score client/server split `No`; `accessibility_notes` venue default storage `No`.