# Editing a short link keeps its expiry, 12 September 2026

Branch `fix/short-link-edit-keeps-expiry`, commit 2bfb3024, based on origin/main a1ba68db. Nothing
is pushed. Same bug class as `tasks/timeclock-edit-keeps-notes-2026-09-11.md`: a save that writes a
field the form did not carry.

- [x] Confirm the defect and the exposure
- [x] Check the website repo for a matching path
- [x] Fix: `expires_at` is written only when the caller sends it
- [x] Check every caller, and every flow that could set an expiry
- [x] Test, red on the old code
- [x] Gates and commit
- [ ] Owner approval to push, merge and deploy

## Results

- `ShortLinkService.updateShortLink` wrote `expires_at: input.expires_at ?? null`, and
  `ShortLinkFormModal.tsx` sends id, name, destination_url and link_type only, so every edit
  removed the expiry. `/api/redirect/[code]` and `src/lib/table-bookings/fallback-renderer.ts` both
  refuse an expired link, so the effect was a link that was meant to stop working carrying on.
- Exposure is small and worth stating plainly: nothing in the app sets an expiry today. The
  short-links screen has no expiry field at all, and no creator passes one (SMS link shortening,
  guest links, marketing links, event ticket emails, the Meta ads route). The `create_short_link`
  RPC does accept `p_expires_at`, and variant and child links inherit `parent.expires_at`, so what
  this protects is an expiry set by hand in the database or by a future flow.
- The fix does not start setting expiries anywhere: guest links must keep `expires_at` NULL.
- Callers: the service method is called only by the `updateShortLink` action, whose only caller is
  `ShortLinkFormModal`. The service's other `short_links` updates only backfill a link's name (or
  `created_by`) on the dedupe paths, and the redirect route's update only bumps the click counters.
  None of them touches `expires_at`.
- Website repo (`OJ-The-Anchor.pub`, 26ba434f): no short-link write path and no reference to
  `short_links`; its only `expires_at` is the table-booking hold in its own API types. No matching
  change needed there.
- Test: `tests/actions/shortLinkExpiry.test.ts` sends exactly what the edit modal sends and
  asserts the stored expiry survives and that the payload carries no `expires_at` key, with the
  explicit null (clears) and explicit date (sets) cases alongside. The first case failed on the old
  code.
- Gates on Node 20.19.5: lint 0; tsc 0, plus the new test file type-checked on its own because
  `tsconfig.json` excludes `tests/`; `npm test` and `npm run test:utc` 842 files, 7,988 passed,
  2 skipped; cold build passed.
