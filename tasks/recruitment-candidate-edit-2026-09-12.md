# Candidate profile saves keep phone and consent dates, 12 September 2026

Branch `fix/recruitment-candidate-edit-keeps-phone`, commits 3b3255d0 (phone) and a6f3d957
(consent), based on origin/main a1ba68db. Nothing is pushed. Third in the same bug class as
`tasks/timeclock-edit-keeps-notes-2026-09-11.md` and `tasks/receipt-rule-description-2026-09-12.md`:
a save that writes a field the form did not carry.

- [x] Compare both candidate forms with the save payload field by field
- [x] Fix 1: phone_e164 follows the phone the form sent instead of being cleared
- [x] Fix 2: consent dates record when consent was given, not when the row was last saved
- [x] Check every caller of `updateRecruitmentCandidateProfile`
- [x] Tests, red on the old code, one file per fix
- [x] Gates and two commits
- [ ] Owner approval to push, merge and deploy

## Results

- Forms compared. The "Edit candidate details" form on an application
  (`RecruitmentDashboardClient.tsx` around line 1939) sends candidate_id, first_name, last_name,
  email, phone, location, the three right-to-work fields, notes and the two consent ticks. The
  talent pool form (around line 3402) sends all of those plus `phone_e164`. So `phone_e164` is the
  only column in the payload that a form omits, and every other field is prefilled, which makes a
  blank one a deliberate clear.
- Fix 1, phone_e164: derived from the phone the caller sent, with the same expression a candidate
  is created with (`nullIfBlank(parsed.phone_e164) ?? normalizePhoneForLookup(phone)`, which runs
  through `formatPhoneForStorage` and libphonenumber). Keeping the stored value instead would have
  left a stale E.164 number whenever a manager corrected the phone, and SMS prefers phone_e164
  (`phone_e164 || phone`), so it would have texted the old number. Duplicate matching compares
  phone_e164 too, so a cleared one quietly weakened the duplicate check.
  Trade-off: emptying the talent pool form's "Phone E164" box now re-derives from the phone rather
  than clearing the column. It is a normalised copy of the phone, not an independent fact.
- Fix 2, consent dates: the save stamped `sms_consent_at` and `future_recruitment_consent_at` with
  now whenever the tick was on, and both forms resend the tick on every save, so an unrelated edit
  moved the date. It now reads the stored consent and stamps only when consent is newly given;
  unchanged consent keeps the stored value, including nothing, so an undated consent is not given
  a false date. Withdrawing consent still clears it.
- Deliberately unchanged: the repeat-applicant branch of `createRecruitmentApplication` re-stamps
  consent, because a fresh application is a real consent event, and it already coalesces every
  other field with the stored row rather than clearing it. `runRecruitmentRetentionCleanup` and
  `eraseRecruitmentCandidate` write the consent columns directly and correctly.
- Callers: `updateRecruitmentCandidateProfile` is called only by
  `updateRecruitmentCandidateAction`, which serves both candidate forms.
- Left alone, recorded as an assumption in commit 3b3255d0: every other field in the payload is
  written unconditionally, which is safe only because both forms send all of them. A future
  partial-update caller would need the same treatment as phone_e164.
- Tests: `tests/actions/recruitmentCandidatePhone.test.ts` (5 cases) and
  `tests/actions/recruitmentCandidateConsent.test.ts` (4 cases), both driving the real action
  against a one-row fake table. On the old code, 2 of the 5 phone cases and 3 of the 4 consent
  cases failed.
- Gates on Node 20.19.5, after each commit: lint 0; tsc 0, plus both new test files type-checked
  on their own because `tsconfig.json` excludes `tests/` (that isolated check needs
  `src/types/word-extractor.d.ts` in the file list, or it reports a pre-existing untyped import in
  `src/lib/recruitment/files.ts`); `npm test` and `npm run test:utc` 843 files, 7,994 passed,
  2 skipped; cold build passed.
