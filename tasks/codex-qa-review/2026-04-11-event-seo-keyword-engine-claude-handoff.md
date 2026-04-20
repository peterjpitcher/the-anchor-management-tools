# Claude Hand-Off Brief: Event SEO Keyword Engine

**Generated:** 2026-04-11
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** High (7 critical/high findings requiring spec revision before implementation)

## DO NOT REWRITE

- Three-tier keyword model (primary/secondary/local) with placement rules
- Textarea inputs accepting comma + newline separated keywords
- Flat `keywords` column retained as union for backwards compatibility
- Reuse of existing `event_faqs` table for FAQ storage
- SEO health indicator concept (non-blocking, client-side)
- New DB columns as additive migration (no destructive changes)
- AI generation constraints (no stuffing, UK English, venue tone, no markdown)
- E-E-A-T field concept (experience, authority, trust signals)

## SPEC REVISION REQUIRED

- [ ] **SPEC-REV-1:** Remove `social_copy_facebook` — repurpose existing `facebook_event_name` + `facebook_event_description` fields. Keep `social_copy_whatsapp` as genuinely new. Update AI generation output to target existing Facebook fields.

- [ ] **SPEC-REV-2:** Fix type file target — change Section 7 from `src/types/event.ts` to `src/types/database.generated.ts` (via migration + `npx supabase gen types`) and `src/types/database.ts` for manual extensions. Note that `event.ts` is stale and should be cleaned up separately.

- [ ] **SPEC-REV-3:** Add FAQ persistence fix as prerequisite — Section 11 must include: (a) edit page loads `event_faqs`, (b) form manages FAQ state, (c) `prepareEventDataFromFormData` only sends FAQs when explicitly changed, (d) RPC only deletes/replaces when `p_faqs` is explicitly provided vs omitted.

- [ ] **SPEC-REV-4:** Fix API serialisation claim — remove "automatically available" language. Add explicit API route updates to Section 11 step 7. Both `/api/events/route.ts` and `/api/events/[id]/route.ts` need new fields added to their response shapers.

- [ ] **SPEC-REV-5:** Add category cascade bug fix as prerequisite — fix `image_url` → `default_image_url` and remove non-existent `brief` from cascade before extending with new fields. Add category edit form updates to scope.

- [ ] **SPEC-REV-6:** Define keyword precedence and migration — (a) on first edit of existing event, pre-populate `secondary_keywords` from legacy `keywords`; (b) remove `keywords` from category cascade sources; (c) define precedence: three-tier inputs always win, `keywords` is derived output only.

- [ ] **SPEC-REV-7:** Resolve `accessibility_notes` storage — pick category-level default (consistent with Section 4 DB changes). Remove "venue-level" language from Group 3. Add a code constant for a fallback venue-wide default.

- [ ] **SPEC-REV-8:** Align validation limits — reconcile Group 3 char limits with Section 8 Zod limits. Pick one set and use consistently. Add keyword validation: max 10 items per tier, max 100 chars per keyword, trim + lowercase normalise + reject HTML/control chars.

- [ ] **SPEC-REV-9:** Fix AI non-invention conflict — (a) reframe `previous_event_summary` as a manual field with an optional AI-suggested template (not auto-generated content); (b) make `attendance_note` fully manual (no AI generation — needs real data); (c) update AI output schema to remove these two fields.

- [ ] **SPEC-REV-10:** Add legal safety for cancellation policy — mark AI-generated cancellation policy as a draft suggestion. Add a venue-level default cancellation policy setting that takes precedence. AI only fills when no default exists.

- [ ] **SPEC-REV-11:** Add DebouncedTextarea flush — require debounced fields to flush before AI generation and form save. Document the DB-override behaviour in AI generation (existing events use saved DB values, not unsaved form edits).

- [ ] **SPEC-REV-12:** Define SEO health score execution — client-side only, recomputes on field change (debounced 500ms), not persisted, not in API response.

## IMPLEMENTATION CHANGES REQUIRED

These are codebase fixes needed regardless of spec, discovered during review:

- [ ] **IMPL-1:** `src/app/actions/events.ts:65` — fix category cascade reading `image_url` instead of `default_image_url`
- [ ] **IMPL-2:** `src/app/actions/events.ts:163` — stop normalising missing FAQs to `[]` (should be `undefined`/`null` to signal "no change")
- [ ] **IMPL-3:** `src/app/(authenticated)/events/[id]/edit/page.tsx:27` — load `event_faqs` for the event being edited
- [ ] **IMPL-4:** `src/types/event.ts` — either delete or align with `database.generated.ts` (currently stale with removed columns)

## ASSUMPTIONS TO RESOLVE

- [ ] **ASM-1:** Single AI call token budget — will `max_tokens: 1500` suffice for 13+ fields including multiple FAQ Q&As? -> Prototype with real event data before finalising. May need 3000-4000 tokens.

- [ ] **ASM-2:** Brand site XSS safety — does `OJ-The-Anchor.pub` use safe React text rendering for all event content fields? -> Check rendering of `longDescription`, FAQ answers, and any new fields. If any use `dangerouslySetInnerHTML` or markdown rendering, add server-side HTML stripping.

- [ ] **ASM-3:** Who holds `events.manage` permission? -> If broader than manager/super_admin, tighten access for accessibility_notes and cancellation_policy writes.

## REPO CONVENTIONS TO PRESERVE

- Individual `useState` per field pattern in `EventFormGrouped.tsx` (not a single form object)
- `DebouncedTextarea` for long text fields
- Comma-separated string in UI → array on submit pattern (extend to also handle newlines)
- Server action: auth check → permission check → validate → mutate → audit log → revalidate
- RPC transactions for atomic event + FAQ operations
- Category cascading: client-side (on select change) + server-side (on save)
- API response shaping: explicit field mapping, not raw DB spread

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] CR-1: Re-review FAQ persistence after edit page loads and preserves FAQs
- [ ] SD-1: Re-review social copy fields after Facebook duplication resolved
- [ ] SEC-3: Re-review AI prompt after keyword injection hardening
- [ ] WF-3: Re-review token limits after prototype with full field set

## REVISION PROMPT

You are revising the Event SEO Keyword Engine spec based on an adversarial review.

Apply these changes in order:

1. Spec revisions SPEC-REV-1 through SPEC-REV-12 (update the spec document)
2. Implementation fixes IMPL-1 through IMPL-4 (fix existing bugs found during review)
3. Preserve these decisions: three-tier keywords, textarea input, flat keywords union, event_faqs reuse, SEO health indicator, additive migration
4. Verify these assumptions before proceeding: ASM-1 (token budget), ASM-2 (brand site XSS), ASM-3 (permission scope)

After applying changes, confirm:
- [ ] All spec revisions applied
- [ ] All implementation changes applied
- [ ] No sound decisions were overwritten
- [ ] Assumptions flagged for human review
