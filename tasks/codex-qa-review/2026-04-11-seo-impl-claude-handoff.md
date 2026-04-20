# Claude Hand-Off Brief: Event SEO Keyword Engine Implementation

**Generated:** 2026-04-11
**Review mode:** Code Review + Spec Compliance
**Overall risk assessment:** High (3 critical wiring gaps — feature partially non-functional without fixes)

## DO NOT REWRITE

- Database migration (all columns + RPCs correct)
- FAQ persistence fix (full lifecycle verified)
- src/lib/keywords.ts (parseKeywords, buildKeywordsUnion, keywordsToDisplay)
- KeywordStrategyCard, FaqEditor, SeoHealthIndicator components
- DebouncedTextarea flush support
- Zod validation with keywordArraySchema
- API routes (both correctly expose 9 new fields)
- Schema.org additions (accessibilityFeature, refundPolicy)
- Form restructure (4 groups, manual vs AI fields)
- Legacy keyword migration logic

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **IMPL-1 (Critical):** `src/components/features/events/EventFormGrouped.tsx` — In `handleGenerateSeo`, add keyword tiers to the `generateEventSeoContent()` call:
  ```typescript
  primaryKeywords: parseKeywords(primaryKeywords),
  secondaryKeywords: parseKeywords(secondaryKeywords),
  localSeoKeywords: parseKeywords(localSeoKeywords),
  ```

- [ ] **IMPL-2 (Critical):** `src/components/features/events/EventFormGrouped.tsx` — In `handleGenerateSeo`, after existing field applications, add handlers for new AI outputs:
  ```typescript
  if (result.data.imageAltText) setImageAltText(result.data.imageAltText)
  if (result.data.faqs?.length) {
    setFaqs(result.data.faqs.map((faq: any, i: number) => ({ ...faq, sort_order: i })))
    setFaqsModified(true)
  }
  if (result.data.facebookEventName) setFacebookEventName(result.data.facebookEventName)
  if (result.data.facebookEventDescription) setFacebookEventDescription(result.data.facebookEventDescription)
  if (result.data.socialCopyWhatsapp) setSocialCopyWhatsapp(result.data.socialCopyWhatsapp)
  if (result.data.cancellationPolicy) setCancellationPolicy(result.data.cancellationPolicy)
  ```

- [ ] **IMPL-3 (High):** `src/app/actions/event-categories.ts` + `src/types/event-categories.ts` — Add the 6 new category fields (`primary_keywords`, `secondary_keywords`, `local_seo_keywords`, `image_alt_text`, `cancellation_policy`, `accessibility_notes`) to:
  - The EventCategory type/interface
  - The category Zod schema
  - The FormData parsers in createEventCategory and updateEventCategory
  - The database write path

- [ ] **IMPL-4 (Medium):** `src/components/features/events/EventFormGrouped.tsx` — Remove legacy `keywords` cascade from `handleCategoryChange` (around line 274). Keywords are now derived, not cascaded.

- [ ] **IMPL-5 (Low):** `src/app/actions/events.ts:148` — Remove dead `categoryDefaults.brief` fallback reference.

## ASSUMPTIONS TO RESOLVE

None — all findings are concrete with file:line evidence.

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] CR-1/CR-2: Verify handleGenerateSeo sends keywords AND applies all outputs by reading the actual code
- [ ] CR-3: Verify category actions persist new fields by reading event-categories.ts action code

## REVISION PROMPT

You are fixing 3 critical wiring gaps in the Event SEO Keyword Engine.

Apply these changes in order:

1. In EventFormGrouped.tsx handleGenerateSeo: add primaryKeywords/secondaryKeywords/localSeoKeywords to the generateEventSeoContent call
2. In EventFormGrouped.tsx handleGenerateSeo: add handlers for imageAltText, faqs, facebookEventName, facebookEventDescription, socialCopyWhatsapp, cancellationPolicy from the AI result
3. In event-categories.ts actions + types: add 6 new fields to Zod schema, FormData parsing, and DB write
4. In EventFormGrouped.tsx handleCategoryChange: remove legacy keywords cascade
5. In events.ts: remove dead categoryDefaults.brief fallback
6. Run npm run build to verify

After applying changes, confirm:
- [ ] All 5 implementation fixes applied
- [ ] Build passes
- [ ] No sound decisions were overwritten
