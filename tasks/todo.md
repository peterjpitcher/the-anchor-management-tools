# Task Tracker

## Current Task: Private-booking prices → VAT-inclusive everywhere (2026-07-07)

Stored prices are NET; customer-payable price is GROSS (`gross_total`, a VIEW-only column on
`private_bookings_with_details`, = net + 20% VAT). Several customer-facing surfaces still
showed NET. Adversarial audit (13 agents, 37 money sites) → 7 confirmed net-shown-as-price
bugs (charged amounts were already gross — no under-charging). All fixed to the canonical
`gross_total ?? calculated_total ?? total_amount` pattern:

- [x] Bookings list — desktop + mobile total (`PrivateBookingsClient.tsx` 639, 778)
- [x] Customer profile — timeline "Value" + "Private booking value" insight (`customers/[id]/page.tsx`); base table lacks the money cols + `source`, so enriched via a companion `private_bookings_with_details` query merged by id (keeps `source`)
- [x] Balance-reminder SMS `{balance_due}` (`PrivateBookingMessagesClient.tsx` 186 + `getBookingByIdForMessages` now selects gross_total/vat_amount + normalizeBooking)
- [x] Provisional-hold email total (`private-booking-emails.ts` 116/117) — fixed at both callers (`payments.ts` 262, `mutations.ts` 1400) to pass gross like the sibling deposit/balance emails; passes null when no positive total (no £0 row)
- [x] Verify: tsc 0 errors, lint clean, 28+25 tests pass; live-DB proof gross = net×1.20 and legacy total_amount=£0 on priced bookings (customer profile was showing £0!)

Scope: PRIVATE BOOKINGS ONLY (events/table-bookings/OJ-invoices have separate VAT handling —
deliberately untouched). NOT committed/deployed. Behaviour note: provisional-hold email will
now show the gross event cost where before it showed nothing — flagged to owner.

## Previous Task: Private booking contract PDF layout fix (2026-07-07)

Template: `src/lib/contract-template.ts` (HTML → Chrome print-to-PDF). Each `.sheet` is a
fixed 210×297mm box; body content overflows the pinned footer on the static pages.

Measured overflow (headless-Chrome harness, print media, webfonts loaded):
- Page 4 (Terms & conditions continued + company line): **17.6mm** into footer
- Page 5 (self-catering annex): **27.9mm** into footer
- Pages 1–3: fit (content is static → this collides on every contract, not just Paula's)

Plan: tighten type/spacing density on the two overflowing blocks (shared `.tc-*` used by
pages 3 & 4; annex-only `ol.contract`/`.clause-h`/`ol.sub`) until ≥3mm clearance, keeping
the 4-page + annex pagination. Re-measure to prove fit; no content removed.

- [x] Tighten T&C two-column density (`.tc-sec`, `.tc-h`, `.tc-sec p`, `.addr`)
- [x] Tighten annex clause density (`.clause-h`, `ol.contract > li`, `ol.sub > li`, title block, sign-intro)
- [x] Re-measure: all 5 sheets clear the footer with margin
- [x] Lint + typecheck + existing contract tests pass

### Review — DONE
Root cause: fixed-height A4 `.sheet` boxes; when a page's body content exceeds the
space above the pinned footer, `.body` (no `overflow:hidden`) spilled over the footer.
Static content, so it overlapped on **every** contract (page 4) and every self-catering
contract (annex), not just Paula's. Fix = pure CSS density reduction on the two dense
blocks; no clauses/content removed, pagination unchanged (4 pages + annex).

Proof (headless-Chrome harness, print media, webfonts loaded), footer clearance:
| Page | Before | After |
|---|---|---|
| 4 (terms cont.) | −17.6mm overlap | +18.5mm clear |
| 5 (annex) | −27.9mm overlap | +10.4mm clear |
| 1/2/3 | fit | 28.8 / 72 / 70mm clear (unchanged) |

Verified: measurement + visual PDF render of pages 4–5; 18/18 contract tests, lint clean,
tsc clean. NOT committed/deployed. Existing stored contract snapshots keep old layout
(immutable per SOP §28) — only re-generated contracts get the fix.

## Previous Task: Premium hourly rates (time-and-a-half / double-time) (2026-07-07)

Spec: [premium-rate-spec.md](premium-rate-spec.md) · Plan: [premium-rate-impl-plan.md](premium-rate-impl-plan.md)
Orchestrated via implement-plan (code mode), 2 waves / 5 agents.

### Wave 1 — Foundation ✅ (gate passed: git-scope clean, 30/30 tests, tsc 0 errors)
- [x] Migration `20260727000000_premium_rates.sql` (rota_shifts, rota_published_shifts, timeclock_sessions)
- [x] Window-aware pay helper + precedence resolver in `pay-calculator.ts` (computeSessionPremiumPay, resolveSessionPremium, computePlannedShiftPremiumPay, resolveShiftWindowInstants, computeEffectiveRate, premiumLabel, hasPremium)
- [x] Helper Vitest coverage — 30 tests in `src/lib/rota/premium-pay.test.ts`
- [x] Generated DB types: not needed (Supabase clients untyped in this project)

### Wave 2 — Feature streams ✅ (gate passed)
- [x] R: rota shift write-path (actions + 2 modals + summary + publish snapshot + shift→session propagation + approval invalidation; 11 tests)
- [x] T: timeclock session write-path (actions + TimeclockManager + auto-close; copy-down + preserve-across-edits + window re-clamp; 6 tests)
- [x] P: payroll calc + accountant Excel/email (both loops + snapshot + Standard/Premium hours + Premium ×; back-compat; 15 tests)
- [x] Po: staff portal badge + pay (planned+actual via helper, session→shift fallback, PaySummaryCard line, ICS note)

### Verification
- [x] git scope diff per wave — clean (no strays in owned files)
- [x] lint (0 warn) → typecheck (0 err) → test (3434/3434) → build (ok)
- [x] codex-qa-review adversarial pass (Codex broken → Claude-only, owner-approved): 6 confirmed material + mediums
- [x] Repair wave (5 agents): drop copy-down + propagate, override cap ≤£100, numeric coercion, overnight off-by-one `<`, linked-only portal/payroll consistency, session validation + audited invalidation + payroll:approve path
- [x] Re-verify pipeline green (tsc 0 / lint 0 / 3462 tests / build ok) + all 6 confirmed findings spot-checked closed in code
- [x] Re-review after fixes: 1 HIGH (premium field-clear) + 3 mediums confirmed → all fixed + regression-tested
- [x] Final pipeline green: tsc 0 / lint 0 / **3464 tests** / build ok; all findings spot-checked closed in code

**Held for owner go-ahead:** apply migration to prod (Supabase MCP), commit/merge to `main` (auto-deploys).

### Review notes
Implementation COMPLETE + fully verified 2026-07-07. 2 adversarial review rounds:
- Round 1: 6 confirmed material (overnight off-by-one, copy-down staleness ×2, uncapped override, numeric-as-string, portal/payroll divergence) → fixed via 5-agent repair wave (key move: dropped clock-in copy-down; sessions resolve premium live from the shift).
- Round 2 (post-repair): 1 HIGH (updateShift `??` couldn't clear a rate field → stale override paid) + 3 mediums (calendar-feed coercion, HH:mm vs HH:mm:ss approval churn, approve not wired for payroll:approve) → all fixed + tests added.
15 code files + migration `20260727000000_premium_rates.sql` + 4 premium test files. Nothing committed; migration NOT applied to prod.
