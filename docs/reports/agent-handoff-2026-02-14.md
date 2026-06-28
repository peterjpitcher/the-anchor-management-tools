# Agent Handoff (2026-02-14)

## Mission
Continue the meticulous end-to-end bug/risk hardening review, with priority on replay safety, fail-closed behavior, and duplicate-send prevention across SMS/cron/webhook/queue paths.

## Current Baseline (Validated)
- `./node_modules/.bin/tsc --noEmit` passed.
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`224 files, 1005 tests`).
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings).

## Validation Evidence (Latest Run)
- `./node_modules/.bin/eslint src/services/sms-queue.ts tests/services/smsQueue.service.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/smsQueue.service.test.ts --reporter=dot` passed (`1 file, 21 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`224 files, 1005 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/events/waitlist-offers.ts src/lib/events/staff-seat-updates.ts src/lib/parking/payments.ts tests/lib/waitlistOffersSmsPersistence.test.ts tests/lib/staffSeatUpdatesMutationGuards.test.ts tests/lib/parkingPaymentsPersistence.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/waitlistOffersSmsPersistence.test.ts tests/lib/staffSeatUpdatesMutationGuards.test.ts tests/lib/parkingPaymentsPersistence.test.ts --reporter=dot` passed (`3 files, 21 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`224 files, 1004 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/table-bookings/bookings.ts tests/lib/tableBookingCreatedSmsMeta.test.ts tests/lib/tableBookingSundayPreorderSmsMeta.test.ts tests/lib/tableBookingPostCardCaptureSmsMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/tableBookingCreatedSmsMeta.test.ts tests/lib/tableBookingSundayPreorderSmsMeta.test.ts tests/lib/tableBookingPostCardCaptureSmsMeta.test.ts --reporter=dot` passed (`3 files, 6 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`224 files, 996 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-api-complete-fix.ts tests/scripts/testApiCompleteFixScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testApiCompleteFixScriptSafety.test.ts --reporter=dot` passed (`1 file, 1 test`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 993 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/events/event-payments.ts tests/lib/eventPaymentSmsSafetyMeta.test.ts tests/lib/eventBookingSeatUpdateSmsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/eventPaymentSmsSafetyMeta.test.ts tests/lib/eventBookingSeatUpdateSmsSafety.test.ts --reporter=dot` passed (`2 files, 13 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 991 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-booking-api.ts tests/scripts/testBookingApiScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testBookingApiScriptSafety.test.ts --reporter=dot` passed (`1 file, 1 test`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 988 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint /Users/peterpitcher/Cursor/anchor-management-tools/src/lib/process-jobs-script-safety.ts /Users/peterpitcher/Cursor/anchor-management-tools/src/lib/job-retry-script-safety.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/lib/processJobsScriptSafety.test.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/lib/jobRetryScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run /Users/peterpitcher/Cursor/anchor-management-tools/tests/lib/processJobsScriptSafety.test.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/lib/jobRetryScriptSafety.test.ts --reporter=dot` passed (`2 files, 16 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 988 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/sms/bulk.ts tests/lib/smsBulkLoopGuards.test.ts src/lib/twilio.ts tests/lib/twilioUnexpectedPipelineSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/smsBulkLoopGuards.test.ts tests/lib/twilioUnexpectedPipelineSafety.test.ts --reporter=dot` passed (`2 files, 6 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 988 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .../route.js.nft.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/test-table-booking-sms-safety.ts src/lib/test-enrollment-with-sms-safety.ts tests/lib/testTableBookingSmsSafety.test.ts tests/lib/testEnrollmentWithSmsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/testTableBookingSmsSafety.test.ts tests/lib/testEnrollmentWithSmsSafety.test.ts --reporter=dot` passed (`2 files, 14 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 988 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-failed-jobs.ts scripts/database/check-job-tables.ts scripts/database/check-jobs.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts --reporter=dot` passed (`1 file, 8 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` failed (`1 failed | 985 passed (986)`; failing test: `tests/api/twilioWebhookMutationGuards.test.ts > fails closed when post-status customer delivery-outcome updates cannot be applied`)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 986 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/import-employee-documents.ts tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts --reporter=dot` passed (`1 file, 16 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 983 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/services/sms-queue.ts tests/services/smsQueue.service.test.ts src/lib/events/waitlist-offers.ts tests/lib/waitlistOffersSmsPersistence.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/smsQueue.service.test.ts tests/lib/waitlistOffersSmsPersistence.test.ts --reporter=dot` passed (`2 files, 28 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 982 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/events/event-payments.ts tests/lib/eventBookingSeatUpdateSmsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/eventBookingSeatUpdateSmsSafety.test.ts --reporter=dot` passed (`1 file, 5 tests`)
- `./node_modules/.bin/tsc --noEmit` failed (`src/lib/events/event-payments.ts:479/499/520 Type 'null' is not assignable to type 'string | undefined'`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 977 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .../route.js.nft.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .next/server/pages-manifest.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/clear-cashing-up-data.ts scripts/verify-hiring-flow.ts scripts/seed-cashing-up.ts scripts/seed-cashup-targets.ts scripts/clear-2025-data.ts scripts/fix-bookings-is-reminder-only.ts scripts/setup-dev-user.ts scripts/apply-event-categorization.ts scripts/insert-golden-barrels-hours.ts scripts/rectify-golden-barrels.ts scripts/reprocess-cvs.ts scripts/trigger-invoice-reminders.ts scripts/hiring/cleanup-stuck-cvs.ts tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts tests/scripts/testHiringCleanupStuckCvsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts tests/scripts/testHiringCleanupStuckCvsSafety.test.ts --reporter=dot` passed (`2 files, 17 tests`)
- `./node_modules/.bin/tsc --noEmit` failed (`src/lib/events/event-payments.ts:479/499/520 Type 'null' is not assignable to type 'string | undefined'`)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 976 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .../.next/server/pages-manifest.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .../.next/server/pages-manifest.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` failed (`ENOTEMPTY: .../.next/export`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-booking-duplicates.ts scripts/fixes/fix-api-access-simple.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts tests/scripts/testScriptsFailClosedCatchHandlers.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts tests/scripts/testScriptsFailClosedCatchHandlers.test.ts --reporter=dot` passed (`2 files, 9 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 977 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: no such file or directory, rename '.next/export/500.html' -> '.next/server/pages/500.html'`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: no such file or directory, open '.next/server/app/_not-found/page.js.nft.json'`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` failed (`ENOENT: no such file or directory, rename '.next/export/500.html' -> '.next/server/pages/500.html'`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/services/sms-queue.ts tests/services/smsQueue.service.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/smsQueue.service.test.ts --reporter=dot` passed (1 file, 18 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (222 files, 971 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/sms-tools/backfill-twilio-log.ts scripts/sms-tools/migrate-invite-reminders.ts scripts/sms-tools/cleanup-phone-numbers.ts scripts/fixes/fix-rpc-functions.ts scripts/fixes/fix-rpc-functions-direct.ts scripts/fixes/fix-api-access-simple.ts tests/scripts/testScriptMutationGating.test.ts tests/scripts/testFixRpcFunctionsScriptsReadOnly.test.ts tests/scripts/testScriptsFailClosedCatchHandlers.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testScriptMutationGating.test.ts tests/scripts/testFixRpcFunctionsScriptsReadOnly.test.ts tests/scripts/testScriptsFailClosedCatchHandlers.test.ts --reporter=dot` passed (`3 files, 20 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 971 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-paypal-credentials.ts scripts/testing/test-microsoft-graph-email.ts tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 17 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (222 files, 969 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/sms-tools/clear-stuck-jobs.ts scripts/sms-tools/clear-reminder-backlog.ts scripts/sms-tools/fix-past-reminders.ts scripts/sms-tools/finalize-event-reminders.ts tests/scripts/testSmsToolsReminderCleanupScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsToolsReminderCleanupScriptsSafety.test.ts --reporter=dot` passed (`1 file, 2 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 967 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/oj-projects/fix-typo.ts scripts/oj-projects/fix-entry-rates.ts scripts/oj-projects/move-all-to-retainers.ts scripts/oj-projects/move-to-website-content.ts scripts/oj-projects/update-barons-retainer.ts scripts/oj-projects/update-barons-retainer-hours.ts scripts/oj-projects/add-barons-pubs-entries.ts tests/scripts/testOjProjectsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testOjProjectsScriptsSafety.test.ts --reporter=dot` passed (1 file, 9 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 963 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`Cannot find module '.next/server/next-font-manifest.json'`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/events/event-payments.ts tests/lib/eventPaymentSmsSafetyMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/eventPaymentSmsSafetyMeta.test.ts --reporter=dot` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 965 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/foh/event-bookings/route.ts tests/api/fohEventBookingsSmsMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/fohEventBookingsSmsMeta.test.ts --reporter=dot` passed (1 file, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 962 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .../route.js.nft.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .next/server/pages-manifest.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-api-key-database.ts scripts/database/check-performance.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts --reporter=dot` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 963 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: no such file or directory, open '.next/build-manifest.json'`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/table-bookings/bookings.ts tests/lib/tableBookingHoldAlignment.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/tableBookingHoldAlignment.test.ts tests/lib/tableBookingCreatedSmsMeta.test.ts tests/lib/tableBookingSundayPreorderSmsMeta.test.ts --reporter=dot` passed (3 files, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 962 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: no such file or directory, rename '.next/export/500.html' -> '.next/server/pages/500.html'`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`TypeError: Cannot read properties of undefined (reading 'call')` while prerendering `/auth/login`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/menu/seed-chefs-essentials-chips.js scripts/menu/seed-chefs-larder-slow-cooked-lamb-shanks.js scripts/menu/seed-chefs-larder-garden-peas.js scripts/menu/seed-chefs-larder-buttery-mash.js scripts/menu/seed-chefs-larder-sweet-potato-fries.js scripts/menu/seed-menu-dishes.js scripts/menu/seed-menu-dishes.ts tests/scripts/testMenuSeedScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testMenuSeedScriptsSafety.test.ts --reporter=dot` passed (1 file, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 961 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-sms-issue.ts scripts/database/check-table-booking-sms.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts --reporter=dot` passed (1 file, 8 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 961 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/actions/events.ts tests/actions/eventsManualBookingGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/eventsManualBookingGuards.test.ts --reporter=dot` passed (1 file, 12 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 960 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings; webpack cache big-strings warning)

- `./node_modules/.bin/eslint src/lib/table-bookings/bookings.ts tests/lib/tableBookingCreatedSmsMeta.test.ts tests/lib/tableBookingSundayPreorderSmsMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/tableBookingCreatedSmsMeta.test.ts tests/lib/tableBookingSundayPreorderSmsMeta.test.ts --reporter=dot` passed (2 files, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 959 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-booking-now.ts scripts/testing/test-sunday-lunch-api.ts scripts/testing/test-sunday-lunch-payment-fix.ts scripts/testing/test-api-booking-fix.ts tests/scripts/testTableBookingApiScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testTableBookingApiScriptsSafety.test.ts --reporter=dot` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (220 files, 957 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/event-bookings/route.ts tests/api/eventBookingsRouteSmsMeta.test.ts scripts/database/check-sms-queue.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/eventBookingsRouteSmsMeta.test.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts --reporter=dot` passed (2 files, 11 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (220 files, 957 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`TypeError: Cannot read properties of undefined (reading 'call')` while prerendering `/auth/login`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-sms-queue.ts scripts/database/check-bulk-sms-jobs.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts --reporter=dot` passed (1 file, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (220 files, 957 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`TypeError: Cannot read properties of undefined (reading 'call')` while prerendering `/auth/login`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: no such file or directory, rename '.next/export/500.html' -> '.next/server/pages/500.html'`)

- `./node_modules/.bin/eslint scripts/testing/test-api-complete-fix.ts tests/scripts/testApiCompleteFixScriptSafety.test.ts tests/scripts/testNoHardcodedApiKeysInScripts.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testApiCompleteFixScriptSafety.test.ts tests/scripts/testNoHardcodedApiKeysInScripts.test.ts --reporter=dot` passed (2 files, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (220 files, 955 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/setup-dev-user.ts tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts --reporter=dot` passed (1 file, 14 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 953 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-sms-jobs.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts --reporter=dot` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 951 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-sms-new-customer.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts tests/lib/testSmsNewCustomerSafety.test.ts --reporter=dot` passed (2 files, 9 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 951 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/stripe/webhook/route.ts tests/api/stripeWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/stripeWebhookMutationGuards.test.ts --reporter=dot` passed (1 file, 10 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 950 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .next/server/pages-manifest.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`Could not find a production build in the '.next' directory (next-export-no-build-id)`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/cleanup/delete-specific-invoice.ts scripts/cleanup/delete-test-bookings.ts src/lib/delete-test-bookings-safety.ts tests/lib/deleteTestBookingsSafety.test.ts tests/lib/deleteInvoiceCleanupSafety.test.ts tests/scripts/testSmsCleanupScriptsSafety.test.ts tests/scripts/testScriptMutationGating.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/deleteTestBookingsSafety.test.ts tests/lib/deleteInvoiceCleanupSafety.test.ts tests/scripts/testSmsCleanupScriptsSafety.test.ts tests/scripts/testScriptMutationGating.test.ts --reporter=dot` passed (4 files, 40 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 944 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/stripe/webhook/route.ts tests/api/stripeWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/stripeWebhookMutationGuards.test.ts --reporter=dot` passed (1 file, 8 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 941 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .next/server/pages-manifest.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-table-booking-sms.ts scripts/testing/test-enrollment-with-sms.ts src/lib/test-table-booking-sms-safety.ts src/lib/test-enrollment-with-sms-safety.ts tests/lib/testTableBookingSmsSafety.test.ts tests/lib/testEnrollmentWithSmsSafety.test.ts tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/testTableBookingSmsSafety.test.ts tests/lib/testEnrollmentWithSmsSafety.test.ts tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts --reporter=dot` passed (3 files, 16 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 941 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-booking-api.ts scripts/testing/test-sms-new-customer.ts src/lib/test-sms-new-customer-safety.ts tests/scripts/testBookingApiScriptSafety.test.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts tests/lib/testSmsNewCustomerSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testBookingApiScriptSafety.test.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts tests/lib/testSmsNewCustomerSafety.test.ts --reporter=dot` passed (3 files, 10 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 950 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOTEMPTY: .next`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && ./node_modules/.bin/next build` failed (`ENOENT: .next/static/.../_ssgManifest.js`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/cleanup/delete-test-invoices.ts scripts/cleanup/delete-peter-pitcher-bookings.ts scripts/cleanup/delete-peter-test-bookings.ts scripts/cleanup/delete-all-table-bookings.ts src/lib/delete-invoice-cleanup-safety.ts src/lib/delete-peter-pitcher-bookings-safety.ts src/lib/delete-peter-test-bookings-safety.ts src/lib/delete-all-table-bookings-safety.ts tests/lib/deleteInvoiceCleanupSafety.test.ts tests/lib/deletePeterPitcherBookingsSafety.test.ts tests/lib/deletePeterTestBookingsSafety.test.ts tests/lib/deleteAllTableBookingsSafety.test.ts tests/scripts/testSmsCleanupScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/deleteInvoiceCleanupSafety.test.ts tests/lib/deletePeterPitcherBookingsSafety.test.ts tests/lib/deletePeterTestBookingsSafety.test.ts tests/lib/deleteAllTableBookingsSafety.test.ts tests/scripts/testSmsCleanupScriptsSafety.test.ts --reporter=dot` passed (5 files, 43 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 938 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/stripe/webhook/route.ts tests/api/stripeWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/stripeWebhookMutationGuards.test.ts --reporter=dot` passed (1 file, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 938 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-table-booking-sms.ts scripts/testing/test-enrollment-with-sms.ts tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 929 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/services/messages.ts tests/services/messages.service.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/messages.service.test.ts --reporter=dot` passed (1 file, 3 tests)
- `./node_modules/.bin/eslint src/lib/events/event-payments.ts tests/lib/eventPaymentSmsSafetyMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/eventPaymentSmsSafetyMeta.test.ts --reporter=dot` passed (1 file, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 929 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/stripe/webhook/route.ts tests/api/stripeWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/stripeWebhookMutationGuards.test.ts --reporter=dot` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 928 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-private-booking-customer-creation.ts scripts/testing/test-loyalty-enrollment.ts scripts/testing/test-sms-flow.ts tests/scripts/testPrivateBookingCustomerCreationScriptReadOnly.test.ts tests/scripts/testLoyaltyEnrollmentScriptReadOnly.test.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testPrivateBookingCustomerCreationScriptReadOnly.test.ts tests/scripts/testLoyaltyEnrollmentScriptReadOnly.test.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts --reporter=dot` passed (3 files, 12 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 928 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/fixes/fix-table-booking-api-permissions.ts scripts/fixes/fix-pending-payment.ts scripts/fixes/fix-table-booking-sms.ts src/lib/fix-table-booking-api-permissions-script-safety.ts src/lib/pending-payment-fix-safety.ts src/lib/table-booking-sms-fix-safety.ts tests/lib/fixTableBookingApiPermissionsScriptSafety.test.ts tests/lib/pendingPaymentFixSafety.test.ts tests/lib/tableBookingSmsFixSafety.test.ts tests/scripts/testScriptMutationGating.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/fixTableBookingApiPermissionsScriptSafety.test.ts tests/lib/pendingPaymentFixSafety.test.ts tests/lib/tableBookingSmsFixSafety.test.ts tests/scripts/testScriptMutationGating.test.ts --reporter=dot` passed (4 files, 35 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 923 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .next/server/pages-manifest.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-demographics.ts scripts/testing/test-employee-creation.ts scripts/testing/test-analytics-function.ts tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testDemographicsScriptReadOnly.test.ts tests/scripts/testEmployeeCreationScriptReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testDemographicsScriptReadOnly.test.ts tests/scripts/testEmployeeCreationScriptReadOnly.test.ts --reporter=dot` passed (3 files, 19 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 917 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/event-bookings/route.ts src/app/api/event-waitlist/route.ts src/app/api/foh/event-bookings/route.ts tests/api/eventBookingsRouteSmsMeta.test.ts tests/api/eventWaitlistRouteSmsMeta.test.ts tests/api/fohEventBookingsSmsMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/eventBookingsRouteSmsMeta.test.ts tests/api/eventWaitlistRouteSmsMeta.test.ts tests/api/fohEventBookingsSmsMeta.test.ts --reporter=dot` passed (3 files, 9 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 917 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/sms/bulk.ts tests/lib/smsBulkLoopGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/smsBulkLoopGuards.test.ts --reporter=dot` passed (1 file, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 914 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/fixes/fix-api-access-simple.ts scripts/fixes/fix-google-service-key.ts tests/scripts/testScriptsFailClosedCatchHandlers.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testScriptsFailClosedCatchHandlers.test.ts --reporter=dot` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 913 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-slot-generation.ts scripts/testing/test-critical-flows.ts scripts/testing/test-short-link.ts scripts/testing/test-vip-club-redirect.ts tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testCriticalFlowsScriptReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testCriticalFlowsScriptReadOnly.test.ts --reporter=dot` passed (2 files, 21 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 913 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/actions/events.ts tests/actions/eventsManualBookingGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/eventsManualBookingGuards.test.ts --reporter=dot` passed (1 file, 10 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 911 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/sms-tools/backfill-twilio-log.ts scripts/sms-tools/fix-past-reminders.ts scripts/sms-tools/finalize-event-reminders.ts scripts/sms-tools/migrate-invite-reminders.ts scripts/sms-tools/cleanup-phone-numbers.ts scripts/sms-tools/clear-stuck-jobs.ts scripts/sms-tools/clear-reminder-backlog.ts scripts/cleanup/delete-test-invoices.ts scripts/cleanup/delete-specific-invoice.ts scripts/cleanup/delete-peter-pitcher-bookings.ts scripts/cleanup/delete-peter-test-bookings.ts scripts/cleanup/delete-all-table-bookings.ts tests/scripts/testScriptMutationGating.test.ts tests/scripts/testSmsCleanupScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testScriptMutationGating.test.ts tests/scripts/testSmsCleanupScriptsSafety.test.ts --reporter=dot` passed (2 files, 22 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 908 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/guest/token-throttle.ts tests/lib/guestTokenThrottle.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/guestTokenThrottle.test.ts --reporter=dot` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 902 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/analysis/analyze-duplicates-detailed.ts scripts/analysis/analyze-private-bookings-customers.ts scripts/analysis/analyze-performance.ts scripts/analysis/calibrate-hiring-thresholds.ts scripts/analysis/evaluate-hiring-screening.ts tests/scripts/testAnalysisScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAnalysisScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 901 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint src/app/actions/sms.ts 'src/app/api/boh/table-bookings/[id]/sms/route.ts' tests/actions/smsActions.test.ts tests/api/bohTableBookingSmsRouteSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/smsActions.test.ts tests/api/bohTableBookingSmsRouteSafety.test.ts --reporter=dot` passed (2 files, 17 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 899 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint scripts/database/check-customer-schema.ts scripts/database/check-event-categories-migration.ts scripts/database/check-migration-history.ts scripts/database/check-migration-simple.ts scripts/database/check-migrations.ts scripts/database/check-schema-admin.ts scripts/database/check-schema-env.ts scripts/database/check-supabase-clients.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts tests/scripts/testDatabaseEventCategoriesMigrationScriptsReadOnly.test.ts --reporter=dot` passed (2 files, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 895 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/analysis/analyze-duplicates-detailed.ts scripts/analysis/calibrate-hiring-thresholds.ts scripts/analysis/evaluate-hiring-screening.ts tests/scripts/testAnalysisScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAnalysisScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 895 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint src/services/sms-queue.ts tests/services/smsQueue.service.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/smsQueue.service.test.ts --reporter=dot` passed (1 file, 17 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 892 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/foh/bookings/route.ts tests/api/fohBookingsSundayPreorderFailSafe.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/fohBookingsSundayPreorderFailSafe.test.ts --reporter=dot` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 892 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint scripts/backfill/cancelled-parking.ts scripts/backfill/employee-birthdays-to-calendar.ts scripts/tools/resync-private-bookings-calendar.ts tests/scripts/testBackfillScriptsSafety.test.ts tests/scripts/testResyncPrivateBookingsCalendarScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testBackfillScriptsSafety.test.ts tests/scripts/testResyncPrivateBookingsCalendarScriptSafety.test.ts --reporter=dot` passed (2 files, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (218 files, 890 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint scripts/database/check-attendance-dates.ts scripts/database/check-booking-discount.ts scripts/database/check-current-schema.ts scripts/database/check-customer-phone.ts scripts/database/check-customers-and-labels.ts scripts/database/check-event-images.ts scripts/database/check-pending-booking.ts scripts/database/check-recent-attendance.ts scripts/database/check-table-bookings-structure.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (218 files, 890 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/foh/food-order-alert/route.ts tests/api/fohFoodOrderAlertRouteSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/fohFoodOrderAlertRouteSafety.test.ts --reporter=dot` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (217 files, 888 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint scripts/database/check-audit-logs.ts scripts/database/check-booking-duplicates.ts scripts/database/check-booking-errors.ts scripts/database/check-sunday-lunch-orders.ts scripts/database/check-sunday-lunch-table.ts scripts/database/check-venue-spaces.ts scripts/database/check-payment-status.ts scripts/database/check-latest-booking-details.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (217 files, 887 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/analysis/analyze-messages-permissions.ts tests/scripts/testAnalysisScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAnalysisScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (217 files, 887 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint scripts/debug-candidates.ts tests/scripts/testRootDebugScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testRootDebugScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 16 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (216 files, 885 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint src/app/actions/sms-bulk-direct.ts tests/actions/smsBulkDirectFailSafe.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/smsBulkDirectFailSafe.test.ts --reporter=dot` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (216 files, 884 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint scripts/check-employee-status.ts scripts/check-golden-barrels-projects.ts scripts/check-golden-barrels-status.ts scripts/debug-schema.ts scripts/debug-outstanding.ts tests/scripts/testRootDebugScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testRootDebugScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 15 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (215 files, 883 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint src/app/api/foh/event-bookings/route.ts src/app/api/table-bookings/route.ts tests/api/fohEventBookingsSmsMeta.test.ts tests/api/tableBookingsRouteSmsMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/fohEventBookingsSmsMeta.test.ts tests/api/tableBookingsRouteSmsMeta.test.ts --reporter=dot` passed (2 files, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (215 files, 878 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint src/services/private-bookings.ts tests/services/privateBookingsSmsSideEffects.test.ts src/lib/events/event-payments.ts tests/lib/eventBookingSeatUpdateSmsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/privateBookingsSmsSideEffects.test.ts tests/lib/eventBookingSeatUpdateSmsSafety.test.ts --reporter=dot` passed (2 files, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (215 files, 876 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-sms-status.ts scripts/database/check-sms-templates.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts --reporter=dot` passed (1 file, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (215 files, 876 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/reproduce_availability.js scripts/create-placeholder-icons.js tests/scripts/testRootDebugScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testRootDebugScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 10 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (215 files, 874 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/sms-tools/check-all-jobs.ts scripts/sms-tools/check-reminder-issues.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts --reporter=dot` passed (1 file, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (215 files, 874 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-webhook-logs-new.ts scripts/database/check-webhook-logs.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts --reporter=dot` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (215 files, 872 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint "src/app/api/boh/table-bookings/[id]/sms/route.ts" tests/api/bohTableBookingSmsRouteSafety.test.ts src/app/actions/diagnose-messages.ts src/app/actions/diagnose-webhook-issues.ts tests/actions/diagnosticActionsConsoleGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/bohTableBookingSmsRouteSafety.test.ts tests/actions/diagnosticActionsConsoleGuards.test.ts --reporter=dot` passed (2 files, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (215 files, 872 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-invalid-bank-details.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts --reporter=dot` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (215 files, 872 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/verify-hiring-flow.ts tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts scripts/testing/test-api-booking-fix.ts scripts/testing/test-booking-now.ts scripts/testing/test-sunday-lunch-api.ts scripts/testing/test-sunday-lunch-payment-fix.ts tests/scripts/testTableBookingApiScriptsSafety.test.ts scripts/debug-booking-payment.ts scripts/debug-booking-payment-records.ts scripts/check-booking-state.ts scripts/debug-bookings.ts scripts/debug-business-hours.ts scripts/check_hours_debug.ts scripts/fetch-events-for-categorization.ts scripts/check_hours_debug.js tests/scripts/testRootDebugScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts tests/scripts/testTableBookingApiScriptsSafety.test.ts tests/scripts/testRootDebugScriptsFailClosed.test.ts --reporter=dot` passed (3 files, 23 tests)
- `./node_modules/.bin/eslint src/lib/job-retry-script-safety.ts scripts/reset-jobs.ts scripts/retry-failed-jobs.ts scripts/process-jobs.ts tests/lib/jobRetryScriptSafety.test.ts tests/scripts/testJobProcessingScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/jobRetryScriptSafety.test.ts tests/scripts/testJobProcessingScriptsSafety.test.ts --reporter=dot` passed (2 files, 12 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (215 files, 872 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-production-templates.ts scripts/database/check-customer-labels.ts scripts/database/check-event-categories.ts scripts/database/check-event-categories-data.ts scripts/database/check-invalid-phone-numbers.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts --reporter=dot` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (213 files, 861 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/events/waitlist-offers.ts tests/lib/waitlistOffersSmsPersistence.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/waitlistOffersSmsPersistence.test.ts --reporter=dot` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (213 files, 861 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/parking/payments.ts tests/lib/parkingPaymentsPersistence.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/parkingPaymentsPersistence.test.ts --reporter=dot` passed (1 file, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (213 files, 861 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/foh/bookings/route.ts tests/api/fohBookingsWalkInOverrideCleanupGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/fohBookingsWalkInOverrideCleanupGuards.test.ts --reporter=dot` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (213 files, 860 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-messages-permissions.ts scripts/database/check-messages.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts --reporter=dot` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (211 files, 853 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/services/sms-queue.ts tests/services/smsQueue.service.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/smsQueue.service.test.ts --reporter=dot` passed (1 file, 16 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (211 files, 853 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/delete-test-customers-direct-safety.ts scripts/cleanup/delete-test-customers-direct.ts scripts/cleanup/delete-test-customers.ts tests/lib/deleteTestCustomersDirectSafety.test.ts tests/scripts/testScriptMutationGating.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/deleteTestCustomersDirectSafety.test.ts tests/scripts/testScriptMutationGating.test.ts --reporter=dot` passed (2 files, 21 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (211 files, 851 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/trigger-invoice-reminders.ts scripts/apply-event-categorization.ts scripts/import-employee-documents.ts scripts/insert-golden-barrels-hours.ts scripts/rectify-golden-barrels.ts scripts/reprocess-cvs.ts tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts --reporter=dot` passed (1 file, 14 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (211 files, 851 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/actions/messagesActions.ts src/app/api/messages/unread-count/route.ts tests/actions/messagesActionsConsoleGuards.test.ts tests/api/messagesUnreadCountRouteConsoleGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/messagesActionsConsoleGuards.test.ts tests/api/messagesUnreadCountRouteConsoleGuards.test.ts --reporter=dot` passed (2 files, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (211 files, 841 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/services/sms-queue.ts tests/services/smsQueue.service.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/smsQueue.service.test.ts --reporter=dot` passed (1 file, 14 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (209 files, 839 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/actions/privateBookingActions.ts tests/actions/privateBookingActionsConsoleGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/privateBookingActionsConsoleGuards.test.ts tests/actions/privateBookingActionsSmsMeta.test.ts --reporter=dot` passed (2 files, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (209 files, 839 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-tables.ts scripts/database/check-failed-jobs.ts scripts/database/check-invoice-system.ts scripts/database/check-job-tables.ts scripts/database/check-user-permissions.ts scripts/database/check-customer-preferences.ts scripts/database/check-customer-suggestions.ts scripts/database/check-events-with-categories.ts scripts/database/check-customers-table.ts scripts/database/check-events-table.ts scripts/database/check-jobs.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts --reporter=dot` passed (2 files, 8 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (209 files, 839 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/unified-job-queue.ts tests/lib/unifiedJobQueue.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/unifiedJobQueue.test.ts --reporter=dot` passed (1 file, 16 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (208 files, 836 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/stripe/webhook/route.ts tests/api/stripeWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/stripeWebhookMutationGuards.test.ts --reporter=dot` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (208 files, 834 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/actions/events.ts src/app/actions/import-messages.ts tests/actions/eventsManualBookingGuards.test.ts tests/actions/importMessagesConsoleGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/eventsManualBookingGuards.test.ts tests/actions/importMessagesConsoleGuards.test.ts --reporter=dot` passed (2 files, 8 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (208 files, 827 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/cleanup/delete-specific-customers.ts scripts/cleanup/delete-test-bookings.ts tests/scripts/testScriptMutationGating.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testScriptMutationGating.test.ts --reporter=dot` passed (1 file, 10 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (207 files, 825 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/services/messages.ts tests/services/messages.service.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/messages.service.test.ts --reporter=dot` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (207 files, 823 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-and-fix-sms.ts tests/scripts/testAndFixSmsScriptReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAndFixSmsScriptReadOnly.test.ts --reporter=dot` passed (1 file, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (207 files, 822 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-table-booking-sms.ts scripts/testing/test-production-templates.ts scripts/testing/test-production-template-fix.ts scripts/testing/test-template-loading.ts scripts/testing/test-template-fix.ts scripts/testing/test-deployment.ts scripts/testing/test-menu-display.ts tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts --reporter=dot` passed (2 files, 19 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (207 files, 822 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint 'src/app/api/foh/bookings/[id]/party-size/route.ts' 'src/app/api/boh/table-bookings/[id]/party-size/route.ts' tests/api/partySizeSeatUpdateRoutesConsoleGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/partySizeSeatUpdateRoutesConsoleGuards.test.ts --reporter=dot` passed (1 file, 1 test)
- `./node_modules/.bin/eslint tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (207 files, 816 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/background-jobs.ts tests/lib/backgroundJobsQueue.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/backgroundJobsQueue.test.ts --reporter=dot` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (207 files, 816 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-enrollment-sms.ts scripts/database/check-processed-sms.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts --reporter=dot` passed (1 file, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (207 files, 816 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/twilio.ts tests/lib/twilioSendLoggingFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/twilioSendLoggingFailClosed.test.ts --reporter=dot` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (206 files, 813 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/actions/events.ts tests/actions/eventsActionsConsoleGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/eventsActionsConsoleGuards.test.ts --reporter=dot` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (206 files, 813 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-calendar-sync.ts scripts/testing/test-audit-log.ts scripts/testing/test-audit-log-rls.ts scripts/testing/test-sunday-lunch-menu.ts scripts/testing/dump-events-api.ts scripts/testing/check-shortlink-redirect.ts scripts/testing/test-private-booking-customer-creation.ts scripts/testing/test-loyalty-enrollment.ts scripts/testing/test-connectivity.ts scripts/testing/test-pdf-generation.ts tests/scripts/testCalendarSyncScriptsReadOnly.test.ts tests/scripts/testAuditLogScriptsReadOnly.test.ts tests/scripts/testPrivateBookingCustomerCreationScriptReadOnly.test.ts tests/scripts/testLoyaltyEnrollmentScriptReadOnly.test.ts tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testCalendarSyncScriptsReadOnly.test.ts tests/scripts/testAuditLogScriptsReadOnly.test.ts tests/scripts/testPrivateBookingCustomerCreationScriptReadOnly.test.ts tests/scripts/testLoyaltyEnrollmentScriptReadOnly.test.ts --reporter=dot` passed (5 files, 19 tests)
- `./node_modules/.bin/eslint scripts/fixes/fix-table-booking-api-permissions.ts scripts/fixes/fix-table-booking-sms.ts scripts/fixes/fix-pending-payment.ts scripts/fixes/fix-duplicate-loyalty-program.ts src/lib/fix-table-booking-api-permissions-script-safety.ts tests/lib/fixTableBookingApiPermissionsScriptSafety.test.ts tests/scripts/testScriptMutationGating.test.ts scripts/cleanup/remove-historic-import-notes.ts scripts/cleanup/delete-approved-duplicates.ts scripts/fixes/fix-superadmin-permissions.ts src/lib/remove-historic-import-notes-script-safety.ts src/lib/delete-approved-duplicates-script-safety.ts src/lib/fix-superadmin-permissions-script-safety.ts tests/lib/removeHistoricImportNotesScriptSafety.test.ts tests/lib/deleteApprovedDuplicatesScriptSafety.test.ts tests/lib/fixSuperadminPermissionsScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testScriptMutationGating.test.ts tests/lib/removeHistoricImportNotesScriptSafety.test.ts tests/lib/deleteApprovedDuplicatesScriptSafety.test.ts tests/lib/fixSuperadminPermissionsScriptSafety.test.ts tests/lib/fixTableBookingApiPermissionsScriptSafety.test.ts --reporter=dot` passed (5 files, 24 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (205 files, 811 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

## Latest Findings Completed (Most Recent)
- `280. PAY-003` (P1)
- `281. PAY-004` (P1)
- `282. SCRIPT-020` (P1)
- `283. QUEUE-011` (P1)
- `284. FOH-011` (P1)
- `285. SMS-036` (P1)
- `286. SCRIPT-021` (P1)
- `287. SCRIPT-022` (P1)
- `288. SCRIPT-023` (P1)
- `289. SCRIPT-024` (P1)
- `290. SCRIPT-025` (P1)
- `291. SCRIPT-026` (P1)
- `292. SCRIPT-027` (P1)
- `293. SCRIPT-028` (P1)
- `294. SCRIPT-029` (P1)
- `295. SCRIPT-030` (P1)
- `296. SCRIPT-031` (P1)
- `297. SCRIPT-032` (P1)
- `298. SCRIPT-033` (P1)
- `299. SCRIPT-034` (P1)
- `300. SCRIPT-035` (P1)
- `301. SCRIPT-036` (P1)
- `302. SCRIPT-037` (P1)
- `303. AUTH-007` (P1)
- `304. QUEUE-012` (P1)
- `305. SCRIPT-038` (P1)
- `306. SCRIPT-039` (P1)
- `307. QUEUE-013` (P0)
- `308. SCRIPT-040` (P1)
- `309. PARK-006` (P1)
- `310. SCRIPT-041` (P1)
- `311. SCRIPT-042` (P0)
- `312. SCRIPT-043` (P0)
- `313. SMS-037` (P0)
- `314. SCRIPT-044` (P0)
- `315. SCRIPT-045` (P0)
- `316. QUEUE-014` (P0)
- `317. MSG-002` (P0)
- `318. SCRIPT-046` (P0)
- `319. SMS-038` (P0)
- `320. SMS-039` (P0)
- `321. MSG-003` (P1)
- `322. SMS-040` (P1)
- `323. SMS-041` (P0)
- `324. WAITLIST-002` (P1)
- `325. WAITLIST-003` (P1)
- `326. SCRIPT-047` (P0)
- `327. SMS-042` (P0)
- `328. QUEUE-015` (P0)
- `329. WEBHOOK-017` (P0)
- `330. EVENT-008` (P1)
- `331. SMS-043` (P0)
- `332. SMS-044` (P0)
- `333. SCRIPT-048` (P1)
- `334. SCRIPT-049` (P0)
- `335. SCRIPT-050` (P1)
- `336. SCRIPT-051` (P1)
- `337. SCRIPT-052` (P1)
- `338. SCRIPT-053` (P1)
- `339. SCRIPT-054` (P0)
- `340. SCRIPT-055` (P0)
- `341. SCRIPT-056` (P0)
- `342. SCRIPT-057` (P0)
- `343. SCRIPT-058` (P1)
- `344. SCRIPT-059` (P1)
- `345. SCRIPT-060` (P1)
- `346. SCRIPT-061` (P1)
- `347. SMS-045` (P0)
- `348. SMS-046` (P1)
- `349. SCRIPT-062` (P1)
- `350. EVENT-009` (P1)
- `351. SCRIPT-063` (P1)
- `352. SCRIPT-064` (P1)
- `353. SCRIPT-065` (P1)
- `354. SCRIPT-066` (P1)
- `355. SCRIPT-067` (P1)
- `356. SMS-047` (P0)
- `357. SCRIPT-068` (P1)
- `358. SCRIPT-069` (P0)
- `359. QUEUE-016` (P0)
- `360. QUEUE-017` (P0)
- `361. MSG-004` (P1)
- `362. SMS-048` (P1)
- `363. EVENT-010` (P1)
- `364. WAITLIST-004` (P0)
- `365. SMS-049` (P0)
- `366. SMS-050` (P0)
- `367. SMS-051` (P0)
- `368. SMS-052` (P0)
- `369. SMS-053` (P1)
- `370. SCRIPT-070` (P1)
- `371. SCRIPT-071` (P1)
- `372. SMS-054` (P1)
- `373. PARK-007` (P1)
- `374. SMS-055` (P1)
- `375. SCRIPT-072` (P0)
- `376. SCRIPT-073` (P1)
- `377. SCRIPT-074` (P1)
- `378. QUEUE-018` (P1)
- `379. SMS-056` (P1)
- `380. EVENT-011` (P1)
- `381. IDEMP-004` (P0)
- `382. IDEMP-005` (P0)
- `383. SMS-058` (P1)
- `384. IDEMP-006` (P0)
- `385. WEBHOOK-018` (P1)
- `386. IDEMP-007` (P0)
- `387. SMS-059` (P1)
- `388. IDEMP-008` (P0)
- `389. SMS-061` (P1)
- `390. EVENT-013` (P1)
- `391. FOH-012` (P1)
- `392. EVENT-014` (P1)
- `393. MSG-006` (P1)
- `394. WEBHOOK-019` (P1)
- `395. PB-016` (P1)
- `396. MSG-007` (P1)
- `397. FOH-013` (P1)
- `398. SMS-063` (P1)
- `399. DIAG-001` (P1)
- `400. FOH-014` (P1)
- `401. TB-004` (P1)
- `402. SMS-064` (P0)
- `403. FOH-015` (P1)
- `404. FOH-016` (P1)
- `405. SMS-065` (P0)
- `406. SMS-066` (P1)
- `407. EVENT-016` (P1)
- `408. SMS-067` (P1)
- `409. WEBHOOK-020` (P1)
- `410. WEBHOOK-021` (P1)
- `411. WEBHOOK-022` (P1)
- `412. WEBHOOK-023` (P1)
- `413. WEBHOOK-024` (P1)
- `414. EVENT-018` (P1)
- `415. EVENT-019` (P1)
- `416. EVENT-020` (P1)
- `417. EVENT-021` (P1)
- `418. WEBHOOK-025` (P1)
- `419. EVENT-022` (P1)
- `420. WEBHOOK-026` (P1)
- `420 (follow-up 2). PARK-009` (P1)
- `420 (follow-up 3). SMS-069` (P1)
- `421. SMS-057` (P1)
- `422. EVENT-012` (P1)
- `423. QUEUE-019` (P0)
- `424. QUEUE-020` (P1)
- `425. SMS-060` (P0)
- `426. INV-010` (P1)
- `427. QUEUE-021` (P0)
- `428. SMS-062` (P0)
- `429. QUEUE-022` (P1)
- `430. MSG-005` (P1)
- `431. QUEUE-023` (P0)
- `432. QUEUE-024` (P0)
- `433. QUEUE-025` (P0)
- `434. PARK-008` (P0)
- `435. WAITLIST-005` (P0)
- `436. PB-017` (P1)
- `437. EVENT-015` (P1)
- `438. WAITLIST-006` (P1)
- `439. QUEUE-026` (P1)
- `440. GUEST-003` (P1)
- `441. SMS-067` (P1)
- `442. MSG-008` (P1)
- `443. EVENT-017` (P1)
- `444. TB-005` (P1)
- `445. TB-006` (P1)
- `446. EVENT-017` (P1)
- `447. QUEUE-027` (P1)
- `448. EVENT-015` (P1)
- `449. QUEUE-028` (P1)
- `450. WAITLIST-007` (P1)
- `451. BULK-006` (P1)
- `452. SMS-068` (P1)
- `453. EVENT-023` (P1)
- `454. TB-007` (P1)
- `455. WAITLIST-008` (P1)
- `456. EVENT-024` (P1)
- `457. PARK-010` (P1)
- `458. QUEUE-029` (P1)
- `461. SCRIPT-075` (P0)
- `462. SCRIPT-076` (P0)
- `463. SCRIPT-077` (P1)
- `464. SCRIPT-078` (P1)
- `465. SCRIPT-079` (P0)
- `466. SCRIPT-080` (P0)
- `467. SCRIPT-081` (P0)
- `468. SCRIPT-082` (P0)
- `469. SCRIPT-083` (P0)
- `470. SCRIPT-084` (P0)
- `471. SCRIPT-093` (P0)
- `472. SCRIPT-094` (P0)
- `473. SCRIPT-095` (P0)
- `474. SCRIPT-096` (P0)
- `475. SCRIPT-097` (P0)
- `476. SCRIPT-098` (P1)
- `477. SCRIPT-099` (P0)
- `478. SCRIPT-100` (P1)
- `479. SCRIPT-101` (P1)
- `480. SCRIPT-107` (P0)
- `481. SCRIPT-108` (P0)
- `482. SCRIPT-112` (P1)
- `483. SCRIPT-113` (P0)
- `484. SCRIPT-114` (P1)
- `485. SCRIPT-118` (P1)
- `486. SCRIPT-119` (P1)
- `487. SCRIPT-122` (P1)
- `488. SCRIPT-123` (P1)
- `489. SCRIPT-124` (P1)
- `490. SCRIPT-125` (P1)
- `491. SCRIPT-126` (P1)
- `492. SCRIPT-131` (P1)
- `493. SCRIPT-132` (P1)
- `494. SCRIPT-134` (P1)
- `495. SCRIPT-136` (P1)
- `496. SCRIPT-139` (P1)
- `497. SCRIPT-140` (P1)
- `498. SCRIPT-142` (P1)
- `499. SCRIPT-145` (P1)
- `500. SCRIPT-146` (P1)
- `501. SCRIPT-085` (P1)
- `502. SCRIPT-086` (P0)
- `503. SCRIPT-087` (P0)
- `504. SCRIPT-088` (P1)
- `505. SCRIPT-089` (P1)
- `506. SCRIPT-090` (P1)
- `507. SCRIPT-091` (P0)
- `508. SCRIPT-092` (P1)
- `509. SCRIPT-102` (P1)
- `510. SCRIPT-103` (P1)
- `511. SCRIPT-104` (P1)
- `512. SCRIPT-105` (P1)
- `513. SCRIPT-106` (P1)
- `514. SCRIPT-109` (P0)
- `515. SCRIPT-110` (P0)
- `516. SCRIPT-111` (P0)
- `517. SCRIPT-113` (P1)
- `518. SCRIPT-114` (P0)
- `519. SCRIPT-115` (P1)
- `520. SCRIPT-116` (P0)
- `521. SCRIPT-117` (P0)
- `522. SCRIPT-118` (P0)
- `523. SCRIPT-119` (P1)
- `524. SCRIPT-120` (P1)
- `525. SCRIPT-121` (P1)
- `526. SCRIPT-124` (P1)
- `527. SCRIPT-125` (P1)
- `528. SCRIPT-126` (P1)
- `529. SCRIPT-127` (P1)
- `530. SCRIPT-128` (P1)
- `531. SCRIPT-129` (P1)
- `532. SCRIPT-130` (P1)
- `533. SCRIPT-131` (P1)
- `534. SCRIPT-133` (P1)
- `535. SCRIPT-135` (P1)
- `536. SCRIPT-137` (P1)
- `537. SCRIPT-138` (P1)
- `538. SCRIPT-141` (P1)
- `539. SCRIPT-143` (P1)
- `540. SCRIPT-144` (P1)

See details in `/Users/peterpitcher/Cursor/anchor-management-tools/FULL_APPLICATION_REVIEW_BLUEPRINT.md`.

## Latest Finding Detail
- `500. SCRIPT-146` (P1 follow-up): `scripts/database/check-deployment-status.ts` still parsed confirm-mode `--limit` with permissive `Number.parseInt`, so malformed values like `--limit=1e0` could be coerced to `1` and satisfy send-mode gating. Fix: tighten `assertSendLimit` to strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) and keep hard requirement `--limit=1`, and expand `getArgValue(...)` to support `--flag=value` form so cap parsing is consistent across both argument styles. Regression: expanded `tests/scripts/testNoHardcodedApiKeysInScripts.test.ts` and `tests/scripts/testScriptMutationGating.test.ts` to require strict parser markers and forbid the legacy `const parsed = Number.parseInt(limitRaw, 10)` pattern.
- `500. SCRIPT-146` (P1 follow-up): Remaining mutation-script cap parsers in owned scope still used permissive `Number.parseInt` coercion in `scripts/cleanup/delete-pending-sms.ts`, `scripts/cleanup/delete-all-queued-messages.ts`, `scripts/cleanup/delete-specific-customers.ts`, and `scripts/fixes/fix-duplicate-loyalty-program.ts`, so malformed caps like `--limit=1e2`, `--limit=09`, or malformed env cap values could be accepted/coerced in mutation mode. Fix: enforce strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) with explicit fail-closed errors for malformed CLI/env cap values, and parse CLI/env separately so invalid explicit flags cannot silently fall back to env values. Regression: expanded `tests/scripts/testSmsCleanupScriptsSafety.test.ts` and `tests/scripts/testScriptMutationGating.test.ts` to require strict parser markers and forbid the legacy `const parsed = Number.parseInt(raw, 10)` pattern for all four scripts.
- `458. QUEUE-029` (P1): `SmsQueueService.sendApprovedSms` in `src/services/sms-queue.ts` still dropped thrown safety metadata in its send catch path, replacing thrown failures with a generic error and losing `code/logFailure` (for example `idempotency_conflict`) needed by callers to enforce fail-closed abort semantics. Fix: preserve thrown `code/logFailure` when building the fallback `result` object and attach normalized safety metadata to the final thrown error in the `result.error` path. Regression: extended `tests/services/smsQueue.service.test.ts` with a thrown `idempotency_conflict` propagation case.
- `457. PARK-010` (P1): `sendParkingPaymentRequest` in `src/lib/parking/payments.ts` still collapsed thrown `sendSMS` failures to `code: 'unexpected_exception'`, dropping fatal safety metadata needed by callers to abort fanout when thrown safety signals indicate degraded safety state. Fix: added `normalizeThrownSmsSafety(...)` and wired the thrown send catch path to propagate normalized `{ code, logFailure }` with fail-closed fallback `code: 'safety_unavailable'`. Regression: extended `tests/lib/parkingPaymentsPersistence.test.ts` with a thrown `logging_failed` propagation case.
- `456. EVENT-024` (P1): Staff seat-update helper `updateTableBookingPartySizeWithLinkedEventSeats` in `src/lib/events/staff-seat-updates.ts` still returned hardcoded `{ code: 'unexpected_exception', logFailure: false }` when `sendEventBookingSeatUpdateSms` threw, suppressing fatal safety metadata and weakening downstream abort semantics. Fix: added `normalizeThrownSmsSafety(...)` and wired the catch path to propagate normalized `{ code, logFailure }` with fail-closed fallback `code: 'safety_unavailable'`. Regression: extended `tests/lib/staffSeatUpdatesMutationGuards.test.ts` with thrown `idempotency_conflict` propagation coverage.
- `455. WAITLIST-008` (P1): `sendWaitlistOfferSms` in `src/lib/events/waitlist-offers.ts` still collapsed thrown `sendSMS` failures to `code: 'unexpected_exception'`, obscuring fatal safety signals (`logging_failed`, `idempotency_conflict`, `safety_unavailable`) from batch callers. Fix: added `normalizeThrownSmsSafety(...)` and wired the thrown send catch path to propagate normalized `{ code, logFailure }` with fail-closed fallback `code: 'safety_unavailable'`. Regression: updated `tests/lib/waitlistOffersSmsPersistence.test.ts` to assert generic-throw fallback to `safety_unavailable` and thrown `idempotency_conflict` propagation.
- `535. SCRIPT-135` (P1 follow-up): Several read-only diagnostics in `scripts/testing` still parsed bounded CLI flags with permissive numeric coercion (`Number(value)`) and clamp semantics (`Math.floor`/`Math.min`), so malformed values (for example `--limit=1e2`, `--days=01`) could be accepted and silently altered instead of fail-closed rejected. Affected scripts: `test-production-templates.ts`, `test-template-loading.ts`, `test-demographics.ts`, `test-slot-generation.ts`, `test-audit-log.ts`, `test-audit-log-rls.ts`, and `test-calendar-sync.ts`. Fix: enforce strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`), reject hard-cap exceedance instead of clamping, and add `--flag=value` support to `getArgValue(...)` readers handling bounded arguments. Regression: expanded `tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts`, `tests/scripts/testDemographicsScriptReadOnly.test.ts`, `tests/scripts/testAuditLogScriptsReadOnly.test.ts`, and `tests/scripts/testCalendarSyncScriptsReadOnly.test.ts` with strict parser markers, hard-cap rejection markers, and guards against permissive `Number(value)` parsing.
- `500. SCRIPT-146` (P1 follow-up): `src/lib/fix-superadmin-permissions-script-safety.ts` still parsed `--limit` / `--offset` and env cap values with permissive `Number.parseInt`, so malformed values like `--limit=1e2`, `--limit=09`, or `--offset=01` could be coerced and weaken explicit cap semantics for `scripts/fixes/fix-superadmin-permissions.ts`. Fix: enforce strict integer parsing (`/^[1-9]\d*$/` for positive caps, `/^(0|[1-9]\d*)$/` for non-negative offsets, plus `Number.isInteger`) with explicit fail-closed errors for malformed CLI/env values. Regression: expanded `tests/lib/fixSuperadminPermissionsScriptSafety.test.ts` with malformed cap rejection coverage and expanded `tests/scripts/testScriptMutationGating.test.ts` to include `fix-superadmin-permissions` gating/cap markers.
- `500. SCRIPT-146` (P1 follow-up): Cleanup mutation scripts `scripts/cleanup/delete-old-sms-messages.ts` and `scripts/cleanup/delete-all-pending-sms.ts` still parsed optional caps with permissive `Number.parseInt`, so malformed values like `--limit=1abc` / `--jobs-limit=1abc` could be truncated and accepted. Fix: tighten optional cap parsing to strict positive integers (`/^[1-9]\d*$/` + `Number.isInteger`) with explicit fail-closed errors on malformed input, preserving existing dry-run defaults, multi-gating, and hard caps. Regression: expanded `tests/scripts/testSmsCleanupScriptsSafety.test.ts` to assert strict parser markers and forbid legacy `Number.parseInt` cap parsing in both scripts.
- `454. TB-007` (P1): Table-booking SMS helpers in `src/lib/table-bookings/bookings.ts` still collapsed thrown `sendSMS` failures to `code: 'unexpected_exception'` across created/post-card-capture/sunday-preorder paths, losing fatal safety metadata from thrown safety signals. Fix: added `normalizeThrownSmsSafety(...)` and wired all three catch paths (`sendTableBookingCreatedSmsIfAllowed`, `sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed`, `sendSundayPreorderLinkSmsIfAllowed`) to propagate normalized `{ code, logFailure }` with fail-closed fallback `code: 'safety_unavailable'`. Regression: extended `tests/lib/tableBookingCreatedSmsMeta.test.ts`, `tests/lib/tableBookingSundayPreorderSmsMeta.test.ts`, and added `tests/lib/tableBookingPostCardCaptureSmsMeta.test.ts`.
- `453. EVENT-023` (P1): Event payment SMS helpers in `src/lib/events/event-payments.ts` still collapsed thrown send failures into `code: 'unexpected_exception'`, which dropped fatal safety metadata from thrown `sendSMS` paths. Fix: added `normalizeThrownSmsSafety(...)` and wired all three helper catch paths (`sendEventPaymentConfirmationSms`, `sendEventBookingSeatUpdateSms`, and `sendEventPaymentRetrySms`) to propagate normalized `{ code, logFailure }` with fail-closed fallback `code: 'safety_unavailable'`. Regression: expanded `tests/lib/eventPaymentSmsSafetyMeta.test.ts` and `tests/lib/eventBookingSeatUpdateSmsSafety.test.ts` with thrown-send safety propagation coverage.
- `539. SCRIPT-143` (P1 follow-up): `scripts/testing/test-api-complete-fix.ts` still parsed `--max-bookings` with permissive numeric coercion (`Number(value)`), so malformed cap formats like `--max-bookings=1e0` could be accepted in confirm-mode send paths, weakening explicit-cap fail-closed semantics. The script also only parsed `--max-bookings <n>`, while hardened script guidance supports both `--flag value` and `--flag=value`, creating parser/guidance drift around required cap gating. Fix: enforce strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) for `--max-bookings` and add dual-form argument parsing support in `getArgValue(...)` before any send-mode cap checks execute. Regression: expanded `tests/scripts/testApiCompleteFixScriptSafety.test.ts` with strict parser markers, equals-form argument parser markers, and a guard forbidding the legacy permissive `Number(value)` cap parser pattern.
- `539. SCRIPT-143` (P1 follow-up): `scripts/testing/test-booking-api.ts` still parsed `--limit` with permissive numeric coercion (`Number(value)`), which accepted malformed cap formats like `--limit=1e0` and weakened explicit-cap fail-closed semantics in a send-mode script. The same script also documented `--limit=1` but only read the `--limit 1` form, creating guidance/parser drift in safety gating. Fix: enforce strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) for `--limit`, and support both `--flag value` and `--flag=value` forms in argument parsing so explicit-cap controls are consistently enforced before any send path. Regression: expanded `tests/scripts/testBookingApiScriptSafety.test.ts` with strict-cap parser markers, `--flag=value` support markers, and a guard forbidding the legacy permissive `Number(value)` cap parser pattern.
- `500. SCRIPT-146` (P1 follow-up): Root jobs-script safety helpers `src/lib/process-jobs-script-safety.ts` and `src/lib/job-retry-script-safety.ts` still parsed caps with permissive `Number.parseInt`, so malformed values like `--limit=1abc` (or `PROCESS_JOBS_BATCH_SIZE=1abc`) could be truncated and accepted in cap paths used by `scripts/process-jobs.ts`, `scripts/reset-jobs.ts`, and `scripts/retry-failed-jobs.ts`. Fix: enforce strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) before existing hard-cap checks (`100`/`500`) so malformed caps fail closed. Regression: expanded `tests/lib/processJobsScriptSafety.test.ts` and `tests/lib/jobRetryScriptSafety.test.ts` with malformed-cap rejection assertions.
- `452. SMS-068` (P1): `sendSMS` in `src/lib/twilio.ts` still returned a generic non-success payload without a fatal safety code when the pipeline threw unexpectedly (for example during safety-limit evaluation), so loop/batch callers could miss an abort-worthy safety degradation. Fix: unexpected pipeline failures now return `{ success: false, error: 'Failed to send message', code: 'safety_unavailable' }` so callers consistently receive a fatal safety signal. Regression: added `tests/lib/twilioUnexpectedPipelineSafety.test.ts`.
- `451. BULK-006` (P1): `sendBulkSms` in `src/lib/sms/bulk.ts` still caught thrown per-recipient send exceptions and continued processing, which could fan out additional sends after an unexpected safety-path failure. Fix: thrown send exceptions now set a fatal abort signal (`logging_failed`/fatal code or fallback `safety_unavailable`) and terminate the bulk run before additional fanout. Regression: extended `tests/lib/smsBulkLoopGuards.test.ts` with a thrown-send abort case asserting single-send execution.
- `538. SCRIPT-141` (P1 follow-up): Strict cap parsing in SMS send-test safety helpers still accepted permissive numeric coercion (`Number(...)`) for `--limit`, so malformed values (for example `--limit=1e0` or `--limit=01`) could pass parsing and weaken explicit-cap fail-closed semantics in confirm-mode send paths for `scripts/testing/test-table-booking-sms.ts` and `scripts/testing/test-enrollment-with-sms.ts`. Fix: tighten `parsePositiveInt` in `src/lib/test-table-booking-sms-safety.ts` and `src/lib/test-enrollment-with-sms-safety.ts` to strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) with explicit malformed-input throws before any mutation-mode gating proceeds. Regression: expanded `tests/lib/testTableBookingSmsSafety.test.ts` and `tests/lib/testEnrollmentWithSmsSafety.test.ts` with malformed-cap rejection coverage (`1e0`, `01`) alongside existing invalid-cap checks.
- `500. SCRIPT-146` (P1 follow-up): Job/message diagnostics scripts `scripts/database/check-failed-jobs.ts`, `scripts/database/check-job-tables.ts`, and `scripts/database/check-jobs.ts` still lacked explicit read-only `--confirm` rejection and consistent bounded query guardrails, and parts of their job/message reads were still ad-hoc (including unbounded pending-job reads), reducing reliability during incident triage. Fix: add explicit read-only `--confirm` blocking, require explicit bounded `--limit` parsing (defaulted read-only preview, hard cap `200`), route reads through `assertScriptQuerySucceeded` for deterministic fail-closed behavior, and preserve non-zero exits via `process.exitCode = 1`. Regression: expanded `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` to enforce `--confirm` blocking, hard-cap limit markers, script-safe query wrapper usage, and admin-client-only wiring for these three scripts.
- `450. WAITLIST-007` (P1): `sendWaitlistOfferSms` in `src/lib/events/waitlist-offers.ts` still returned generic non-success payloads on customer/event lookup DB errors and on thrown send exceptions, dropping `code/logFailure` metadata needed by batch callers to distinguish safety degradation from normal non-send states. Fix: customer/event lookup DB errors now return explicit `{ success: false, code: 'safety_unavailable', logFailure: false }`, and thrown send exceptions now return `{ success: false, code: 'unexpected_exception', logFailure: false }`. Regression: extended `tests/lib/waitlistOffersSmsPersistence.test.ts` with customer-lookup DB-error and thrown-send paths asserting explicit safety metadata.
- `449. QUEUE-028` (P1): private-booking queue recipient-resolution failures in `src/services/sms-queue.ts` still surfaced generic `error` strings without safety codes, so upstream side-effect loops could continue fanout when booking/customer context lookups were unavailable. Fix: recipient-resolution DB failures now propagate `code: 'safety_unavailable'` from `resolvePrivateBookingRecipientPhone` through `queueAndSend`, and `sendPrivateBookingSms` now maps lookup resolution failures to `safety_unavailable` while preserving thrown safety metadata. Regression: extended `tests/services/smsQueue.service.test.ts` with customer-context lookup failure and lookup-resolution failure cases asserting `safety_unavailable`.
- `448. EVENT-015` (P1 follow-up): `sendEventBookingSeatUpdateSms` in `src/lib/events/event-payments.ts` still returned generic non-success payloads on booking/customer lookup DB errors and inconsistent metadata on no-op/error branches, making fatal DB-read safety degradation hard to detect in callers. Fix: DB lookup errors now fail closed with explicit `code: 'safety_unavailable'`, and non-send branches now return explicit `code/logFailure` metadata without dropping safety context. Regression: extended `tests/lib/eventBookingSeatUpdateSmsSafety.test.ts` with booking/customer lookup DB-error coverage and metadata assertions.
- `518. SCRIPT-114` (P0 follow-up): `scripts/import-employee-documents.ts` still parsed `--limit` with permissive numeric coercion (`Number(...)`), allowing non-integer values and weakening explicit-cap safety semantics in mutation mode. Fix: add strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) with explicit malformed-input throws, and support both `--limit=<n>` and `--limit <n>` forms before any mutation path can proceed. Regression: expanded `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts` with strict parser assertions for `import-employee-documents.ts` (both flag forms, strict markers, and no permissive coercion pattern).
- `514. SCRIPT-109` (P0 follow-up): Remaining root/hiring mutation scripts in this hardening stream still parsed mutation caps with permissive `Number.parseInt`, so malformed cap inputs like `--limit=1abc` could be silently truncated and accepted. Affected scripts: `scripts/{clear-cashing-up-data,verify-hiring-flow,seed-cashing-up,seed-cashup-targets,clear-2025-data,fix-bookings-is-reminder-only,setup-dev-user,apply-event-categorization,insert-golden-barrels-hours,rectify-golden-barrels,reprocess-cvs,trigger-invoice-reminders}.ts` and `scripts/hiring/cleanup-stuck-cvs.ts`. Fix: tighten `parsePositiveInt` in each script to strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) with explicit throw-on-malformed values before any mutation path can proceed. Regression: expanded `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts` and `tests/scripts/testHiringCleanupStuckCvsSafety.test.ts` to enforce strict parser markers and forbid the legacy `const parsed = Number.parseInt(raw, 10)` pattern.
- `447. QUEUE-027` (P1): `SmsQueueService.sendApprovedSms` in `src/services/sms-queue.ts` previously ignored `private_bookings` lookup errors and could continue to `sendSms` with unverifiable booking/customer context. Under DB degradation this was a fail-open send path in an approved-dispatch flow. Fix: enforce fail-closed booking-context checks before dispatch and throw when booking lookup errors (or returns no row), preventing any send attempt on unknown context. Regression: extended `tests/services/smsQueue.service.test.ts` with a booking-lookup-error case asserting fail-closed rejection and confirming `sendSms` is not called.
- `503. SCRIPT-087` (P0 follow-up): High-risk send-test scripts `scripts/testing/test-paypal-credentials.ts` and `scripts/testing/test-microsoft-graph-email.ts` still parsed `--limit` with `Number.parseInt`, so malformed cap inputs (for example `--limit=1abc`) could be silently truncated and accepted despite confirm-mode send gating. Fix: tighten each script’s `parsePositiveInt` to strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) and throw on malformed values before any external-side-effect send/create path can proceed. Regression: expanded `tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts` to assert strict cap parser markers and forbid the legacy `const parsed = Number.parseInt(raw, 10)` parser pattern for both scripts.
- `500. SCRIPT-146` (P1 follow-up): Final raw Supabase client removals in scoped script directories: `scripts/database/check-booking-duplicates.ts` and `scripts/fixes/fix-api-access-simple.ts` still imported `@supabase/supabase-js` solely to run anon-read probes, leaving the scoped hardening pass incomplete. Fix: replace anon probes with explicit read-only REST checks via `fetch`, keep service-role reads on `createAdminClient`, and preserve fail-closed behavior for env/query failures with non-zero exits. Regression: expanded `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` (script-safe anon/admin diagnostics for `check-booking-duplicates.ts`) and `tests/scripts/testScriptsFailClosedCatchHandlers.test.ts` (`fix-api-access-simple.ts` now prohibited from raw `@supabase/supabase-js` imports).
- `500. SCRIPT-146` (P1 follow-up): Additional SMS/maintenance scripts in owned scope still used raw service-role Supabase client construction: `scripts/sms-tools/backfill-twilio-log.ts`, `scripts/sms-tools/migrate-invite-reminders.ts`, `scripts/sms-tools/cleanup-phone-numbers.ts`, `scripts/fixes/fix-rpc-functions.ts`, `scripts/fixes/fix-rpc-functions-direct.ts`, and the service-role query path in `scripts/fixes/fix-api-access-simple.ts`. Fix: standardize service-role access on `createAdminClient`, add explicit read-only `--confirm` blocking for both RPC diagnostics scripts, route read queries through `assertScriptQuerySucceeded` where applicable, and preserve fail-closed non-zero exits. Regression: expanded `tests/scripts/testScriptMutationGating.test.ts` (SMS tools now enforced to use `createAdminClient` and avoid raw `@supabase/supabase-js`), expanded `tests/scripts/testFixRpcFunctionsScriptsReadOnly.test.ts` (read-only guard + admin/query helper assertions), and expanded `tests/scripts/testScriptsFailClosedCatchHandlers.test.ts` (`fix-api-access-simple` now enforced to use `createAdminClient` + query wrapper).
- `500. SCRIPT-146` (P1 follow-up): Remaining high-risk SMS cleanup/remediation scripts `scripts/sms-tools/clear-stuck-jobs.ts`, `scripts/sms-tools/clear-reminder-backlog.ts`, `scripts/sms-tools/fix-past-reminders.ts`, and `scripts/sms-tools/finalize-event-reminders.ts` still used raw `@supabase/supabase-js` service-role client wiring instead of the script-safe admin helper, leaving incident scripts inconsistent with hardened client/query guard conventions. Fix: standardize all four scripts on `createAdminClient` while preserving existing dry-run defaults, explicit multi-gating, hard caps, and fail-closed `process.exitCode = 1` behavior. Regression: added `tests/scripts/testSmsToolsReminderCleanupScriptsSafety.test.ts` to assert read-only/dry-run defaults, explicit mutation gating + caps, non-zero fail-closed semantics, script-safe `createAdminClient`/`assertScriptQuerySucceeded` usage, and no raw `@supabase/supabase-js` imports.
- `446. EVENT-017` (P1 follow-up): Event-payment SMS helpers in `src/lib/events/event-payments.ts` still returned generic non-success metadata (`code: null`) on booking/customer lookup DB errors in `sendEventPaymentConfirmationSms` and `sendEventPaymentRetrySms`, making fatal DB-read safety degradation indistinguishable from normal non-send conditions for callers that need abort signals. Fix: fail closed on these DB lookup errors by returning explicit `{ success: false, code: 'safety_unavailable', logFailure: false }` while preserving non-fatal `code: null` for expected non-send business-state conditions. Regression: extended `tests/lib/eventPaymentSmsSafetyMeta.test.ts` with booking/customer lookup DB-error cases asserting `safety_unavailable`.
- `502. SCRIPT-086` (P0 follow-up): OJ project mutation scripts (`scripts/oj-projects/fix-typo.ts`, `fix-entry-rates.ts`, `move-all-to-retainers.ts`, `move-to-website-content.ts`, `update-barons-retainer.ts`, `update-barons-retainer-hours.ts`, `add-barons-pubs-entries.ts`) still parsed `--limit` with `Number.parseInt`, so malformed cap inputs (for example `--limit=1abc`) could be silently truncated and accepted. Fix: tighten each script’s `parsePositiveInt` to strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) and throw on malformed values before any mutation gate can proceed. Regression: expanded `tests/scripts/testOjProjectsScriptsSafety.test.ts` with strict parser marker assertions and a guard forbidding the legacy `const parsed = Number.parseInt(raw, 10)` cap parser pattern.
- `500. SCRIPT-146` (P1 follow-up): Additional `scripts/database` diagnostics `scripts/database/check-api-key-database.ts` and `scripts/database/check-performance.ts` still used raw `@supabase/supabase-js` client wiring, and `check-performance.ts` measured queries with fail-open behavior that could still exit `0` when DB reads failed. Fix: standardize both scripts on `createAdminClient`, explicitly reject `--confirm` in read-only mode, route DB reads/count checks through `assertScriptQuerySucceeded`, and fail closed on any failed performance query measurement (non-zero exit). Regression: expanded `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` to cover both scripts for read-only `--confirm` blocking, script-safe query helper usage, and no raw `@supabase/supabase-js` imports.
- `445. TB-006` (P1): `alignTableCardCaptureHoldToScheduledSend` in `src/lib/table-bookings/bookings.ts` previously used `Promise.allSettled` and logged warnings on DB write errors/zero-row updates across `table_bookings`, `booking_holds`, and `card_captures`, but still returned a successful expiry value. This swallowed send-adjacent persistence failures and could falsely report aligned hold expiry state after deferred card-capture SMS scheduling. Fix: preserve warning telemetry but fail closed by throwing when any alignment write errors or affects no rows, including per-table failure markers in the thrown error message. Regression: updated `tests/lib/tableBookingHoldAlignment.test.ts` to assert throw-on-error and throw-on-zero-row behavior.
- `501. SCRIPT-085` (P1 follow-up): `scripts/menu` seed mutation scripts still parsed `--limit` with `Number.parseInt`, which can silently truncate malformed values (for example `--limit=1abc`) and weaken explicit-cap fail-closed behavior. Fix: tighten `parsePositiveInt` in all seven menu seed scripts (`seed-chefs-essentials-chips`, `seed-chefs-larder-{slow-cooked-lamb-shanks,garden-peas,buttery-mash,sweet-potato-fries}`, `seed-menu-dishes.{js,ts}`) to strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) and throw on malformed values. Regression: expanded `tests/scripts/testMenuSeedScriptsSafety.test.ts` to assert strict parser markers and forbid `Number.parseInt` truncation across each menu seed mutation script.
- `500. SCRIPT-146` (P1 follow-up): SMS diagnostics scripts `scripts/database/check-sms-issue.ts` and `scripts/database/check-table-booking-sms.ts` had regressed to raw `@supabase/supabase-js` client wiring without explicit `--confirm` read-only blocking, leaving diagnostics inconsistent with script-safe fail-closed conventions used across incident-response scripts. Fix: standardize both scripts on `createAdminClient`, explicitly reject `--confirm` in read-only mode, and route DB reads/count checks through `assertScriptQuerySucceeded` so query failures deterministically produce non-zero exits. Regression: expanded `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` with direct guards asserting read-only block markers, script-safe admin/query helper usage, and no raw `@supabase/supabase-js` imports for both scripts.
- `444. TB-005` (P1): Table-booking SMS helpers in `src/lib/table-bookings/bookings.ts` (`sendTableBookingCreatedSmsIfAllowed` and `sendSundayPreorderLinkSmsIfAllowed`) still treated `success:false + code:'logging_failed'` as unsent even when transport may already have sent and only outbound message logging failed, which can drive retry loops and duplicate sends in follow-up flows. Fix: normalize "sent/unknown" semantics for these helpers (`success || logging_failed/logFailure`) so returned `sent`/`scheduledFor`/`sms.success` stay fail-safe while preserving `code`/`logFailure` for fatal-signal handling. Regression: extended `tests/lib/tableBookingCreatedSmsMeta.test.ts` and added `tests/lib/tableBookingSundayPreorderSmsMeta.test.ts`.
- `524. SCRIPT-120` (P1 follow-up): `scripts/testing/test-api-booking-fix.ts`, `scripts/testing/test-booking-now.ts`, `scripts/testing/test-sunday-lunch-api.ts`, and `scripts/testing/test-sunday-lunch-payment-fix.ts` still parsed `--limit` with `Number.parseInt`, which silently accepted malformed cap values (for example `--limit=1abc`) and weakened fail-closed cap validation on confirm-mode send paths. Fix: switch all four scripts to strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) and throw on malformed limits before send-mode gating. Regression: expanded `tests/scripts/testTableBookingApiScriptsSafety.test.ts` to assert strict cap parser markers and forbid `Number.parseInt` truncation.
- `500. SCRIPT-146` (P1): SMS diagnostics scripts `scripts/database/check-sms-queue.ts` and `scripts/database/check-bulk-sms-jobs.ts` still used raw `@supabase/supabase-js` client wiring and had no explicit `--confirm` read-only guard, so incident diagnostics could bypass standardized read-only/fail-closed script safety conventions. Fix: standardize both scripts on `createAdminClient`, explicitly reject `--confirm` in read-only mode, and enforce query fail-closed checks via `assertScriptQuerySucceeded` so DB read failures reliably surface as non-zero exits. Regression: expanded `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` with direct guards asserting read-only block markers, script-safe admin/query helper usage, and no raw `@supabase/supabase-js` imports for both scripts.
- `443. EVENT-017` (P1): Event-payment SMS helpers (`sendEventPaymentConfirmationSms` and `sendEventPaymentRetrySms` in `src/lib/events/event-payments.ts`) previously only logged `code`/`logFailure` and returned `void`, so callers could not receive fatal safety metadata (`logging_failed`, `safety_unavailable`, `idempotency_conflict`) from Stripe-triggered send paths. Fix: both helpers now return normalized safety metadata `{ success, code, logFailure }` while preserving existing logging behavior. Regression: extended `tests/lib/eventPaymentSmsSafetyMeta.test.ts`.
- `442. MSG-008` (P1): `MessageService.sendReply` (`src/services/messages.ts`) previously threw a generic error on `sendSMS` non-success outcomes, dropping safety metadata (`code`, `logFailure`) from caller-visible results and obscuring fatal safety signals near reply send paths. Fix: return structured non-success results that preserve `code`/`logFailure` (including normalized `logging_failed`) instead of throwing. Regression: extended `tests/services/messages.service.test.ts`.
- `539. SCRIPT-143` (P1 follow-up): `scripts/testing/test-api-complete-fix.ts` still had an explicit-cap bypass in confirm mode: `--max-bookings` values were clamped (`Math.min`) instead of fail-closed rejected when above hard cap, and cap checks only counted create-intent tests, allowing additional outbound POST requests (`invalid` test path) without matching cap acknowledgement. Fix: enforce strict integer `--max-bookings` validation with hard cap `4`, fail closed when above hard cap, and enforce `plannedRequests <= cap` before any POST is sent. Regression: added `tests/scripts/testApiCompleteFixScriptSafety.test.ts` and validated compatibility with `tests/scripts/testNoHardcodedApiKeysInScripts.test.ts`.
- `516. SCRIPT-111` (P1 follow-up): `scripts/setup-dev-user.ts` still lacked an explicit mutation cap despite being a DB-mutating root script, so confirmed runs could proceed without explicit operator cap acknowledgement. Fix: require explicit `--limit=1` in mutation mode (hard cap `1`) and fail closed on missing/invalid/exceeding cap values while preserving existing multi-gating (`--confirm` + `RUN_SETUP_DEV_USER_MUTATION` + `ALLOW_SETUP_DEV_USER_MUTATION_SCRIPT`). Regression: expanded `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts` with explicit cap marker/enforcement assertions for `setup-dev-user`.
- `499. SCRIPT-145` (P1): SMS diagnostics script `scripts/database/check-sms-jobs.ts` still used raw `@supabase/supabase-js` client construction and had no explicit `--confirm` read-only guard, leaving incident-response script safety inconsistent with hardened read-only/fail-closed patterns. Fix: switch to script-safe admin client usage (`createAdminClient`), explicitly block `--confirm` in this read-only script, and route all query checks through `assertScriptQuerySucceeded` for deterministic non-zero behavior on DB read failures. Regression: expanded `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` with a direct `check-sms-jobs.ts` guard assertion (read-only block + script-safe query helper usage + no raw `@supabase/supabase-js` import).
- `540. SCRIPT-144` (P1): `scripts/testing/test-sms-new-customer.ts` still had fail-open diagnostic paths that logged and continued without non-zero exit on critical safety failures (missing Twilio sender/credentials, Twilio connectivity failure, and pending-bookings lookup failure), allowing false-green outcomes during incident diagnostics. Fix: enforce fail-closed semantics on these paths via `markFailure(...)`, require a phone target when send mode is enabled, and keep send mode blocked unless explicit `--limit=1` and multi-gating are satisfied. Regression: expanded `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` to assert fail-closed markers for Twilio/db failures and required send-target enforcement.
- `539. SCRIPT-143` (P1): Remaining mutation/send diagnostics in `scripts/testing` (`scripts/testing/test-booking-api.ts`, `scripts/testing/test-sms-new-customer.ts`) still allowed confirmed mutation/send mode without an explicit operator cap, violating the explicit-cap hardening rule for side-effecting scripts. Fix: require explicit `--limit=1` in mutation/send mode for both scripts (hard cap `1`), add helper-level cap parsing/validation in `src/lib/test-sms-new-customer-safety.ts`, and update operator guidance strings to include required caps. Regression: expanded `tests/scripts/testBookingApiScriptSafety.test.ts`, `tests/lib/testSmsNewCustomerSafety.test.ts`, and `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` to enforce cap markers, cap parsing/hard-cap validation, and fail-closed send-mode safety checks.
- `498. SCRIPT-142` (P1): `scripts/database/check-deployment-status.ts` allowed confirm-mode send execution without an explicit operator cap, so mutation/send mode relied on gating without requiring explicit per-run cap acknowledgement. Fix: add explicit cap parsing (`--limit` / `CHECK_DEPLOYMENT_STATUS_LIMIT`), require `--limit=1` in confirm mode (hard cap `1`), and fail closed when planned requests exceed the declared cap before any send path executes. Regression: expanded `tests/scripts/testNoHardcodedApiKeysInScripts.test.ts` and `tests/scripts/testScriptMutationGating.test.ts` to enforce required cap markers, multi-gating requirements, and fail-closed script semantics.
- `538. SCRIPT-141` (P1): Remaining SMS send-test scripts in `scripts/testing` (`scripts/testing/test-table-booking-sms.ts`, `scripts/testing/test-enrollment-with-sms.ts`) still did not require an explicit per-run mutation cap, so a confirmed send path could run without explicit operator cap acknowledgement. Fix: add explicit `--limit` parsing and hard-cap enforcement in `src/lib/test-table-booking-sms-safety.ts` and `src/lib/test-enrollment-with-sms-safety.ts`, require `--limit=1` in both send scripts alongside existing multi-gating (`--confirm` + `RUN_*` + `ALLOW_*`), and update read-only guidance to include the required cap flag. Regression: expanded `tests/lib/testTableBookingSmsSafety.test.ts`, `tests/lib/testEnrollmentWithSmsSafety.test.ts`, and `tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts` to enforce cap parsing, hard-cap validation, and script cap marker usage.
- `537. SCRIPT-138` (P1): Remaining SMS send-test scripts in `scripts/testing` (`scripts/testing/test-table-booking-sms.ts`, `scripts/testing/test-enrollment-with-sms.ts`) still used raw `@supabase/supabase-js` clients and ad-hoc query checks on pre-send lookup paths, leaving reliability inconsistent with hardened fail-closed query handling. Fix: standardize both scripts to use `createAdminClient` + `assertScriptQuerySucceeded` for customer/booking/template reads while preserving existing multi-gating send controls and non-zero failure semantics via `process.exitCode=1` (no `process.exit`). Regression: expanded `tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts` to enforce script-safe imports/query wrappers and prohibit raw `@supabase/supabase-js`.
- `536. SCRIPT-137` (P1): Remaining read-only SMS diagnostics in `scripts/testing` (`scripts/testing/test-private-booking-customer-creation.ts`, `scripts/testing/test-loyalty-enrollment.ts`, `scripts/testing/test-sms-flow.ts`) still used raw `@supabase/supabase-js` clients and ad-hoc query handling, and `test-sms-flow.ts` did not explicitly block `--confirm`. Fix: standardize all three to script-safe read-only patterns by using `createAdminClient` + `assertScriptQuerySucceeded`, explicitly block `--confirm` in `test-sms-flow.ts`, and keep fail-closed non-zero exits via `process.exitCode=1` (no `process.exit`). Regression: expanded `tests/scripts/testPrivateBookingCustomerCreationScriptReadOnly.test.ts`, `tests/scripts/testLoyaltyEnrollmentScriptReadOnly.test.ts`, and `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` to enforce script-safe imports/query wrappers and explicit read-only guard behavior.
- `497. SCRIPT-140` (P1): Two remaining cleanup mutation scripts in owned scope (`scripts/cleanup/delete-specific-invoice.ts`, `scripts/cleanup/delete-test-bookings.ts`) still allowed mutation mode without explicit operator caps, relying only on explicit booking/invoice targets. Fix: require explicit `--limit=1` in mutation mode for both scripts, add helper-level cap parsing/hard-cap assertions in `src/lib/delete-test-bookings-safety.ts`, and fail closed when matched rows exceed declared cap. Regression: expanded `tests/lib/deleteTestBookingsSafety.test.ts`, `tests/lib/deleteInvoiceCleanupSafety.test.ts`, `tests/scripts/testSmsCleanupScriptsSafety.test.ts`, and `tests/scripts/testScriptMutationGating.test.ts` to enforce cap markers/parsing plus read-only multi-gating semantics.
- `496. SCRIPT-139` (P1): High-risk cleanup mutation scripts in owned scope (`scripts/cleanup/delete-test-invoices.ts`, `scripts/cleanup/delete-peter-pitcher-bookings.ts`, `scripts/cleanup/delete-peter-test-bookings.ts`, `scripts/cleanup/delete-all-table-bookings.ts`) still entered mutation mode without explicit operator caps, so one confirmed run could delete an unbounded number of rows. Fix: require explicit `--limit` in mutation mode for all four scripts, add helper-level hard-cap assertions (`200` for targeted invoice/booking cleanup scripts; `10000` for delete-all-table-bookings), and fail closed when matched/planned rows exceed the declared limit. Regression: expanded `tests/lib/deleteInvoiceCleanupSafety.test.ts`, `tests/lib/deletePeterPitcherBookingsSafety.test.ts`, `tests/lib/deletePeterTestBookingsSafety.test.ts`, `tests/lib/deleteAllTableBookingsSafety.test.ts`, and `tests/scripts/testSmsCleanupScriptsSafety.test.ts` to enforce cap parsing/hard caps plus read-only and multi-gating markers.
- `495. SCRIPT-136` (P1): Three mutation-enabled fix scripts in owned scope still relied on implicit single-target behavior without an explicit hard cap flag, violating the incident-hardening requirement for explicit caps on mutation/send paths: `scripts/fixes/fix-table-booking-api-permissions.ts`, `scripts/fixes/fix-pending-payment.ts`, and the `--write-probe` path in `scripts/fixes/fix-table-booking-sms.ts`. Fix: require explicit `--limit=1` in mutation mode for all three paths (with helper-level hard-cap assertions), keep existing multi-gating (`--confirm` + `RUN_*` + `ALLOW_*`), and preserve fail-closed exits (`process.exitCode = 1`). Regression: expanded `tests/scripts/testScriptMutationGating.test.ts` and helper safety suites `tests/lib/fixTableBookingApiPermissionsScriptSafety.test.ts`, `tests/lib/pendingPaymentFixSafety.test.ts`, and `tests/lib/tableBookingSmsFixSafety.test.ts` to enforce required cap parsing/validation (`--limit` must be `1`) plus gating semantics.
- `535. SCRIPT-135` (P1): Additional read-only diagnostics in `scripts/testing` (`scripts/testing/test-demographics.ts`, `scripts/testing/test-employee-creation.ts`, `scripts/testing/test-analytics-function.ts`) still used raw service-role `@supabase/supabase-js` clients and ad-hoc query error handling, which left script reliability inconsistent with the hardened fail-closed pattern. Fix: standardize all three to block `--confirm`, use `createAdminClient` + `assertScriptQuerySucceeded` for deterministic fail-closed DB/RPC reads, and keep top-level non-zero failure semantics via `process.exitCode=1` (no `process.exit`). Regression: expanded `tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts`, `tests/scripts/testDemographicsScriptReadOnly.test.ts`, and `tests/scripts/testEmployeeCreationScriptReadOnly.test.ts` to enforce script-safe imports, fail-closed query wrappers, and no raw `@supabase/supabase-js`.
- `534. SCRIPT-133` (P1): Additional `scripts/testing` diagnostics (`scripts/testing/test-critical-flows.ts`, `scripts/testing/test-short-link.ts`, `scripts/testing/test-vip-club-redirect.ts`) still used raw service-role `@supabase/supabase-js` clients and ad-hoc query handling, which made script reliability inconsistent with the hardened read-only fail-closed pattern. Fix: standardize all three to block `--confirm`, use `createAdminClient` + `assertScriptQuerySucceeded` for fail-closed DB/RPC reads, and keep top-level non-zero failure handling via `process.exitCode=1` (no `process.exit`). Regression: expanded `tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts` and `tests/scripts/testCriticalFlowsScriptReadOnly.test.ts` to enforce script-safe imports, fail-closed query wrappers, no raw `@supabase/supabase-js`, and non-zero failure semantics.
- `494. SCRIPT-134` (P1): Remaining utility fix scripts in owned scope were not reliably fail-closed and used unsafe defaults. `scripts/fixes/fix-api-access-simple.ts` embedded a hard-coded production `key_hash`, selected broad key data, and could return success after service-role lookup failures; `scripts/fixes/fix-google-service-key.ts` still used forced `process.exit(1)` paths, did not deterministically await auth validation outcomes, and wrote output JSON by default. Fix: harden both scripts to block `--confirm`, remove hard-coded key targeting, require an explicit validated `--key-hash` (or `API_KEY_HASH`) for API-key diagnostics, route all fatal paths through `process.exitCode = 1` (no `process.exit`), and default the Google key helper to read-only behavior with optional `--write-json` and `--output-path` for local writes. Regression: expanded `tests/scripts/testScriptsFailClosedCatchHandlers.test.ts` to assert both scripts remain read-only by default and fail closed.
- `493. SCRIPT-132` (P1): Remaining mutation-capable script batch in `scripts/sms-tools` and `scripts/cleanup` still used top-level `process.exit(1)` (`scripts/sms-tools/backfill-twilio-log.ts`, `scripts/sms-tools/fix-past-reminders.ts`, `scripts/sms-tools/finalize-event-reminders.ts`, `scripts/sms-tools/migrate-invite-reminders.ts`, `scripts/sms-tools/cleanup-phone-numbers.ts`, `scripts/sms-tools/clear-stuck-jobs.ts`, `scripts/sms-tools/clear-reminder-backlog.ts`, `scripts/cleanup/delete-test-invoices.ts`, `scripts/cleanup/delete-specific-invoice.ts`, `scripts/cleanup/delete-peter-pitcher-bookings.ts`, `scripts/cleanup/delete-peter-test-bookings.ts`, `scripts/cleanup/delete-all-table-bookings.ts`), which made fail-closed behavior harder to assert consistently in script safety harnesses. Fix: replace terminal `process.exit(1)` paths with `process.exitCode = 1` so failures remain non-zero while preserving deterministic completion semantics and shared fail-closed assertions. Regression: expanded `tests/scripts/testScriptMutationGating.test.ts` and `tests/scripts/testSmsCleanupScriptsSafety.test.ts` to enforce gating/caps plus `process.exitCode` usage and forbid `process.exit(` in this script set.
- `492. SCRIPT-131` (P1): Remaining `scripts/database` schema/migration/client check scripts (`scripts/database/check-customer-schema.ts`, `scripts/database/check-event-categories-migration.ts`, `scripts/database/check-migration-history.ts`, `scripts/database/check-migration-simple.ts`, `scripts/database/check-migrations.ts`, `scripts/database/check-schema-admin.ts`, `scripts/database/check-schema-env.ts`, `scripts/database/check-supabase-clients.ts`) were not safe/reliable for incident response: several used a `node` shebang on TypeScript (not runnable), loaded env from `.env` or via brittle relative paths, used ad-hoc Supabase clients, contained non-ASCII/emoji log markers, performed unbounded reads (e.g., full slug scans), printed sample PII, and/or used `process.exit(...)` / fail-open error handling. Fix: rewrite all eight as runnable `tsx` scripts that load `.env.local` from `process.cwd()`, use `createAdminClient`, block `--confirm` (strict read-only), add explicit caps (`--limit`, `--max-print`, `--max-slugs`) and PII masking for sample output, remove `process.exit(...)` in favor of fail-closed `process.exitCode=1` + completion assertions, and standardize logs to ASCII-only. Regression: expanded `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` to cover all eight scripts (tsx shebang, fail-closed, no `process.exit`, and no DB mutations).
- `491. SCRIPT-126` (P1): Additional `scripts/database` read-only diagnostics (`scripts/database/check-attendance-dates.ts`, `scripts/database/check-booking-discount.ts`, `scripts/database/check-current-schema.ts`, `scripts/database/check-customer-phone.ts`, `scripts/database/check-customers-and-labels.ts`, `scripts/database/check-event-images.ts`, `scripts/database/check-pending-booking.ts`, `scripts/database/check-recent-attendance.ts`, `scripts/database/check-table-bookings-structure.ts`) previously used legacy/broken Supabase client patterns (`supabase-singleton` / Next.js server clients), embedded hard-coded production identifiers (booking IDs, event IDs, default phone), printed PII, and/or used `process.exit(...)` / fail-open error handling that could exit `0` after failed reads. Fix: rewrite as runnable `tsx` scripts using `createAdminClient`, load `.env.local` from `process.cwd()`, block `--confirm` (strict read-only), require explicit targeting flags (`--phone`, `--token`, `--booking-id`, `--event-id`), add explicit caps (`--limit` hard caps) where applicable, mask phone output, and fail closed via `process.exitCode=1` + `assertScriptQuerySucceeded` (no `process.exit`). Regression: expanded `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` to cover all scripts above.
- `490. SCRIPT-125` (P1): Remaining fail-open `scripts/database` diagnostics (`scripts/database/check-audit-logs.ts`, `scripts/database/check-booking-duplicates.ts`, `scripts/database/check-booking-errors.ts`, `scripts/database/check-sunday-lunch-orders.ts`, `scripts/database/check-sunday-lunch-table.ts`, `scripts/database/check-venue-spaces.ts`, `scripts/database/check-payment-status.ts`, `scripts/database/check-latest-booking-details.ts`) previously failed open (log-and-return without non-zero exit), used legacy/broken Supabase client patterns (`supabase-singleton` / Next.js server clients), ran unbounded queries, and `check-booking-errors` attempted to queue SMS via a server action with no gating. Fix: standardize all eight scripts as runnable `tsx` diagnostics using `createAdminClient`, load `.env.local` from `process.cwd()`, block `--confirm` (strict read-only), require explicit targeting where applicable (`--booking-ref` / `--latest`), enforce bounded sampling (`--limit` hard caps), and fail closed via `process.exitCode=1` + `assertScriptQuerySucceeded` (no `process.exit`). Regression: expanded `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` to cover all eight scripts.
- `533. SCRIPT-131` (P1): Remaining analysis diagnostics (`scripts/analysis/analyze-private-bookings-customers.ts`, `scripts/analysis/analyze-performance.ts`) previously used raw service-role `@supabase/supabase-js` clients, loaded `.env`/ad-hoc env paths, skipped query error checks, and lacked explicit read-only guards, creating false-green risk and brittle incident diagnostics. Fix: rewrite both as strictly read-only `tsx` scripts that block `--confirm`, load `.env.local` from `process.cwd()`, use `createAdminClient` + `assertScriptQuerySucceeded` for fail-closed query/RPC handling, add safer output handling (masked phone/email sampling in private-booking diagnostics), and standardize top-level fail-closed exits via `process.exitCode=1` (no `process.exit`). Regression: extend `tests/scripts/testAnalysisScriptsFailClosed.test.ts` to cover both scripts and forbid raw `@supabase/supabase-js` usage.
- `532. SCRIPT-130` (P1): Remaining analysis scripts (`scripts/analysis/analyze-duplicates-detailed.ts`, `scripts/analysis/calibrate-hiring-thresholds.ts`, `scripts/analysis/evaluate-hiring-screening.ts`) previously used raw service-role `createClient` patterns, loaded a non-existent `.env` file (hiring scripts), swallowed query errors (duplicates analysis could exit `0` after failed reads), and used `process.exit(1)` in catch blocks, making incident diagnostics brittle and harder to regression-test. Fix: rewrite all three as strictly read-only `tsx` scripts that block `--confirm`, load `.env.local` from `process.cwd()`, use `createAdminClient` + `assertScriptQuerySucceeded` for fail-closed query handling (including overrides query error checks), fix a string repetition bug (`'=' * 80` -> `repeat`), and standardize on `process.exitCode=1` (no `process.exit`). Regression: expand `tests/scripts/testAnalysisScriptsFailClosed.test.ts` to cover these scripts and forbid `@supabase/supabase-js` imports / `process.exit` usage.
- `531. SCRIPT-129` (P1): Private-bookings calendar resync script (`scripts/tools/resync-private-bookings-calendar.ts`) previously imported a non-exported Next.js server-only Supabase client and could crash at runtime, undermining operational tooling reliability even in dry-run mode. Fix: switch to script-safe imports (`createAdminClient` from `@/lib/supabase/admin` + calendar helpers from `@/lib/google-calendar` + types from `@/types/private-bookings`) and ensure the script contains no Next.js server runtime imports (`next/headers`). Regression: update `tests/scripts/testResyncPrivateBookingsCalendarScriptSafety.test.ts` to assert script-safe imports and forbid `supabase/server` / `next/headers`.
- `530. SCRIPT-128` (P1): Backfill scripts (`scripts/backfill/cancelled-parking.ts`, `scripts/backfill/employee-birthdays-to-calendar.ts`) previously performed production mutations / Google Calendar writes with unsafe defaults (missing dry-run defaults, weak gating, and missing caps) and used forced exits (`process.exit(...)`), increasing risk of unbounded backfills during incident response. Fix: rewrite both as `tsx` scripts that default to DRY RUN, require explicit `--confirm` plus multi-gating env vars (`RUN_PARKING_CANCELLED_BACKFILL_MUTATION=true` + `ALLOW_PARKING_CANCELLED_BACKFILL_SCRIPT=true`; `RUN_EMPLOYEE_BIRTHDAYS_CALENDAR_SYNC=true` + `ALLOW_EMPLOYEE_BIRTHDAYS_CALENDAR_SYNC_SCRIPT=true`), require explicit caps (`--limit` with hard caps; allow `--booking-id` as implicit cap=1 for cancelled-parking), enforce strict row-effect assertions, and fail closed via `process.exitCode=1` (no `process.exit`). Regression: add `tests/scripts/testBackfillScriptsSafety.test.ts` enforcing dry-run defaults, multi-gating strings, cap requirements, and forbidding `process.exit`.
- `529. SCRIPT-127` (P1): Messages permissions analysis script (`scripts/analysis/analyze-messages-permissions.ts`) previously used a `node` shebang for TypeScript, swallowed unexpected errors (logging and continuing), and exited `0` even when Supabase queries failed, producing false-green RBAC diagnostics during incident response. Fix: rewrite as a strictly read-only `tsx` script that blocks `--confirm`, uses `createAdminClient` + `assertScriptQuerySucceeded` for fail-closed query handling (supports both `permissions/role_permissions` and `rbac_*` schemas), removes all `process.exit(...)` usage in favor of fail-closed `process.exitCode=1`, and adds a regression guard `tests/scripts/testAnalysisScriptsFailClosed.test.ts`.
- `528. SCRIPT-126` (P1): Root-level hiring diagnostic script (`scripts/debug-candidates.ts`) previously queried `hiring_candidates` with a raw service-role `createClient` + non-null env assertions, selected `*`, printed PII (email + parsed_data), and failed open (no non-zero exit on query errors) with no `--confirm` blocking. Fix: rewrite as a strictly read-only script that blocks `--confirm`, adds explicit `--limit` caps (hard cap 200) plus optional `--first-name-ilike`, masks PII in logs, uses `createAdminClient` + `assertScriptQuerySucceeded` for fail-closed query handling, and exits non-zero via `process.exitCode=1` on errors (no `process.exit`). Regression: expanded `tests/scripts/testRootDebugScriptsFailClosed.test.ts` to cover `scripts/debug-candidates.ts` and forbid `select('*')` / PII debug labels / `process.exit`.
- `527. SCRIPT-125` (P1): Several remaining root-level diagnostic scripts (`scripts/check-employee-status.ts`, `scripts/check-golden-barrels-projects.ts`, `scripts/check-golden-barrels-status.ts`, `scripts/debug-schema.ts`, `scripts/debug-outstanding.ts`) previously failed open (no non-zero exit on query errors or invalid-status checks), ignored Supabase errors, used hard-coded production identifiers (vendor IDs, invoice numbers, dates), and/or ran unbounded queries. Fix: rewrite as strictly read-only scripts that block `--confirm`, require explicit targeting where needed (`--vendor-id`) and add explicit `--limit` caps (hard caps) for output, remove hard-coded production identifiers, and route DB/RPC errors through `assertScriptQuerySucceeded` with fail-closed `process.exitCode=1` (no `process.exit`). Regression: expanded `tests/scripts/testRootDebugScriptsFailClosed.test.ts` to cover all of the above scripts and forbid `process.exit` / hard-coded identifiers.
- `526. SCRIPT-124` (P1): Root-level utility scripts (`scripts/reproduce_availability.js`, `scripts/create-placeholder-icons.js`) previously had fail-open/unstable behavior (hard-coded production date/timezone drift, missing required args, and/or no fail-closed exit semantics) which could produce false-green diagnostics or hide failures. Fix: rewrite `scripts/reproduce_availability.js` as strictly read-only (blocks `--confirm`), requires explicit `--date YYYY-MM-DD`, uses stable UTC day-of-week for `day_of_week`, enforces an interval hard cap, and fails closed via `process.exitCode=1`; rewrite `scripts/create-placeholder-icons.js` to fail closed on missing source logo or any copy error via `process.exitCode=1` (no `process.exit`). Regression: extended `tests/scripts/testRootDebugScriptsFailClosed.test.ts` to cover both scripts and forbid `process.exit` / hard-coded production dates.
- `525. SCRIPT-121` (P1): Root-level debug scripts (`scripts/debug-booking-payment.ts`, `scripts/debug-booking-payment-records.ts`, `scripts/check-booking-state.ts`, `scripts/debug-bookings.ts`, `scripts/debug-business-hours.ts`, `scripts/check_hours_debug.ts`, `scripts/check_hours_debug.js`, `scripts/fetch-events-for-categorization.ts`) previously embedded hard-coded production identifiers (booking refs/tokens/dates), used `process.exit(...)`, and swallowed Supabase errors (`console.error` + `return`) which could exit `0` after failed reads (false-green diagnostics). Fix: rewrite as strictly read-only scripts that block `--confirm`, require explicit targeting flags (`--booking-ref`, `--token`, `--special-date`, `--limit`), cap large outputs, remove `process.exit(...)` in favor of fail-closed `process.exitCode=1`, and throw on any env/query failures. Regression: `tests/scripts/testRootDebugScriptsFailClosed.test.ts`.
- `524. SCRIPT-120` (P1): Table booking API diagnostics scripts (`scripts/testing/test-api-booking-fix.ts`, `scripts/testing/test-booking-now.ts`, `scripts/testing/test-sunday-lunch-api.ts`, `scripts/testing/test-sunday-lunch-payment-fix.ts`) previously allowed `--confirm` POSTs (booking creation with outbound side effects) without an explicit per-run cap, and one script could send multiple requests via `--include-optional`. Fix: require explicit `--limit` caps (hard cap `1` or `2`, depending on script) in mutation mode in addition to existing multi-gating; log planned requests and cap preflight; and fail closed on cap violations. Regression: updated `tests/scripts/testTableBookingApiScriptsSafety.test.ts`.
- `523. SCRIPT-119` (P1): Hiring flow verification script (`scripts/verify-hiring-flow.ts`) previously supported mutation mode without an explicit cap, making it easier to accidentally create/delete hiring rows during debugging. Fix: require explicit `--limit=1` (hard cap `1`) in mutation mode in addition to existing multi-gating (`--confirm` + `RUN_VERIFY_HIRING_FLOW_MUTATION=true` + `ALLOW_VERIFY_HIRING_FLOW_MUTATION_SCRIPT=true`) and fail closed when missing/mismatched. Regression: updated `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts`.
- `522. SCRIPT-118` (P0): Job maintenance scripts (`scripts/reset-jobs.ts`, `scripts/retry-failed-jobs.ts`, `scripts/process-jobs.ts`) previously supported production mutations with weak/no dry-run defaults, no mandatory caps, and `process.exit(...)` patterns, increasing risk of retry-driven SMS fanout (jobs can include `send_sms`/`send_bulk_sms`). Fix: default all three to DRY RUN; require explicit multi-gating for any mutation (`--confirm` + `RUN_*` + `ALLOW_*`) plus mandatory `--limit` with hard caps (`500`); update only explicitly selected job IDs with strict row-effect checks; and add an extra gate `ALLOW_JOB_RETRY_SEND_TYPES=true` when retry selection includes send job types. Fail closed via `process.exitCode=1` (no `process.exit`). Regression: `tests/scripts/testJobProcessingScriptsSafety.test.ts`, `tests/lib/jobRetryScriptSafety.test.ts`.
- `521. SCRIPT-117` (P0): Invoice reminder trigger script (`scripts/trigger-invoice-reminders.ts`) previously performed production side effects by default (email sends, invoice status updates, audit log inserts) behind only a single allow env guard, with no dry-run default, no explicit caps/limits, `process.exit(...)` fail-open termination, and a silent production URL fallback. Fix: rewrite to default DRY RUN; require explicit multi-gating for any mutations (`--confirm` + `RUN_TRIGGER_INVOICE_REMINDERS_MUTATION=true` + `ALLOW_INVOICE_REMINDER_TRIGGER_SCRIPT=true`) plus explicit `--limit` (hard cap `50`) and explicit app base URL (`NEXT_PUBLIC_APP_URL` or `--url https://...`); require Microsoft Graph to be configured and `MICROSOFT_USER_EMAIL` to be set; cap parsed vendor recipients; and fail closed via `process.exitCode=1` (no `process.exit`). Regression: extended `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts`.
- `520. SCRIPT-116` (P0): CV reprocess script (`scripts/reprocess-cvs.ts`) previously reset *all* completed `parse_cv` jobs back to `pending` with a service-role client, with no dry-run default, no `--confirm`, no explicit caps, and fail-open error handling (`console.error` without non-zero exit). Fix: rewrite to default DRY RUN; require explicit multi-gating (`--confirm` + `RUN_REPROCESS_CVS_MUTATION=true` + `ALLOW_REPROCESS_CVS_MUTATION_SCRIPT=true`) plus explicit `--limit` (hard cap `500`); select job IDs first and update only by selected IDs with strict row-effect checks; and fail closed via `process.exitCode=1` (no `process.exit`). Regression: extended `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts`. Coordination note: this script mutates the `jobs` table (ensure Dev3 is aligned if their jobs/SMS work overlaps).
- `519. SCRIPT-115` (P1): Golden Barrels maintenance scripts (`scripts/insert-golden-barrels-hours.ts`, `scripts/rectify-golden-barrels.ts`) previously inserted/updated billing settings/projects/work types/entries by default (including hardcoded IDs in `rectify`), with no dry-run default, no multi-gating, no explicit caps, and non-deterministic error handling. Fix: rewrite both to default DRY RUN; require explicit multi-gating (`--confirm` + script `RUN_*` + `ALLOW_*`) plus explicit `--limit` hard caps (entries hard cap `50`; cleanup hard cap `5000`); require explicit targeting via `--vendor-id`/`--project-id` (or env overrides); require explicit `--create-missing` before any vendor/settings/work-type creation; enforce strict row-effect checks; and fail closed via `process.exitCode=1`. Regression: extended `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts`.
- `518. SCRIPT-114` (P0): Employee document import script (`scripts/import-employee-documents.ts`) previously supported `--commit` with no env-based gating, an unbounded default `--limit`, and used `process.exit(...)`, making it easy to accidentally bulk-import sensitive employee documents and still exit 0 on partial failure patterns. Fix: default to DRY RUN; require explicit multi-gating (`--confirm`/`--commit` + `RUN_IMPORT_EMPLOYEE_DOCUMENTS_MUTATION=true` + `ALLOW_IMPORT_EMPLOYEE_DOCUMENTS_MUTATION_SCRIPT=true`) plus explicit `--limit` (hard cap `500`) before any DB/storage writes; create the local `temp/` output directory deterministically; and fail closed via `process.exitCode=1` with completion assertions (no `process.exit`). Regression: extended `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts`.
- `517. SCRIPT-113` (P1): Event categorization script (`scripts/apply-event-categorization.ts`) previously inserted missing categories and updated event rows by default using a service-role client, with no dry-run default, no explicit caps, and fail-open patterns (`process.exit(...)` and `.catch(console.error)`). Fix: rewrite to default DRY RUN; require explicit multi-gating (`--confirm` + `RUN_APPLY_EVENT_CATEGORIZATION_MUTATION=true` + `ALLOW_APPLY_EVENT_CATEGORIZATION_MUTATION_SCRIPT=true`) plus explicit `--limit` (hard cap `200`) before any inserts/updates; enforce strict query/mutation row-effect assertions; and fail closed via `process.exitCode=1` (no `process.exit`). Regression: extended `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts`.
- `516. SCRIPT-111` (P0): Dev-user bootstrap script (`scripts/setup-dev-user.ts`) previously created (or reset) a `super_admin` user by default with hardcoded credentials, attempted role assignment without dry-run defaults, and used `process.exit(...)`, creating production privilege-escalation and secret-leakage risk. Fix: default to DRY RUN; require explicit multi-gating (`--confirm` + `RUN_SETUP_DEV_USER_MUTATION=true` + `ALLOW_SETUP_DEV_USER_MUTATION_SCRIPT=true`) plus explicit `--email`, `--password`, and `--role` (no baked-in defaults); optional `--reset-password`; enforce strict row-effect checks for role assignment; and fail closed via `process.exitCode=1` (no `process.exit`). Regression: extended `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts`.
- `515. SCRIPT-110` (P0): Booking flag fix script (`scripts/fix-bookings-is-reminder-only.ts`) previously performed unbounded production updates behind a single allow env gate (no dry-run default, no `--confirm`, no explicit caps) and used `process.exit(...)`, risking accidental broad booking mutations and false-green runs. Fix: default to DRY RUN; require explicit multi-gating (`--confirm` + `RUN_FIX_BOOKINGS_IS_REMINDER_ONLY_MUTATION=true` + allow env), require `--limit` with hard cap (`500`), update only selected IDs, enforce strict row-effect assertions, and fail closed via `process.exitCode=1` (no `process.exit`). Regression: extended `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts`.
- `514. SCRIPT-109` (P0): Root cashing-up seed/cleanup scripts (`scripts/seed-cashing-up.ts`, `scripts/seed-cashup-targets.ts`, `scripts/clear-2025-data.ts`) previously performed high-risk mutations by default (service-role inserts/upserts/deletes) with no dry-run default, weak/no gating, and missing caps/strict row-effect checks (including unbounded year-wide deletes). Fix: rewrite to default DRY RUN; require explicit multi-gating (`--confirm` + script `RUN_*` + `ALLOW_*`) plus explicit `--limit` hard caps; require explicit targeting (`--site-id` for targets; `--site-id` + `--user-id` for cashup sessions); use `createAdminClient` + strict query/mutation assertions; and fail closed via `process.exitCode=1` (no `process.exit`). Regression: extended `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts`.
- `513. SCRIPT-106` (P1): SMS diagnostic tool (`scripts/testing/test-and-fix-sms.ts`) previously used `process.exit(1)` on env/diagnostic failures and did not explicitly block `--confirm`, making it harder to test and increasing the chance of false-green diagnostic runs if errors were handled inconsistently. Fix: block `--confirm` (read-only), replace all `process.exit(...)` calls with fail-closed `process.exitCode=1` returns, and extend regression coverage to forbid `process.exit` in this script. Regression: updated `tests/scripts/testAndFixSmsScriptReadOnly.test.ts`.
- `512. SCRIPT-105` (P1): Deployment health-check script (`scripts/testing/test-deployment.ts`) previously returned success on connectivity failures (early `return` from catch) and depended on `node-fetch`. Fix: rewrite as a strictly read-only GET-only diagnostic (blocks `--confirm`), default to production URL but allows `--url` override, and fail closed via `process.exitCode=1` when the site is unreachable or health-check fetches error. Regression: `tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts`.
- `511. SCRIPT-104` (P1): Menu display diagnostic (`scripts/testing/test-menu-display.ts`) previously hardcoded a production booking reference and printed full API payloads without any explicit targeting or failure signaling. Fix: require explicit `--booking-ref` (or `TEST_MENU_DISPLAY_BOOKING_REF`), keep the script strictly read-only (blocks `--confirm`), and fail closed when the public API payload is missing expected item fields (`custom_item_name`, `guest_name`, `special_requests`, `item_type`) or when the request fails. Regression: `tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts`.
- `510. SCRIPT-103` (P1): Template diagnostics scripts (`scripts/testing/{test-template-loading,test-template-fix,test-production-templates,test-production-template-fix}.ts`) were runtime-broken (importing a non-existent `src/lib/smsTemplates` module and/or calling a removed debug endpoint) and could fail open. Fix: rewrite as strictly read-only diagnostics (block `--confirm`) using `createAdminClient` and `rpc('get_message_template', ...)` plus `message_templates` row inventory; fail closed via `process.exitCode=1` when templates/RPC results are missing or any query/RPC errors occur. Regression: `tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts`.
- `509. SCRIPT-102` (P1): SMS send testing script (`scripts/testing/test-table-booking-sms.ts`) previously logged booking/template query errors and returned early without setting a non-zero exit code, producing false-green diagnostics. Fix: treat booking lookup failures, missing bookings, missing templates, and opt-out blocking as failures via `markFailure(...)` (sets `process.exitCode=1`). Regression: extended `tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts` to assert these fail-closed guards.
- `508. SCRIPT-092` (P1): Several remaining `scripts/testing/` diagnostics were runtime-broken or fail-open (wrong Supabase imports from Next.js server modules, `process.exit(...)`, and returning success on query/check failures). Fix: standardize on `createAdminClient` (`@/lib/supabase/admin`) for scripts, block `--confirm` for read-only diagnostics, use `process.exitCode=1` fail-closed handling, and ensure check scripts exit non-zero when checks fail (e.g. redirect mismatch, missing sample rows for PDF generation). Updated scripts: `scripts/testing/{test-calendar-sync,test-audit-log,test-audit-log-rls,test-sunday-lunch-menu,test-connectivity,test-pdf-generation,dump-events-api,check-shortlink-redirect,test-private-booking-customer-creation,test-loyalty-enrollment}.ts`. Regression: `tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts`, `tests/scripts/testCalendarSyncScriptsReadOnly.test.ts`, `tests/scripts/testAuditLogScriptsReadOnly.test.ts`, `tests/scripts/testPrivateBookingCustomerCreationScriptReadOnly.test.ts`, `tests/scripts/testLoyaltyEnrollmentScriptReadOnly.test.ts`. Note: also fixed a TS narrow-to-never error handling branch in `src/app/api/external/performer-interest/route.ts` to keep `tsc --noEmit` green.
- `507. SCRIPT-091` (P0): `scripts/testing/test-microsoft-graph-email.ts` previously sent an email by default (external side effect) and could leak secret fragments. Fix: default to DRY RUN; only send when explicitly enabled with multi-gating (`--confirm --limit=1 --to <email>` + `RUN_TEST_MICROSOFT_GRAPH_EMAIL_SEND=true` + `ALLOW_TEST_MICROSOFT_GRAPH_EMAIL_SEND_SCRIPT=true`); enforce hard cap `1`; and fail closed via `process.exitCode=1`. Regression: `tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts`.
- `506. SCRIPT-090` (P1): Birthday calendar sync diagnostic (`scripts/testing/test-birthday-calendar-sync.ts`) previously attempted Google Calendar writes by default. Fix: make strictly read-only (blocks `--confirm`), skip `syncBirthdayCalendarEvent`, and fail closed via `process.exitCode=1`. Regression: `tests/scripts/testCalendarSyncScriptsReadOnly.test.ts`.
- `505. SCRIPT-089` (P1): Additional OJ project verification/list/debug scripts under `scripts/oj-projects/` were tightened to be strictly read-only diagnostics: block `--confirm`, use `createAdminClient` and `assertScriptQuerySucceeded` for fail-closed DB/RPC handling, and exit non-zero when verification mismatches are detected (vs printing and exiting 0). Regression: extended `tests/scripts/testOjProjectsScriptsSafety.test.ts` to cover the read-only scripts (no mutations, correct admin client/query assertions, and no `process.exit`).
- `504. SCRIPT-088` (P1): Hiring CV cleanup script (`scripts/hiring/cleanup-stuck-cvs.ts`) previously risked unsafe production mutations (no dry-run default, no explicit caps, and weak failure handling). Fix: default to dry-run; require explicit multi-gating (`--confirm` + `RUN_CLEANUP_STUCK_CVS_MUTATION=true` + `ALLOW_CLEANUP_STUCK_CVS_MUTATION_SCRIPT=true`) plus an explicit `--limit` (hard cap `500`) before any updates; enforce strict row-effect checks; and fail closed via `process.exitCode=1`. Regression: `tests/scripts/testHiringCleanupStuckCvsSafety.test.ts`.
- `503. SCRIPT-087` (P0): Multiple testing scripts under `scripts/testing/` were unsafe for incident diagnostics: some could mutate DB/external state and several used fail-open `process.exit(0)` / log-and-continue patterns that can mask failures. Fix: make the diagnostic scripts strictly read-only (block `--confirm`) and fail closed; and gate PayPal order creation behind explicit multi-gating (`--confirm` + `RUN_TEST_PAYPAL_CREDENTIALS_ORDER_CREATE=true` + `ALLOW_TEST_PAYPAL_CREDENTIALS_ORDER_CREATE_SCRIPT=true`) plus `--limit=1`, with `--live` required for `PAYPAL_ENVIRONMENT=live`. Regression: `tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts`.
- `502. SCRIPT-086` (P0): OJ project maintenance scripts under `scripts/oj-projects/` previously performed high-risk production mutations (create projects, move entries, update rates/hours) without safe defaults, explicit caps, or strict per-step row-effect checks. Fix: default to dry-run; require explicit multi-gating (`--confirm` + script-specific `RUN_*` + `ALLOW_*`) plus explicit `--limit` (hard cap `500`) before any inserts/updates; add strict row-effect assertions so partial failures cannot exit successfully; and make `verify-closing-logic.ts` strictly read-only (blocks `--confirm`). Regression: `tests/scripts/testOjProjectsScriptsSafety.test.ts`.
- `501. SCRIPT-085` (P1): Menu seed scripts under `scripts/menu/` previously performed ungated `upsert/insert` operations by default, with no dry-run preview or explicit caps, creating production mutation risk during maintenance. Fix: default all seed scripts to DRY RUN; require explicit multi-gating (`--confirm` + script-specific `RUN_*` + `ALLOW_*`) plus explicit `--limit` with hard caps (ingredient seeds hard cap `10`, dish seed hard cap `500`) before any writes; add preflight planned-count vs limit checks; and fail closed via `process.exitCode=1`. Regression: `tests/scripts/testMenuSeedScriptsSafety.test.ts`.
- `484. SCRIPT-114` (P1): Messaging diagnostic scripts `scripts/database/check-messages-permissions.ts` and `scripts/database/check-messages.ts` previously used a Node shebang and a broken `__dirname`-relative `.env.local` path, and they failed open by logging Supabase errors and returning while still exiting `0` (false-green incident diagnostics). Fix: rewrite both as runnable `tsx` scripts (shebang), use `createAdminClient`, block `--confirm` (read-only), remove `process.exit(...)` usage in favor of fail-closed `process.exitCode=1`, and treat missing expected messages permissions as a script failure. Regression: extended `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` to cover both scripts.
- `485. SCRIPT-118` (P1): Hardened additional legacy `scripts/database` diagnostic scripts (`scripts/database/check-production-templates.ts`, `scripts/database/check-customer-labels.ts`, `scripts/database/check-event-categories.ts`, `scripts/database/check-event-categories-data.ts`, `scripts/database/check-invalid-phone-numbers.ts`) to be safe for incident diagnostics: they previously used ad-hoc Supabase clients (`createClient` + service-role key), loaded `.env.local` via brittle `__dirname` paths, and used `.catch(console.error)` / log-and-return patterns that could exit `0` after query/RPC failures. Fix: standardize them as runnable `tsx` scripts (shebang), load `.env.local` from `process.cwd()`, use `createAdminClient`, block `--confirm` (strict read-only), route query/RPC failures through `assertScriptQuerySucceeded`/`markFailure`, remove all `process.exit(...)` usage, and fail closed via `process.exitCode=1`. Regression: extended `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` to cover all scripts above (enforces read-only + fail-closed guarantees).
- `486. SCRIPT-119` (P1): Bank-details diagnostic script (`scripts/database/check-invalid-bank-details.ts`) previously loaded `.env.local` via a brittle `__dirname` path, used an ad-hoc Supabase client (`createClient` + service-role key), and failed open by logging Supabase errors and returning while still exiting `0`. Fix: rewrite as a runnable `tsx` script (shebang), load `.env.local` from `process.cwd()`, use `createAdminClient`, block `--confirm` (strict read-only), and fail closed via `process.exitCode=1` on any query failure (and when invalid bank details are detected). Regression: extended `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` to cover this script.
- `487. SCRIPT-122` (P1): Webhook log diagnostic scripts (`scripts/database/check-webhook-logs-new.ts`, `scripts/database/check-webhook-logs.ts`) previously failed open by ignoring Supabase query errors (or catching and logging without setting a non-zero exit code), producing false-green incident diagnostics in Twilio/SMS-adjacent investigations. Fix: standardize both as runnable `tsx` scripts using `createAdminClient`, load `.env.local` from `process.cwd()`, block `--confirm` (strict read-only), route query failures through `assertScriptQuerySucceeded`/`markFailure`, and fail closed via `process.exitCode=1` (no `process.exit`). Regression: extended `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` to cover both scripts.
- `488. SCRIPT-123` (P1): SMS tools diagnostics (`scripts/sms-tools/check-all-jobs.ts`, `scripts/sms-tools/check-reminder-issues.ts`) previously had no `tsx` shebang and failed open by ignoring Supabase query errors, producing false-green incident diagnostics around stuck jobs/reminder re-sends. Fix: rewrite both as runnable `tsx` scripts using `createAdminClient`, load `.env.local` from `process.cwd()`, block `--confirm` (strict read-only), add bounded sampling (`--limit` with a hard cap) to avoid unbounded reads/output, and fail closed via `process.exitCode=1` on any query failure (and when issue conditions are detected). Regression: extended `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` to cover both scripts.
- `489. SCRIPT-124` (P1): SMS diagnostics scripts (`scripts/database/check-sms-status.ts`, `scripts/database/check-sms-templates.ts`) previously had hard-coded production defaults (booking reference), selected `*` across sensitive tables, and failed open by ignoring Supabase query errors (logging and returning while still exiting `0`). Fix: rewrite both as runnable `tsx` scripts using `createAdminClient`, load `.env.local` from `process.cwd()`, require explicit `--booking-ref` (no baked-in production references), bound outputs (`--limit` hard cap + masked phones, optional `--show-body`), block `--confirm` (strict read-only), and fail closed via `process.exitCode=1` on any query failure (and missing expected templates/jobs). Regression: extended `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` to cover both scripts.
- `483. SCRIPT-113` (P0): `scripts/cleanup/delete-test-customers.ts` previously called a Next.js server action (`deleteTestCustomers` from `@/app/actions/customers`) from a script context, with no dry-run default, no multi-gating, and no explicit caps, making destructive customer deletes too easy to run. Fix: deprecate the wrapper by delegating to a hardened direct script (`scripts/cleanup/delete-test-customers-direct.ts`) that defaults to DRY RUN; mutations require explicit multi-gating (`--confirm` + `RUN_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION=true` + `ALLOW_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION=true`) plus an explicit `--limit` (hard cap `50`); and it fails closed via `process.exitCode=1`. Also added shared limit parsing + hard-cap assertions in `src/lib/delete-test-customers-direct-safety.ts`. Regression: added `tests/lib/deleteTestCustomersDirectSafety.test.ts` and extended `tests/scripts/testScriptMutationGating.test.ts` (enforces wrapper delegation and mutation gating + caps).
- `482. SCRIPT-112` (P1): Multiple `scripts/database` diagnostic scripts previously failed open by swallowing Supabase query/RPC errors and still forcing success termination (`process.exit(0)` / `.then(() => process.exit(0))`), and some imported Next.js server Supabase clients (runtime-broken/unsafe in scripts). Fix: rewrite the affected scripts (`check-tables`, `check-failed-jobs`, `check-invoice-system`, `check-job-tables`, `check-jobs`, `check-user-permissions`, `check-customer-preferences`, `check-customer-suggestions`, `check-events-with-categories`, `check-customers-table`, `check-events-table`) to be runnable `tsx` scripts (shebang), avoid `process.exit(...)`, use `createAdminClient`, and fail closed via `process.exitCode=1` when any env/query/RPC checks fail (including explicit targeting for `check-user-permissions` via `--user-id` or `--email`). Regression: extended `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` and `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` (also asserts scripts do not call `process.exit`).
- `481. SCRIPT-108` (P0): `scripts/cleanup/delete-test-bookings.ts` previously required only env gates (no `--confirm`) and would hard-fail (exit `1`) when run without mutation env enabled, making it harder to safely preview destructive deletes and increasing risk when env vars are already set in a shell. Fix: default to DRY RUN for the `delete` command (prints an explicit delete plan for payments/items/jobs/booking without mutating); mutations now require explicit multi-gating (`--confirm` + `RUN_DELETE_TEST_BOOKINGS_MUTATION=true` + `ALLOW_DELETE_TEST_BOOKINGS_MUTATION=true`); `--confirm` without the RUN env gate fails closed; and mutation deletes are blocked without `--force` when the booking does not look like a test booking. Regression: extended `tests/scripts/testScriptMutationGating.test.ts`.
- `480. SCRIPT-107` (P0): `scripts/cleanup/delete-specific-customers.ts` previously performed destructive customer deletes behind only env gating (no `--confirm`) and had no explicit caps. Fix: default to DRY RUN; mutations now require explicit multi-gating (`--confirm` + `RUN_DELETE_SPECIFIC_CUSTOMERS_MUTATION=true` + `ALLOW_DELETE_SPECIFIC_CUSTOMERS_MUTATION=true`) plus an explicit `--limit` that must equal the number of targeted customers (hard cap `50`); `--confirm` without the RUN env gate fails closed. Regression: extended `tests/scripts/testScriptMutationGating.test.ts`.
- `479. SCRIPT-101` (P1): `scripts/database/check-processed-sms.ts` previously hardcoded booking references, ignored Supabase query errors, and swallowed failures (try/catch log-only) so it could exit `0` after an incomplete/failed diagnostic run. Fix: require explicit booking reference args (no hardcoded production refs), block `--confirm` (read-only), use `createAdminClient`, and fail closed via `process.exitCode=1` on any query failure. Regression: `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts`.
- `478. SCRIPT-100` (P1): `scripts/database/check-enrollment-sms.ts` previously failed open by logging Supabase errors and returning early while still exiting `0` (`process.exit(0)`), producing false-green incident diagnostics. Fix: rewrite as a strictly read-only diagnostic (blocks `--confirm`) using `createAdminClient`; add consistent fail-closed error handling (sets `process.exitCode=1` on any query error); and allow a bounded window via `--hours` (default `24`). Regression: `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts`.
- `477. SCRIPT-099` (P0): `scripts/fixes/fix-duplicate-loyalty-program.ts` previously ran production mutations behind a single env gate (no `--confirm`) and could update/delete an unbounded number of rows (migrating all `loyalty_members` in one pass). Fix: default to dry-run; require explicit multi-gating (`--confirm` + `RUN_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION=true` + `ALLOW_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION=true`); require an explicit `--limit` (hard cap `500`) before any member migration; migrate in batches and only delete the duplicate program once it has no remaining members; and fail closed via `process.exitCode=1`. Regression: `tests/lib/duplicateLoyaltyProgramFixSafety.test.ts`, `tests/scripts/testScriptMutationGating.test.ts`.
- `476. SCRIPT-098` (P1): `scripts/fixes/fix-pending-payment.ts` previously allowed production mutations behind only env vars (no `--confirm`). Fix: default to dry-run; require explicit multi-gating (`--confirm` + `RUN_FIX_PENDING_PAYMENT_MUTATION=true` + `ALLOW_FIX_PENDING_PAYMENT_MUTATION=true`); accept booking references via `--booking-ref` or positional arg; and fail closed via `process.exitCode=1`. Regression: `tests/lib/pendingPaymentFixSafety.test.ts`, `tests/scripts/testScriptMutationGating.test.ts`.
- `475. SCRIPT-097` (P0): `scripts/fixes/fix-table-booking-sms.ts` included a gated write probe that inserted a `send_sms` job behind only env-var gating (no `--confirm`) and created a short window for accidental queue mutations. Fix: require explicit multi-gating (`--confirm` + `--write-probe` + `RUN_FIX_TABLE_BOOKING_SMS_WRITE_PROBE=true` + `ALLOW_FIX_TABLE_BOOKING_SMS_PROBE_MUTATION=true`); make the probe insert a `cancelled` job (never pending) scheduled far in the future; and fail closed via `process.exitCode=1`. Regression: `tests/lib/tableBookingSmsFixSafety.test.ts`, `tests/scripts/testScriptMutationGating.test.ts`.
- `474. SCRIPT-096` (P0): `scripts/fixes/fix-table-booking-api-permissions.ts` previously embedded a real API key and performed ungated permission updates by default (including a commented "grant all permissions" path), creating both secret leakage and privilege escalation risk. Fix: remove the hardcoded key entirely; delete the standalone variant; default to dry-run; require explicit multi-gating (`--confirm` + `RUN_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION=true` + `ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION_SCRIPT=true`); require `--key-hash` (sha256) instead of a raw key; enforce strict single-row update assertions; and fail closed via `process.exitCode=1`. Regression: `tests/lib/fixTableBookingApiPermissionsScriptSafety.test.ts`, `tests/scripts/testScriptMutationGating.test.ts`.
- `473. SCRIPT-095` (P0): `scripts/fixes/fix-superadmin-permissions.ts` previously performed role/permission mutations by default (including broad grant paths) with no dry-run default, no explicit caps for bulk grants, and weak error handling. Fix: default to dry-run; require explicit multi-gating (`--confirm` + `RUN_FIX_SUPERADMIN_PERMISSIONS_MUTATION=true` + `ALLOW_FIX_SUPERADMIN_PERMISSIONS_MUTATION_SCRIPT=true`); require explicit operation flags; enforce hard caps on any bulk-grant path; and fail closed via `process.exitCode=1`. Regression: `tests/lib/fixSuperadminPermissionsScriptSafety.test.ts`, `tests/scripts/testScriptMutationGating.test.ts`.
- `472. SCRIPT-094` (P0): `scripts/cleanup/delete-approved-duplicates.ts` previously performed destructive deletes without dry-run defaults, multi-gating, or explicit caps and could write invalid audit logs (schema mismatch). Fix: default to dry-run; require explicit multi-gating (`--confirm` + `RUN_DELETE_APPROVED_DUPLICATES_MUTATION=true` + `ALLOW_DELETE_APPROVED_DUPLICATES_MUTATION_SCRIPT=true`); require an explicit `--limit` (hard cap `50`) and optional `--offset`; enforce strict row-effect assertions for deletes + audit writes; and fail closed via `process.exitCode=1`. Regression: `tests/lib/deleteApprovedDuplicatesScriptSafety.test.ts`, `tests/scripts/testScriptMutationGating.test.ts`.
- `471. SCRIPT-093` (P0): `scripts/cleanup/remove-historic-import-notes.ts` previously performed unbounded production updates by default (service-role) with no dry-run, gating, or caps. Fix: default to dry-run; require explicit multi-gating (`--confirm` + `RUN_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION=true` + `ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION_SCRIPT=true`); require an explicit `--limit` (hard cap `500`) and optional `--offset`; enforce strict row-effect assertions; and fail closed via `process.exitCode=1`. Regression: `tests/lib/removeHistoricImportNotesScriptSafety.test.ts`, `tests/scripts/testScriptMutationGating.test.ts`.
- `470. SCRIPT-084` (P0): `scripts/fixes/fix-sms-template-keys.ts` previously performed unbounded DB updates by default (only a single `ALLOW_*` env gate; no dry-run; no `--confirm`; no explicit caps), risking broad mutation of pending `send_sms` jobs. Fix: default to dry-run; require explicit multi-gating (`--confirm` + `RUN_FIX_SMS_TEMPLATE_KEYS_MUTATION=true` + `ALLOW_FIX_SMS_TEMPLATE_KEYS_SCRIPT=true`) plus an explicit `--limit` (hard cap `500`) and optional `--offset`; filter directly in SQL (`payload->>template`) to avoid scanning all pending jobs; and fail closed via `process.exitCode=1` on any error. Regression: `tests/lib/smsTemplateKeyFixSafety.test.ts`, `tests/scripts/testScriptMutationGating.test.ts`.
- `469. SCRIPT-083` (P0): `scripts/database/complete-past-event-checklists.ts` previously upserted checklist rows by default with no dry-run or gating, no explicit caps, and a broken Supabase admin import (`supabase-singleton`). Fix: default to dry-run; require explicit multi-gating (`--confirm` + `RUN_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION=true` + `ALLOW_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION_SCRIPT=true`) plus an explicit `--event-limit` (hard cap `200`) and optional `--offset`; add a hard cap on total upsert rows (`5000`) to prevent unbounded fanout; switch to `createAdminClient`; and fail closed via `process.exitCode=1`. Regression: `tests/lib/completePastEventChecklistsScriptSafety.test.ts`, `tests/scripts/testScriptMutationGating.test.ts`.
- `468. SCRIPT-082` (P0): `scripts/database/check-migration-table-structure.ts` previously attempted DB inserts into migration tables and contained silent catch blocks, making it unsafe and prone to false-green output. Fix: remove all mutation paths; keep the script strictly read-only; block `--confirm`; use `createAdminClient`; and fail closed on unexpected query errors. Regression: `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts`.
- `467. SCRIPT-081` (P0): `scripts/database/check-loyalty-program.ts` previously created a default loyalty program automatically (service-role mutation) and failed open on query errors. Fix: remove all DB mutations (strictly read-only); block `--confirm`; fail closed on query errors or missing expected program rows; and use `createAdminClient`. Regression: `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts`.
- `466. SCRIPT-080` (P0): `scripts/database/check-click-tracking.ts` previously inserted test click rows and updated click counts (production mutation risk) and relied on brittle schema inference. Fix: remove all mutation paths (strictly read-only); block `--confirm`; use `createAdminClient`; use safe count queries; and fail closed on query errors. Regression: `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts`.
- `465. SCRIPT-079` (P0): `scripts/database/check-private-bookings-schema.ts` previously attempted DB inserts to “discover” schema and used a Next.js server Supabase client (runtime-broken in scripts) while failing open on errors (exit `0`). Fix: remove all mutation paths; keep the script strictly read-only; use `createAdminClient`; fall back to column probes when RPC/sample inference is unavailable; and fail closed via `process.exitCode=1`. Regression: `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts`.
- `464. SCRIPT-078` (P1): `fix-rpc-functions` scripts previously contained unsafe/broken behavior: the main script attempted to execute DDL via `rpc('query')` without any gating and could exit `0` after logging errors, while `fix-rpc-functions-direct.ts` contained a dormant REST `rpc/query` SQL executor helper and forced `process.exit(0)`. Fix: rewrite both scripts as strictly read-only diagnostics; remove arbitrary SQL execution paths; print the SQL patch for manual application on failure; and fail closed via `process.exitCode=1`. Regression: `tests/scripts/testFixRpcFunctionsScriptsReadOnly.test.ts`.
- `463. SCRIPT-077` (P1): Parking SMS backfill script (`scripts/backfill/parking-sms.ts`) previously ran in mutation mode (recording outbound messages + updating notification payloads) behind a single env-var gate and had no explicit caps/limits or dry-run preview, and it used `process.exit(1)` plus an incorrect server-Supabase import. Fix: default to dry-run; require explicit multi-gating (`--confirm` + `RUN_PARKING_SMS_BACKFILL_MUTATION=true` + `ALLOW_PARKING_SMS_BACKFILL_MUTATION=true`, with legacy allow env supported) plus an explicit capped `--limit` (hard cap `1000`) before any writes; optional `--offset`; switch to `createAdminClient`; and fail closed via `process.exitCode=1`. Regression: `tests/lib/parkingSmsBackfillScriptSafety.test.ts`, `tests/lib/parkingSmsBackfillSafety.test.ts`.
- `462. SCRIPT-076` (P0): `scripts/database/check-migration-simple.ts` previously performed ungated inserts/deletes to "test" constraints (production DB mutation risk) and failed open by returning early on DB errors (exiting `0`). Fix: remove all insert/delete constraint probes; keep the script strictly read-only; and fail closed by throwing on query errors so the script exits non-zero. Regression: `tests/scripts/testDatabaseEventCategoriesMigrationScriptsReadOnly.test.ts`.
- `461. SCRIPT-075` (P0): `scripts/database/check-event-categories-migration.ts` previously created SECURITY DEFINER helper functions (including an `exec_sql` DDL executor) via `supabase.rpc('exec_sql', ...)` with no gating, mutating production DB as part of a "check" script. Fix: remove helper-function creation entirely (strictly read-only); fall back to `select('*')` column inference when helper RPCs are unavailable; and fail closed (non-zero exit) when expected helper checks error or are missing, to avoid false-green diagnostics. Regression: `tests/scripts/testDatabaseEventCategoriesMigrationScriptsReadOnly.test.ts`.
- `435. WAITLIST-005` (P0): Waitlist offer SMS dispatch (`sendWaitlistOfferSms` in `src/lib/events/waitlist-offers.ts`) previously returned `success: false` when post-send persistence (offer/hold/token timestamp updates) failed after a successful transport send, misclassifying a sent/scheduled SMS as unsent and allowing cron-level cleanup/retry logic to run. Fix: treat post-send persistence failures as fatal `logging_failed` while returning `{ success: true, code: 'logging_failed', logFailure: true }` so batch callers abort without retrying/continuing fanout. Regression: `tests/lib/waitlistOffersSmsPersistence.test.ts`.
- `440. GUEST-003` (P1): Guest token throttle (`src/lib/guest/token-throttle.ts`) previously swallowed all `rate_limits` DB errors and always fell back to in-memory throttling, which can fail open in multi-instance production deployments and weaken brute-force protection on guest-token endpoints that gate SMS-triggering flows. Fix: fail closed in production on throttle DB errors (`allowed: false`, `remaining: 0`) while preserving local fallback for non-production environments. Regression: extended `tests/lib/guestTokenThrottle.test.ts`.
- `441. SMS-067` (P1): Bulk SMS send fanout (`sendBulkSms` in `src/lib/sms/bulk.ts`) previously launched each concurrency window with `Promise.all`, so a fatal safety signal (`logging_failed`, `safety_unavailable`, `idempotency_conflict`) could still permit additional in-flight sends in the same window before the abort guard was observed. Fix: harden dispatch to single-flight processing by capping effective concurrency to `1`, so fatal safety signals stop fanout before additional sends are started. Regression: extended `tests/lib/smsBulkLoopGuards.test.ts` with a high-requested-concurrency fatal-signal case that asserts only one send executes.
- `439. QUEUE-026` (P1): Private booking queue auto-send helper (`SmsQueueService.sendPrivateBookingSms` in `src/services/sms-queue.ts`) previously returned `code: 'logging_failed'` without guaranteeing `logFailure: true`, so callers that only abort on the boolean could miss the fatal safety signal if the transport meta omitted it. Fix: normalize `logFailure` to `true` whenever `code === 'logging_failed'`. Regression: extended `tests/services/smsQueue.service.test.ts`.
- `438. WAITLIST-006` (P1): Waitlist offer SMS helper (`sendWaitlistOfferSms` in `src/lib/events/waitlist-offers.ts`) previously returned `code: 'logging_failed'` without normalizing the corresponding `logFailure` flag, so callers could miss the fatal safety signal if the transport result omitted the boolean. Fix: treat `code: 'logging_failed'` as `logFailure: true` for consistent abort semantics in batch/cron callers. Regression: extended `tests/lib/waitlistOffersSmsPersistence.test.ts`.
- `437. EVENT-015` (P1): Event booking seat-update SMS helper (`sendEventBookingSeatUpdateSms` in `src/lib/events/event-payments.ts`) previously computed `smsLogFailure` (treating `code: 'logging_failed'` as fatal) but returned `logFailure: smsResult.logFailure`, which could drop the fatal safety signal if the transport result omitted the boolean. Fix: return `code`/`logFailure` using the computed normalization so callers reliably receive `{ code: 'logging_failed', logFailure: true }`. Regression: extended `tests/lib/eventBookingSeatUpdateSmsSafety.test.ts`.
- `436. PB-017` (P1): Private booking SMS side-effect dispatch (`PrivateBookingService.updateBooking` in `src/services/private-bookings.ts`) previously continued enqueuing additional SMS side effects after an earlier side effect returned a fatal safety signal (`logging_failed`, `safety_unavailable`, `idempotency_conflict`), increasing fanout risk while outbound message persistence/safety is degraded. Fix: normalize `code`/`logFailure` consistently (treat `code: 'logging_failed'` as `logFailure: true`) and abort further SMS side-effect dispatch within the same mutation after a fatal signal, while still returning the updated booking and `smsSideEffects` (no retry-driving throw). Regression: extended `tests/services/privateBookingsSmsSideEffects.test.ts`.
- `434. PARK-008` (P0): Parking payment request SMS dispatch (`sendParkingPaymentRequest` in `src/lib/parking/payments.ts`) previously threw when post-send persistence failed (parking notification log insert or booking reminder-flag update error/0-row) after a successful transport send, which could drive retry/reclaim behavior and/or allow later reminder logic to fan out additional SMS due to missing flags. Fix: return `{ sent, skipped, code, logFailure }` and treat post-send persistence failures as fatal `logging_failed` while keeping `sent: true` (no throw), matching the system-wide "sent but cannot persist => logging_failed" semantics. Also persist stable `template_key` + `stage` metadata in `parking_booking_notifications.payload` so dedupe/backfill logic can reason about sends even when booking flags are degraded. Regression: `tests/lib/parkingPaymentsPersistence.test.ts`.
- `433. QUEUE-025` (P0): Approved private booking SMS dispatch (`SmsQueueService.sendApprovedSms`) previously reclaimed stale `dispatching:` claims and re-sent, and it threw when the transport send succeeded but the queue row could not be persisted as `status='sent'`. This created a resend vector: a successful send followed by a queue persistence failure could leave the row `approved + dispatching:*`, and later stale-claim reclaim would re-send. Fix: stale `dispatching:` claims now fail closed and attempt a safe reconciliation by checking the central outbound `messages` log for evidence (prefer `metadata.queue_job_id`, fall back to booking/to/template filters). If evidence exists, reconcile the queue row to `sent` without re-sending; if verification fails, refuse to re-send automatically. Post-send queue persistence failures now return `{ success: true, code: 'logging_failed', logFailure: true }` (no throw) to avoid retry-driven duplicates and propagate fatal safety meta. Regression: `tests/services/smsQueue.service.test.ts`.
- `432. QUEUE-024` (P0): `SmsQueueService.queueAndSend` previously returned an error without `code`/`logFailure` when the transport send succeeded but the queue row could not be updated to `status='sent'` (DB error/no-row), allowing batch callers to continue sending/retrying without a fatal safety signal. Fix: treat this post-send queue persistence failure as fatal `logging_failed` (`logFailure: true`) while returning `success: true` to prevent retry-driven duplicates and to allow callers to abort downstream fanout. Regression: `tests/services/smsQueue.service.test.ts`.
- `431. QUEUE-023` (P0): Unified job queue SMS execution (`UnifiedJobQueue.processJob` in `src/lib/unified-job-queue.ts`) previously logged job-state persistence failures in its catch handler and continued processing additional SMS jobs. Fix: treat SMS completion-state persistence failures as fatal (`logging_failed`) to disable retries after side effects run, and treat failure-state persistence errors/zero-row updates as fatal (`safety_unavailable`) so claimed SMS batches abort when the system cannot safely persist job state. Regression: `tests/lib/unifiedJobQueue.test.ts`.
- `430. MSG-005` (P1): Message-thread reply sending (`MessageService.sendReply`) now normalizes fatal SMS safety meta by treating `code: 'logging_failed'` as `logFailure: true` even if the transport result omits the boolean, and regression coverage ensures dedupe suppression (`suppressed_duplicate`) returns success with a null SID (no retry-driven resend loops). Regression: `tests/services/messages.service.test.ts`.
- `429. QUEUE-022` (P1): Legacy background job queue `processSendSms` previously threw when `sendSMS` returned `success: true` but no `sid` (e.g. `suppressed_duplicate` or quiet-hours `deferred` sends), causing unnecessary retries and duplicate deferrals. Fix: treat suppressed/deferred success results as successful execution and return a null SID without retrying. Regression: `tests/lib/backgroundJobsQueue.test.ts`.
- `428. SMS-062` (P0): `sendSMS` previously returned transport success even when outbound `messages` persistence was skipped due to missing customer context (`createCustomerIfMissing=false` with no `customerId`), hiding `logging_failed` fatal safety signals and allowing loop/batch callers to continue sending while safety counters could not be updated. Fix: treat missing customer context for logging as `logging_failed` (return `{ success: true, code: 'logging_failed', logFailure: true }`) so callers can abort further sends when persistence is impossible. Regression: `tests/lib/twilioSendLoggingFailClosed.test.ts`.
- `427. QUEUE-021` (P0): Private booking SMS queue recipient resolution previously logged-and-continued on booking/customer lookup errors, allowing queue/send to proceed with unverifiable recipient context. Fix: `resolvePrivateBookingRecipientPhone` now fails closed on booking lookup errors/missing rows and customer lookup errors; `queueAndSend` aborts immediately when recipient resolution returns an error. Regression: `tests/services/smsQueue.service.test.ts`.
- `426. INV-010` (P1): Invoice reminder dedupe helper `hasSentInvoiceEmailLog` previously returned `{ exists: false, error }` on DB errors, so any caller that ignored the `error` field could treat the reminder as unsent and retry, risking duplicate reminder emails during DB degradation. Fix: fail closed by returning `{ exists: true, error }` on lookup errors so callers default to skipping sends when dedupe state is unknown. Regression: `tests/lib/invoiceReminderSafety.test.ts`.
- `425. SMS-060` (P0): SMS safety guards previously allowed `SMS_SAFETY_ALLOW_MISSING_TABLES=true` to bypass safety limits + distributed SMS idempotency in production, risking uncontrolled outbound sends if `messages`/`idempotency_keys` tables are unavailable. Fix: force `allowMissingTables=false` when `NODE_ENV=production`, ignoring env overrides, so missing safety tables always block sending (e.g., `safety_unavailable`, `idempotency_conflict`). Regression: `tests/lib/sms/safety.test.ts`.
- `424. QUEUE-020` (P1): `SmsQueueService.sendApprovedSms` previously returned `{ success: true }` even when the underlying `sendSms` action surfaced fatal SMS safety meta (`code`/`logFailure`, e.g. `logging_failed`), preventing batch/loop callers from detecting abort-worthy safety conditions. Fix: return `{ success: true, code, logFailure }` on success so callers can reliably abort downstream fanout without retrying the transport send. Regression: `tests/services/smsQueue.service.test.ts`.
- `423. QUEUE-019` (P0): Private booking SMS queue auto-send (`SmsQueueService.queueAndSend`) could race with staff approval while the auto-send was in flight, risking duplicate sends (auto-send + manual send). Fix: auto-send queue rows are inserted with a `dispatching:` marker in `error_message` (cleared on success), and approve/reject now fail closed when a dispatch marker is present (requires `error_message IS NULL` and surfaces an explicit "dispatch in progress" error). Regression: `tests/services/smsQueue.service.test.ts`.
- `422. EVENT-012` (P1): Staff seat-update helper `updateTableBookingPartySizeWithLinkedEventSeats` previously collapsed `sendEventBookingSeatUpdateSms` results to a boolean `sms_sent`, dropping `code`/`logFailure` safety signals (including `logging_failed`) from FOH/BOH party-size update flows. Fix: propagate seat-update SMS safety meta via a new `sms: { success, code, logFailure } | null` field on the return payload. Regression: `tests/lib/staffSeatUpdatesMutationGuards.test.ts`.
- `421. SMS-057` (P1): Private booking deposit/final-payment/cancellation flows previously called `SmsQueueService.queueAndSend` but ignored returned `{ error, code, logFailure }`, swallowing queue/send failures and `logging_failed` safety signals. Fix: capture and return `smsSideEffects` summaries and emit structured error logs on queue/send failure or outbound-message logging failure. Regression: `tests/services/privateBookingsSmsSideEffects.test.ts`.
- `382. IDEMP-005` (P0): Public booking endpoints (`/api/event-bookings`, `/api/event-waitlist`, `/api/table-bookings`) previously released idempotency claims when `persistIdempotencyResponse` failed after successful booking/waitlist mutations and outbound SMS/email side effects, deleting `idempotency_keys` rows and allowing client retries to re-trigger the same mutation and re-send notifications during DB/idempotency-write outages. Fix: treat idempotency-response persistence failures as non-fatal for the HTTP response, log structured errors, and intentionally keep the idempotency claim (skip `releaseIdempotencyClaim`) once a booking/waitlist entry is created so retries cannot fan out duplicates. Regression: `tests/api/eventBookingsRouteSmsMeta.test.ts`, `tests/api/eventWaitlistRouteSmsMeta.test.ts`, `tests/api/tableBookingsRouteSmsMeta.test.ts`.
- `383. SMS-058` (P1): SMS server actions (`src/app/actions/sms.ts`) previously used `console.error` in OTP/manual-send catch blocks, bypassing structured logging and increasing the chance of silent/fail-open diagnostics near send paths. Fix: replace with structured `logger.error` (without leaking message bodies) and add a regression guard preventing direct `console.*` logging in SMS actions. Regression: `tests/actions/smsActionsConsoleGuards.test.ts`.
- `384. IDEMP-006` (P0): Stripe webhook handler (`/api/stripe/webhook`) previously released idempotency claims when `persistIdempotencyResponse` failed after successful event processing, allowing Stripe retries to replay mutations and re-send notifications during DB/idempotency-write degradation. Fix: treat idempotency-response persistence failures as non-fatal (return HTTP 200), log structured errors, and intentionally keep the idempotency claim (skip `releaseIdempotencyClaim`) once processing completes. Regression: `tests/api/stripeWebhookMutationGuards.test.ts`.
- `385. WEBHOOK-018` (P1): Stripe webhook handler (`/api/stripe/webhook`) previously allowed `sendEventPaymentRetrySms` exceptions to bubble in the blocked checkout-session flow, returning HTTP 500 and triggering Stripe retries that can amplify duplicate notifications. Fix: catch and log retry-SMS errors and continue to persist the webhook idempotency response. Regression: `tests/api/stripeWebhookMutationGuards.test.ts`.
- `386. IDEMP-007` (P0): PayPal parking webhook handler (`/api/webhooks/paypal/parking`) previously released idempotency claims when `persistIdempotencyResponse` failed after successful processing, enabling retry-driven replay of non-transactional side effects (webhook logs/audit logs) and weakening replay safety during DB/idempotency-write degradation. Fix: treat idempotency-response persistence failures as non-fatal (return HTTP 200), log structured errors, and intentionally keep the idempotency claim once processing completes; also replace `console.*` logging with structured `logger`. Regression: `tests/api/paypalParkingWebhookFailClosed.test.ts`.
- `387. SMS-059` (P1): Private booking server actions (`recordDepositPayment`, `recordFinalPayment`, `cancelPrivateBooking`, and `sendApprovedSms`) previously returned success without surfacing SMS side-effect safety meta (`smsSideEffects`, and `code`/`logFailure` for approved-queue sends), hiding `logging_failed` signals from the UI and increasing retry-driven duplicate-send risk during degraded outbound-message logging. Fix: propagate SMS side-effect summaries and approved-send `code`/`logFailure` to callers, log explicitly when outbound message logging fails, and standardize action returns to include `success: boolean` so callers can safely branch without relying on missing properties. Regression: `tests/actions/privateBookingActionsSmsMeta.test.ts`.
- `388. IDEMP-008` (P0): Additional non-cron mutation routes (`/api/private-booking-enquiry`, `/api/parking/bookings`, and `/api/external/performer-interest`) previously released idempotency claims when `persistIdempotencyResponse` failed after a successful mutation, allowing client retries to replay inserts/creates and re-send downstream notifications during DB/idempotency-write degradation. Fix: treat idempotency-response persistence failures as non-fatal (return HTTP 201/200), log structured errors, and intentionally keep the idempotency claim once the mutation is committed; replace remaining `console.*` logging near these write paths with structured `logger`. Regression: `tests/api/idempotencyPersistFailClosedAdditionalRoutes.test.ts`.
- `389. SMS-061` (P1): Messaging send/queue server actions previously used `console.error` catch logging (`sendSmsReply` in `src/app/actions/messageActions.ts` and `enqueueBulkSMSJob` in `src/app/actions/job-queue.ts`), bypassing structured logging on SMS send/enqueue paths and reducing incident diagnosability. Fix: replace with structured `logger.error` (avoid logging message bodies) and add a regression guard preventing direct `console.*` logging in these actions. Regression: `tests/actions/messagesAndQueueConsoleGuards.test.ts`.
- `390. EVENT-013` (P1): Event server actions (`src/app/actions/events.ts`) previously used `console.error` in multiple error paths (including event CRUD, manual booking create/cancel, and SMS exception handling), bypassing structured logging and reducing incident diagnosability. Fix: replace with structured `logger` calls (avoid logging message bodies) and add a regression guard preventing direct `console.*` logging in event actions. Regression: `tests/actions/eventsActionsConsoleGuards.test.ts`.
- `391. FOH-012` (P1): FOH/BOH table-booking party-size update routes (`src/app/api/foh/bookings/[id]/party-size` and `src/app/api/boh/table-bookings/[id]/party-size`) previously used `console.error` on write-path error handling, bypassing structured logging and reducing incident diagnosability. Fix: replace with structured `logger.error` and add a regression guard preventing direct `console.*` logging in these route handlers. Regression: `tests/api/partySizeSeatUpdateRoutesConsoleGuards.test.ts`.
- `392. EVENT-014` (P1): Admin event booking seat-update action (`updateEventManualBookingSeats` in `src/app/actions/events.ts`) previously used `Promise.allSettled` to run linked table-booking sync + analytics but ignored the results, swallowing Supabase errors on the table sync update and hiding partial-failure state after the booking update commit. Fix: inspect outcomes, log structured errors on table sync failures/rejections (without breaking the booking update), and surface `meta.table_booking_sync` plus `meta.sms` safety markers in the action result. Regression: extended `tests/actions/eventsManualBookingGuards.test.ts`.
- `393. MSG-006` (P1): Missed-message import action (`importMissedMessages` in `src/app/actions/import-messages.ts`) previously used `console.error` across permission, Twilio, and Supabase failure paths, bypassing structured logging and weakening incident diagnosability near `messages` writes. Fix: replace with structured `logger` calls (avoid logging message bodies) and add a regression guard preventing direct `console.*` logging in this action. Regression: `tests/actions/importMessagesConsoleGuards.test.ts`.
- `394. WEBHOOK-019` (P1): Stripe webhook handler (`/api/stripe/webhook`) previously ran table card-capture and prepaid event payment side effects via `Promise.allSettled(...)` but ignored the outcomes, swallowing fulfilled Supabase `{ error }` results and hiding rejected SMS tasks in confirmation flows. Fix: inspect `Promise.allSettled` results and log structured warnings/errors for rejected promises and fulfilled Supabase errors while preserving HTTP 200 semantics to avoid retry-driven duplicate sends. Regression: extended `tests/api/stripeWebhookMutationGuards.test.ts`.
- `395. PB-016` (P1): Private booking actions (`src/app/actions/privateBookingActions.ts`) previously used `console.error` across many read/mutation paths, bypassing structured logging and weakening incident diagnosability near booking writes (including SMS queue surfaces in the same action module). Fix: replace direct `console.error` calls with structured `logger.error` via a shared `logPrivateBookingActionError(...)` helper, and add a regression guard preventing `console.*` usage in this action file. Regression: `tests/actions/privateBookingActionsConsoleGuards.test.ts`.
- `396. MSG-007` (P1): Message inbox server actions (`src/app/actions/messagesActions.ts`) and the unread-count route (`src/app/api/messages/unread-count/route.ts`) previously used `console.error` in Supabase failure paths, bypassing structured logging near `messages` reads/writes and weakening incident diagnosability. Fix: replace direct `console.*` usage with structured `logger` calls (including normalized `Error` instances) and add regression guards preventing `console.*` usage in both modules. Regression: `tests/actions/messagesActionsConsoleGuards.test.ts`, `tests/api/messagesUnreadCountRouteConsoleGuards.test.ts`.
- `397. FOH-013` (P1): FOH create-booking route (`src/app/api/foh/bookings/route.ts`) manual walk-in override previously attempted to clean up a newly inserted `table_bookings` row after table-assignment conflicts via `Promise.allSettled([...deletes])` but ignored the outcomes, risking an orphan `status='confirmed'` booking without assignments (availability corruption) under DB degradation. Fix: inspect cleanup outcomes, attempt a fail-closed cancellation fallback when delete fails, and emit structured `logger.error` with per-step failure metadata. Regression: `tests/api/fohBookingsWalkInOverrideCleanupGuards.test.ts`.
- `398. SMS-063` (P1): BOH manual table-booking SMS route (`src/app/api/boh/table-bookings/[id]/sms/route.ts`) previously swallowed unexpected `sendSMS` exceptions (catch without logging) and returned HTTP 502 with no structured error context, weakening incident diagnosability on a manual send surface. Fix: capture and log the exception via structured `logger.error` with booking/customer metadata (no message bodies). Regression: extended `tests/api/bohTableBookingSmsRouteSafety.test.ts` to assert the fail-closed 502 response and logger emission when `sendSMS` throws.
- `399. DIAG-001` (P1): Diagnostic server actions that touch Twilio/messages (`src/app/actions/diagnose-messages.ts`, `src/app/actions/diagnose-webhook-issues.ts`) previously used `console.log/error`, bypassing structured logging and weakening incident diagnosability. Fix: replace `console.*` with structured `logger` calls (avoid logging message bodies/PII) and add a regression guard blocking `console.*` usage in these modules. Regression: `tests/actions/diagnosticActionsConsoleGuards.test.ts`.
- `400. FOH-014` (P1): FOH event booking route (`src/app/api/foh/event-bookings/route.ts`) previously scheduled analytics + manager email + optional SMS side-effect tasks via `Promise.allSettled(...)` but ignored the outcomes, so a rejected manager email promise could be silently swallowed (and future task rejections would be invisible), weakening incident diagnosability on a staff booking-create surface. Fix: label side-effect tasks, inspect `Promise.allSettled` outcomes, and emit a structured `logger.warn` when any task rejects (while still returning HTTP 201/200 to avoid retry-driven duplicates after successful booking creation). Regression: extended `tests/api/fohEventBookingsSmsMeta.test.ts` to force a manager-email rejection and assert the warning is emitted.
- `401. TB-004` (P1): Table booking create route (`src/app/api/table-bookings/route.ts`) previously awaited post-RPC side effects (`sendTableBookingCreatedSmsIfAllowed`, `sendManagerTableBookingCreatedEmailIfAllowed`, and `alignTableCardCaptureHoldToScheduledSend`) without guarding unexpected promise rejections, which could throw after a booking is created and return HTTP 500 before idempotency response persistence (retry-driven duplicate-send/duplicate-booking risk + stuck idempotency claims). Fix: wrap side-effect helpers in try/catch, log structured warnings on rejection, and surface `meta.sms` as `{ success: false, code: 'unexpected_exception', logFailure: false }` when the SMS helper rejects so the route can still persist an idempotency response and return HTTP 201. Regression: extended `tests/api/tableBookingsRouteSmsMeta.test.ts` to assert the success response and `meta.sms` on helper rejection.
- `402. SMS-064` (P0): Bulk SMS direct-send action (`src/app/actions/sms-bulk-direct.ts`, used by `src/app/(authenticated)/messages/bulk/page.tsx`) previously returned `{ error }` when the shared bulk helper aborted due to fatal safety signal `logging_failed` (transport send may have occurred but outbound message persistence failed). This surfaced as a UI error toast and encouraged operator retries, amplifying duplicate-send risk during degraded outbound logging/idempotency. Fix: detect `logging_failed` aborts, return `{ success: true, code: 'logging_failed', logFailure: true }` with an explicit "do not retry" message, and add a regression guard. Regression: `tests/actions/smsBulkDirectFailSafe.test.ts`.
- `403. FOH-015` (P1): FOH food order alert route (`src/app/api/foh/food-order-alert/route.ts`) previously returned HTTP 500 whenever `sendSMS` returned `success: false`. If a fatal post-send persistence safety signal (`logging_failed` / `logFailure: true`) is ever surfaced as `success: false` (consistent with some bulk/queue abort wrappers), this would surface as a UI error and encourage rapid operator retries from `FohScheduleClient`, increasing duplicate-alert risk during degraded persistence. Fix: treat `logging_failed`/`logFailure` as a fail-safe success response (HTTP 200 + `{ success: true, code: 'logging_failed', logFailure: true }`) while logging the fatal condition, to avoid retry-driven duplicate alerts. Regression: extended `tests/api/fohFoodOrderAlertRouteSafety.test.ts`.
- `404. FOH-016` (P1): FOH create booking route (`src/app/api/foh/bookings/route.ts`) previously allowed Sunday pre-order capture (`saveSundayPreorderByBookingId`) to throw after the booking mutation committed (confirmed/pending-card-capture states), returning HTTP 500 and encouraging operator retries that can create duplicate bookings/SMS side effects. Fix: wrap Sunday pre-order capture/link handling in fail-safe try/catch blocks; on capture/link exceptions, log structured warnings and return HTTP 201 with explicit `sunday_preorder_state`/`sunday_preorder_reason` (and attempt the existing fallback link-send path) instead of throwing. Regression: `tests/api/fohBookingsSundayPreorderFailSafe.test.ts`.
- `405. SMS-065` (P0): SMS server actions in `src/app/actions/sms.ts` still had retry-driving fail-open behavior on fatal post-send persistence signals. `sendBulkSMSAsync` returned `{ error }` when shared bulk dispatch aborted with `logging_failed`, and `sendSms` / `sendOTPMessage` treated `success: false` as hard failure even when `code: 'logging_failed'` / `logFailure: true` indicated transport may already have sent while outbound message logging failed. This could trigger duplicate resend loops from UI/operator retries during persistence degradation. Fix: normalize fatal `logging_failed` handling to fail-safe success payloads (`success: true`, `code: 'logging_failed'`, `logFailure: true`) with explicit do-not-retry messaging for bulk sends and structured error logging. Regression: extended `tests/actions/smsActions.test.ts` with bulk-abort, OTP, and manual-send `logging_failed` fail-safe cases.
- `406. SMS-066` (P1): BOH manual table-booking SMS route (`src/app/api/boh/table-bookings/[id]/sms/route.ts`) returned HTTP 502 for `sendSMS` non-success responses even when fatal safety metadata signaled `logging_failed` (`code: 'logging_failed'` / `logFailure: true`), a state that can occur after transport send with persistence failure. This response pattern encourages operator retries and duplicate sends. Fix: treat `logging_failed` as fail-safe success (HTTP 200 with `success: true`, `code`, `logFailure`) while logging the fatal condition; retain HTTP 502 for true unsent failures. Regression: extended `tests/api/bohTableBookingSmsRouteSafety.test.ts` with a `success:false + logging_failed` case asserting HTTP 200 + safety metadata.
- `407. EVENT-016` (P1): Event manual booking actions in `src/app/actions/events.ts` still treated some `logging_failed` outcomes as unsent when helpers returned `success: false` (while `code: 'logging_failed'`/`logFailure: true` indicated transport may already have sent and persistence failed). This could surface retry-driving behavior in admin flows (`createEventManualBooking`, `updateEventManualBookingSeats`, `cancelEventManualBooking`). Fix: normalize these paths to `sms_sent: true` and `meta.sms.success: true` whenever the fatal safety signal indicates "sent/unknown", while preserving `code`/`logFailure` metadata and avoiding false non-success warn logs. Regression: extended `tests/actions/eventsManualBookingGuards.test.ts` with creation, seat-update, and cancellation `logging_failed` fail-safe cases.
- `408. SMS-067` (P1): Event booking/waitlist API send paths still treated `success:false + logging_failed` as unsent in returned SMS meta, even though this fatal signal means transport may already have sent and outbound message persistence failed. Affected routes: `src/app/api/event-bookings/route.ts`, `src/app/api/event-waitlist/route.ts`, and `src/app/api/foh/event-bookings/route.ts`. This could surface retry-driving false failures to callers/operator tooling. Fix: normalize these paths to `meta.sms.success: true` whenever `code: 'logging_failed'` or `logFailure` indicates "sent/unknown", and suppress non-success warning logs for that fatal post-send signal. Regression: extended `tests/api/eventBookingsRouteSmsMeta.test.ts`, `tests/api/eventWaitlistRouteSmsMeta.test.ts`, and `tests/api/fohEventBookingsSmsMeta.test.ts` with `success:false + logging_failed` cases.
- `409. WEBHOOK-020` (P1): Stripe webhook blocked seat-increase handling (`src/app/api/stripe/webhook/route.ts`) updated `payments` to `failed` but did not verify affected rows before continuing, which allowed silent no-op state transitions on a payment write path and weakened fail-closed guarantees under race/drift conditions. Fix: require strict row-effect checks for the blocked-seat-increase payment update; when zero rows update, verify an existing terminal payment row (`failed`/`refunded`) exists, otherwise throw and fail closed. Regression: extended `tests/api/stripeWebhookMutationGuards.test.ts` with a blocked seat-increase no-row-update case that returns HTTP 500 and skips idempotency-response persistence.
- `410. WEBHOOK-021` (P1): Stripe webhook prepaid-event confirmation (`src/app/api/stripe/webhook/route.ts`) still used `Promise.allSettled(...)` but only handled rejected SMS tasks, silently ignoring fulfilled non-success SMS outcomes returned by `sendEventPaymentConfirmationSms` (for example `{ success:false, code:'provider_unavailable' }`). This hid send-path degradation on a payment-confirmation webhook surface. Fix: inspect fulfilled SMS outcomes, and emit structured warning/error telemetry when `success !== true` (including explicit handling for `logging_failed` signals), while keeping HTTP 200 semantics to avoid retry-driven duplicates. Regression: extended `tests/api/stripeWebhookMutationGuards.test.ts` with a fulfilled non-success prepaid-confirmation SMS case asserting webhook success + warning telemetry.
- `411. WEBHOOK-022` (P1): Stripe webhook seat-increase confirmation (`src/app/api/stripe/webhook/route.ts`) still used `Promise.allSettled(...)` but only handled rejected SMS tasks, silently ignoring fulfilled non-success SMS outcomes returned by `sendEventBookingSeatUpdateSms` (for example `{ success:false, code:'provider_unavailable' }`). This hid send-path degradation on a payment-confirmation webhook surface. Fix: inspect fulfilled SMS outcomes, and emit structured warning/error telemetry when `success !== true` (including explicit handling for `logging_failed` signals), while keeping HTTP 200 semantics to avoid retry-driven duplicates. Regression: extended `tests/api/stripeWebhookMutationGuards.test.ts` with a fulfilled non-success seat-increase SMS case asserting webhook success + warning telemetry.
- `412. WEBHOOK-023` (P1): Stripe checkout-failure handling (`handleCheckoutSessionFailure` in `src/app/api/stripe/webhook/route.ts`) updated `payments` to `failed` but previously treated zero-row updates as a silent success and returned early, which hid missing/stale payment rows on a payment write path and weakened fail-closed guarantees under race/drift conditions. Fix: enforce strict row-effect checks for checkout-failure updates; when zero rows are updated, require a verified existing terminal payment state (`failed`/`succeeded`/`refunded`/`partially_refunded`) before acknowledging as a safe no-op, otherwise throw and fail closed. Also emit explicit warning telemetry when booking lookup for analytics fails, instead of silently swallowing lookup errors. Regression: extended `tests/api/stripeWebhookMutationGuards.test.ts` with checkout-failure no-row cases for both fail-closed missing-payment behavior and safe terminal-status acknowledgement without retry-SMS fanout.
- `413. WEBHOOK-024` (P1): Stripe webhook table-card-capture confirmation (`src/app/api/stripe/webhook/route.ts`) still used `Promise.allSettled(...)` but the SMS helper (`sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed`) returned `void` and swallowed booking/customer lookup errors, so fulfilled non-success/logging-failure SMS outcomes were effectively invisible at the webhook layer. This left a fail-open observability gap on a send path. Fix: return structured SMS safety metadata from the helper, fail closed on booking/customer lookup DB errors (surfaced as rejected `allSettled` tasks), and inspect fulfilled SMS outcomes in the webhook to emit explicit warning/error telemetry when `success !== true` (including `logging_failed`) while preserving HTTP 200 semantics to avoid retry-driven duplicates. Regression: extended `tests/api/stripeWebhookMutationGuards.test.ts` with two table-card-capture fulfilled non-success cases (`provider_unavailable` and `logging_failed`).
- `414. EVENT-018` (P1): Event manual booking cancellation (`cancelEventManualBooking` in `src/app/actions/events.ts`) only checked follow-up update `error` fields for `booking_holds` release and linked `table_bookings` cancellation. Zero-row follow-up updates were treated as success without verifying post-update state, so stale/race conditions could leave active linked rows while the action returned `success` (and could proceed to SMS/analytics). Fix: add strict follow-up mutation evidence checks and fail-closed post-update verification for zero-row outcomes: when a follow-up update returns zero rows, the action now verifies no active linked rows remain; if verification errors, result shape is unavailable, or active rows still exist, it fails closed with existing operator-facing error messages and structured warning metadata. Regression: extended `tests/actions/eventsManualBookingGuards.test.ts` with a cancellation zero-row linked-table verification case that asserts fail-closed behavior and warning metadata.
- `415. EVENT-019` (P1): Event booking create rollback for table reservation conflicts (`cancelEventBookingAfterTableReservationFailure` in `src/app/api/event-bookings/route.ts`) previously treated a zero-row `booking_holds` release update as success when no mutation error was returned, without verifying whether active payment-hold rows still remained. Under stale/racy state, this could return conflict/rollback success semantics while leaving active holds attached to a cancelled booking. Fix: enforce strict row-effect verification for hold-release updates during rollback; when update returns zero rows, run a post-update verification query for remaining active payment holds and fail closed if verification errors, result shape is invalid, or active rows remain. Regression: extended `tests/api/eventBookingsRouteSmsMeta.test.ts` with a zero-row hold-release verification case that asserts HTTP 500 plus no SMS send / no idempotency response persistence / no idempotency claim release.
- `416. EVENT-020` (P1): Event manual booking create rollback (`rollbackEventBookingForTableFailure` in `src/app/actions/events.ts`) still treated zero-row `booking_holds` payment-hold release updates as success when no mutation `error` was returned, without verifying whether active payment holds still remained after cancellation rollback. Under stale/racy state this could return a blocked table-reservation outcome while leaving active holds attached to the cancelled booking. Fix: enforce strict hold-release row-effect verification during rollback; when update returns zero rows, query remaining active payment holds and fail closed if verification errors, result shape is unavailable, or active rows remain. Regression: extended `tests/actions/eventsManualBookingGuards.test.ts` with a table-reservation rollback zero-row hold-release verification case that asserts fail-closed action error, verification query execution, and rollback failure logging.
- `417. EVENT-021` (P1): FOH event booking create rollback (`cancelEventBookingAfterTableReservationFailure` in `src/app/api/foh/event-bookings/route.ts`) still treated zero-row `booking_holds` payment-hold release updates as success when no mutation `error` was returned, without verifying whether active payment holds remained after rollback. Under stale/racy state this could return a table-reservation conflict outcome while leaving active holds attached to the cancelled booking. Fix: enforce strict hold-release row-effect verification during rollback; when update returns zero rows, query remaining active payment holds and fail closed if verification errors, result shape is unavailable, or active rows remain. Regression: extended `tests/api/fohEventBookingsSmsMeta.test.ts` with a zero-row hold-release verification case asserting HTTP 500 conflict-finalization failure, no SMS send, verification query execution, and rollback failure logging.
- `418. WEBHOOK-025` (P1): Stripe webhook retry-SMS paths (`handleCheckoutSessionCompleted` blocked branch + `handleCheckoutSessionFailure`) still treated fulfilled non-success `sendEventPaymentRetrySms` outcomes as success and only handled thrown exceptions, leaving fatal post-send logging failures (`code: 'logging_failed'` / `logFailure: true`) and other non-success send states invisible on a webhook send surface. Fix: add a shared retry-SMS outcome handler in `src/app/api/stripe/webhook/route.ts` that inspects fulfilled results, emits `logger.error` for `logging_failed` and `logger.warn` for other non-success outcomes, while preserving HTTP 200 webhook semantics to avoid retry-driven duplicate sends. Regression: extended `tests/api/stripeWebhookMutationGuards.test.ts` with checkout-failure `logging_failed` and blocked-checkout non-success retry-SMS cases.
- `419. EVENT-022` (P1): Event manual booking seat-update action (`updateEventManualBookingSeats` in `src/app/actions/events.ts`) updated linked `table_bookings` party size but treated zero-row updates as success when no mutation error was returned, with no post-update verification. Under stale/racy state this could return `success` while active linked table bookings remained unsynced. Fix: require mutation-result evidence (`.select('id')`) for linked-table updates and, when zero rows update, verify no active linked table bookings remain; surface failures via `meta.table_booking_sync` (`mutation_result_unavailable`, verification errors, `active_rows_remaining:N`) and emit structured error telemetry instead of silent success. Regression: extended `tests/actions/eventsManualBookingGuards.test.ts` with a zero-row linked-table-sync verification case asserting surfaced failure meta and logger error.
- `420. WEBHOOK-026` (P1): Stripe webhook table-card-capture customer sync (`handleTableCardCaptureCheckoutCompleted` in `src/app/api/stripe/webhook/route.ts`) only surfaced explicit Supabase errors for the `customers` `stripe_customer_id` update and treated zero-row updates as silent success, leaving stale/missing-row sync drift invisible on a payment-confirmation write path. Fix: require mutation evidence via `.select('id')`, and when the update returns zero rows, run a verification lookup to classify and log `mutation_result_unavailable`, lookup errors, missing customer rows, unset `stripe_customer_id`, and mismatched existing Stripe customer IDs while preserving HTTP 200 webhook semantics to avoid retry-driven duplicate side effects. Regression: extended `tests/api/stripeWebhookMutationGuards.test.ts` with a zero-row customer sync case asserting verification telemetry + webhook success.
- `420 (follow-up). WEBHOOK-026` (P1): Twilio status webhook handling (`src/app/api/webhooks/twilio/route.ts`) still had a fail-open path around customer delivery-outcome writes: duplicate status callbacks short-circuited before re-applying delivery-outcome updates, and `applySmsDeliveryOutcome` could soft-fail on customer lookup/update errors without enforcing row-effect outcomes. Fix: re-apply delivery outcomes before duplicate-status ACK, and fail closed on customer lookup/update errors or zero-row customer updates for delivered/failed outcomes. Keep analytics emit best-effort to avoid retry loops on non-critical telemetry. Regression: extended `tests/api/twilioWebhookMutationGuards.test.ts` with duplicate-status and post-status delivery-outcome DB-failure fail-closed cases.
- `420 (follow-up 2). PARK-009` (P1): Parking booking create route (`src/app/api/parking/bookings/route.ts`) called `sendParkingPaymentRequest` after booking/payment-order creation but ignored returned SMS safety metadata (`sent`, `skipped`, `code`, `logFailure`), so fatal post-send persistence signals (`logging_failed`) and unsent provider failures were hidden from API callers on a send/write-adjacent path. Fix: capture/normalize helper outcomes, surface `meta.sms` + `meta.status_code` on the HTTP 201 response, emit explicit `logger.error` on `logging_failed`, and map thrown SMS-task exceptions to safe `meta.sms` fallback (`code: 'unexpected_exception'`) without returning retry-driving failures after booking commit. Regression: extended `tests/api/idempotencyPersistFailClosedAdditionalRoutes.test.ts` with logging-failed and unsent-provider cases asserting surfaced `meta.sms`.
- `420 (follow-up 3). SMS-069` (P1): Event booking send paths (`src/app/api/event-bookings/route.ts`, `src/app/api/event-waitlist/route.ts`, `src/app/api/foh/event-bookings/route.ts`) previously set `meta.sms` to `null` when the route-level SMS side-effect promise rejected unexpectedly, masking failure context on successful mutation responses. Fix: surface explicit fallback safety metadata (`{ success: false, code: 'unexpected_exception', logFailure: false }`) on these rejected-task paths while preserving non-retry-driving success responses. Regression: extended `tests/api/eventBookingsRouteSmsMeta.test.ts`, `tests/api/eventWaitlistRouteSmsMeta.test.ts`, and `tests/api/fohEventBookingsSmsMeta.test.ts` with rejected-task scenarios asserting surfaced fallback `meta.sms`.
- `381. IDEMP-004` (P0): Public booking mutation routes `/api/public/private-booking` and `/api/external/create-booking` previously released idempotency claims when `persistIdempotencyResponse` failed after a successful booking creation, deleting the idempotency-key row and allowing retries to create duplicate bookings (and downstream duplicate notifications/SMS) during DB outages. Fix: catch idempotency-response persistence failures, return HTTP 201 with the created booking reference, log structured errors, and intentionally keep the idempotency claim (skip `releaseIdempotencyClaim`) once a booking has been created. Regression: `tests/api/bookingCreateIdempotencyFailClosed.test.ts`.
- `380. EVENT-011` (P1): Seat-update SMS helper `sendEventBookingSeatUpdateSms` previously propagated `code`/`logFailure` but did not emit an explicit error when `sendSMS` reported a transport-success-but-log-failed outcome (`code: 'logging_failed'` / `logFailure: true`), leaving degraded outbound message persistence harder to detect in Stripe webhook, guest, and staff seat-update flows. Fix: log `logger.error` on `logFailure` and include `code`/`logFailure` in non-success warn logs. Regression: `tests/lib/eventBookingSeatUpdateSmsSafety.test.ts`.
- `379. SMS-056` (P1): Private booking booking-create + update flows previously used `.catch(console.error)` on SMS queue-and-send calls, swallowing thrown exceptions and hiding queue/send failures and `logFailure` safety signals. Fix: remove `.catch(console.error)`, capture per-trigger SMS side-effect summaries on returned booking objects (`smsSideEffects`), and emit structured error logs when queue/send fails or outbound message logging fails. Regression: `tests/services/testPrivateBookingServiceFailClosedCatchHandlers.test.ts`.
- `378. QUEUE-018` (P1): Private booking SMS queue duplicate suppression used a check-then-insert pattern with no atomic lock, allowing concurrent sends to race and create duplicate queue rows (and increasing duplicate-send risk if safety persistence is degraded). Fix: add a short-lived idempotency-key lock around the duplicate lookup + queue insert in `SmsQueueService.queueAndSend`, and fail closed when the lock is held and no existing queue row is found. Regression: `tests/services/smsQueue.service.test.ts`.
- `377. SCRIPT-074` (P1): Many scripts still ended with `.catch(console.error)`, swallowing thrown errors and exiting `0` (false-green diagnostics and unsafe maintenance runs). Fix: replace `.catch(console.error)` with a fail-closed catch handler (`process.exitCode = 1`) across `scripts/`, and add a regression guard that blocks reintroducing `.catch(console.error)` in scripts. Regression: `tests/scripts/testScriptsFailClosedCatchHandlers.test.ts`.
- `376. SCRIPT-073` (P1): Several local operational scripts were still unsafe by default: `scripts/verify-hiring-flow.ts` always performed DB mutations (create job + submit application + cleanup) with no dry-run default or explicit mutation gating, and `scripts/debug-outstanding.ts` used `.catch(console.error)` / log-and-return patterns that could exit `0` on failures (false-green diagnostics). Fix: `verify-hiring-flow` now defaults to dry-run and requires explicit multi-gating (`--confirm` + `RUN_VERIFY_HIRING_FLOW_MUTATION=true` + `ALLOW_VERIFY_HIRING_FLOW_MUTATION_SCRIPT=true`) before any writes; it also uses checked cleanup deletes. `debug-outstanding` now fails closed via `process.exitCode=1` on any query/RPC error. Regression: `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts`.
- `375. SCRIPT-072` (P0): `scripts/clear-cashing-up-data.ts` previously deleted entire cashing-up tables with the service-role key and no dry-run default, no explicit caps, and fail-open error handling (`.catch(console.error)`), creating extreme production data-loss risk. Fix: script now defaults to dry-run, requires explicit multi-gating (`--confirm` + `RUN_CLEAR_CASHING_UP_DATA_MUTATION=true` + `ALLOW_CLEAR_CASHING_UP_DATA_MUTATION_SCRIPT=true`), requires an explicit `--limit` (hard cap `5000`), deletes only selected IDs with strict row-effect checks, and fails closed via `process.exitCode=1`. Regression: `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts`.
- `374. SMS-055` (P1): Event payment confirmation + retry SMS notifications (`sendEventPaymentConfirmationSms`, `sendEventPaymentRetrySms`) previously treated `sendSMS` transport success as full success even when outbound message logging failed (`code: 'logging_failed'` / `logFailure: true`), hiding `messages` persistence degradation during Stripe webhook processing. Fix: log an explicit `logger.error` when `logFailure` is true and include `code` in non-success warn logs so webhook-triggered payment notifications are observable without triggering retry-driven duplicate sends. Regression: `tests/lib/eventPaymentSmsSafetyMeta.test.ts`.
- `373. PARK-007` (P1): Parking payment request + payment confirmation SMS notifications previously did not persist `sendSMS` safety markers (`code`/`logFailure`, including `logging_failed`) into `logParkingNotification` payloads, making transport-success-but-log-failed outcomes hard to reconcile and easy to miss during incidents. Fix: persist `sms_code` and `sms_log_failure` markers in notification payloads and emit explicit `logger.error` logs when outbound message logging fails. Regression: `tests/lib/parkingPaymentsPersistence.test.ts`.
- `372. SMS-054` (P1): Several non-cron send surfaces (public event booking + waitlist join routes, FOH event booking create, table booking create route, and event admin manual booking actions) previously treated `sendSMS` transport success as a full success even when outbound message logging failed (`code: 'logging_failed'` / `logFailure: true`), hiding degraded `messages` persistence from callers and increasing retry/duplicate-send risk. Fix: extract `{ success, code, logFailure }`, log `logger.error` when `logFailure` is true, and surface safety meta via `meta.sms` in success payloads/action returns (without returning retry-triggering 500s). Regression: `tests/api/eventBookingsRouteSmsMeta.test.ts`, `tests/api/eventWaitlistRouteSmsMeta.test.ts`, `tests/api/fohEventBookingsSmsMeta.test.ts`, `tests/api/tableBookingsRouteSmsMeta.test.ts`, `tests/lib/tableBookingCreatedSmsMeta.test.ts`, `tests/actions/eventsManualBookingGuards.test.ts`.
- `371. SCRIPT-071` (P1): SMS testing scripts (`scripts/testing/test-table-booking-sms.ts`, `scripts/testing/test-enrollment-with-sms.ts`) previously treated `sendSMS` transport success as a full success even when outbound message logging failed (`code: 'logging_failed'` / `logFailure: true`), allowing incident diagnostics to report false-green and risking resend loops when `messages` persistence is degraded. Fix: treat `logging_failed` / `logFailure` as fatal for these scripts and exit non-zero via `process.exitCode`. Regression: `tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts`.
- `370. SCRIPT-070` (P1): SMS cleanup scripts (`scripts/cleanup/delete-old-sms-messages.ts`, `scripts/cleanup/delete-all-queued-messages.ts`, `scripts/cleanup/delete-all-pending-sms.ts`, `scripts/cleanup/delete-pending-sms.ts`) still had unsafe operational defaults (no dry-run default / missing explicit caps / interactive behavior) for destructive message/job deletes and pending-job cancellations. Fix: default to dry-run, require explicit multi-gating (`--confirm` + `RUN_*` + `ALLOW_*`) and explicit capped limits (with hard caps) before any mutation; remove interactive `readline` flows; and fail closed via `process.exitCode` (no `process.exit`). Regression: `tests/scripts/testSmsCleanupScriptsSafety.test.ts`.
- `369. SMS-053` (P1): FOH food order alert route (`/api/foh/food-order-alert`) previously returned `{ success: true }` even when `sendSMS` reported a fatal safety signal (`code: 'logging_failed'` / `logFailure: true`), hiding degraded outbound message persistence from the UI/operator and making it easy to continue sending alerts while safety limits were unreliable. Fix: always surface `code`/`logFailure` in the success payload and log an explicit error when `logFailure` is true (while keeping HTTP 200 to avoid retry-driven duplicate sends). Regression: `tests/api/fohFoodOrderAlertRouteSafety.test.ts`.
- `368. SMS-052` (P0): Event guest engagement cron (`/api/cron/event-guest-engagement`) previously loaded `messages` dedupe sets with warn-and-continue fail-open behavior and ran multiple SMS-producing passes concurrently via `Promise.all`, so `sendSMS` fatal safety signals (`logFailure` / `code: 'logging_failed'`, plus `safety_unavailable` / `idempotency_conflict`) or dedupe unavailability in one pass could not reliably stop the other passes from continuing to fan out. Fix: dedupe loaders now fail closed and the cron aborts remaining sends on fatal SMS safety signals, with all passes executed sequentially so a single abort reliably stops the rest; return HTTP 200 with explicit abort metadata while persisting a failed run result (avoiding retry-driven resend loops). Regression: `tests/api/eventGuestEngagementRouteErrors.test.ts`.
- `367. SMS-051` (P0): Parking notifications cron (`/api/cron/parking-notifications`) previously ignored fatal `sendSMS` safety signals (`logFailure` / `code: 'logging_failed'`, plus `safety_unavailable` / `idempotency_conflict`) and could continue processing additional bookings even when outbound message persistence/safety limits were degraded; it also swallowed `parking_booking_notifications` persistence failures after sending, weakening its own dedupe history and enabling repeat sends when notification logging fails. Fix: abort the run immediately on fatal SMS safety signals and fail closed when notification logging fails after a successful send; remove `Promise.all` concurrency between payment-lifecycle and session-reminder passes so an abort in one pass reliably stops the other; and return HTTP 200 with explicit abort metadata while persisting a failed run result (avoiding retry-driven resend loops). Regression: `tests/api/parkingNotificationsRouteErrors.test.ts`.
- `366. SMS-050` (P0): Private booking monitor cron (`/api/cron/private-booking-monitor`) previously swallowed `messages` dedupe lookup errors (fail-open) and continued multi-pass reminder/expiration/feedback sends while ignoring fatal SMS safety signals from queue/direct send paths (`logFailure` / `code: 'logging_failed'`, plus `safety_unavailable` / `idempotency_conflict`), enabling continued fanout when outbound message persistence/dedupe cannot be trusted. Fix: dedupe load now fails closed; the cron aborts remaining sends on fatal safety signals across all passes (including direct feedback follow-up) while returning explicit abort metadata with HTTP 200 (to avoid retry loops) and persisting a failed run result; and `expireBooking` + queue send results now propagate `code`/`logFailure` so callers can detect degraded outbound-message logging. Regression: `tests/api/privateBookingMonitorRouteErrors.test.ts`.
- `365. SMS-049` (P0): Sunday pre-order cron (`/api/cron/sunday-preorder`) previously swallowed `messages` dedupe lookup errors (fail-open) and continued processing bookings while ignoring fatal `sendSMS` safety signals (`logFailure` / `code: 'logging_failed'`, plus `safety_unavailable` / `idempotency_conflict`), allowing continued fanout during degraded outbound message persistence/dedupe. Fix: dedupe load now fails closed, and the cron aborts remaining sends on fatal SMS safety signals while returning explicit abort metadata and marking the run failed (without returning a retry-triggering 500). Regression: `tests/api/sundayPreorderRouteErrors.test.ts`.
- `364. WAITLIST-004` (P0): Event waitlist-offers cron previously continued processing offers when `sendSMS` returned a fatal safety signal (`code: 'logging_failed'` / `logFailure: true`), allowing fanout while outbound message persistence (and safety limits) were degraded. Fix: `sendWaitlistOfferSms` now propagates `code`/`logFailure`, and `/api/cron/event-waitlist-offers` aborts remaining sends on fatal SMS safety signals (returning abort metadata/counters). Regression: `tests/api/eventWaitlistOffersRouteErrors.test.ts`.
- `363. EVENT-010` (P1): `sendEventBookingSeatUpdateSms` previously collapsed `sendSMS` results into a boolean, dropping `code`/`logFailure` safety signals (including `logging_failed`) so callers could not detect degraded outbound-message persistence. Fix: return `{ success, code, logFailure }` and update staff/admin callers to interpret the transport-success semantics while surfacing safety signals. Regression: `tests/lib/eventBookingSeatUpdateSmsSafety.test.ts`.
- `362. SMS-048` (P1): BOH manual table-booking SMS route (`/api/boh/table-bookings/[id]/sms`) previously returned success responses without surfacing `sendSMS` safety signals (`code`/`logFailure`, including `logging_failed`), so UI callers could not distinguish full success from degraded outbound-message logging. Fix: include `code`/`logFailure` in the success payload. Regression: `tests/api/bohTableBookingSmsRouteSafety.test.ts`.
- `361. MSG-004` (P1): `MessageService.sendReply` previously returned success on transport send but dropped `sendSMS` safety signals (`code`/`logFailure`, including `logging_failed`), so UI callers could not detect degraded outbound-message persistence. Fix: propagate `code`/`logFailure` to `sendReply` results without treating transport sends as failures. Regression: `tests/services/messages.service.test.ts`.
- `360. QUEUE-017` (P0): Private-booking SMS queue send paths (`SmsQueueService.sendPrivateBookingSms`, `queueAndSend`, `sendApprovedSms`) previously dropped `sendSMS` safety signals (`code`/`logFailure`, including `logging_failed`) and did not persist those markers in queue metadata, making it easy for batch callers to continue sending while safety limits (which query `messages`) were degraded and making reconciliation difficult. Fix: propagate `code`/`logFailure` through queue send returns and persist `sms_code`/`sms_log_failure` markers in `private_booking_sms_queue.metadata`. Regression: `tests/services/smsQueue.service.test.ts`.
- `359. QUEUE-016` (P0): Queue-driven SMS dispatch did not honor `sendSMS`'s fatal safety signal `logFailure`/`code: 'logging_failed'` (transport send succeeded but outbound `messages` persistence failed), allowing job workers to continue sending while safety limits (which query `messages`) were degraded. In addition, UnifiedJobQueue processed SMS jobs concurrently, so a single `logging_failed` would not abort the rest of the claimed send batch. Fix: propagate `code`/`logFailure` through `sendSms`/`sendOTPMessage`, harden both UnifiedJobQueue and legacy JobQueue `send_sms` execution to treat `logging_failed` as fatal, treat `safety_unavailable`/`idempotency_conflict` as fatal abort signals for queue batches, and serialize `send_sms`/`send_bulk_sms` jobs so the UnifiedJobQueue requeues remaining send jobs immediately after the first fatal safety failure. Regression: `tests/lib/unifiedJobQueue.test.ts`, `tests/lib/backgroundJobsQueue.test.ts`, `tests/actions/smsActions.test.ts`.
- `358. SCRIPT-069` (P0): Additional SMS diagnostic scripts (`scripts/database/check-sms-jobs.ts`, `scripts/database/check-bulk-sms-jobs.ts`, `scripts/database/check-sms-queue.ts`, `scripts/database/check-table-booking-sms.ts`, and `scripts/testing/test-sms-new-customer.ts`) previously had unsafe and unreliable behavior: broken imports, swallowed errors via `.catch(console.error)` (exit 0 on failure), invalid console formatting, and `check-table-booking-sms` performed an ungated `insert` to auto-create a missing SMS template (production DB mutation risk) as part of a "check" script. Fix: rewrite these scripts to be strictly read-only, load `.env.local`, fail closed via explicit `markFailure(...)` (`process.exitCode = 1`) on env/query/send failures, remove the template auto-create (report missing template instead), and extend regression coverage to ensure they remain read-only and do not fail open. Regression: `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts`.
- `357. SCRIPT-068` (P1): SMS diagnostic scripts `scripts/testing/test-sms-flow.ts` and `scripts/database/check-sms-issue.ts` previously had fail-open behavior (a `recentJobs` variable redeclaration bug broke `test-sms-flow`, and `check-sms-issue` ended with `.catch(console.error)` and returned success on env/query failures), producing unreliable incident triage outputs. Fix: rename the `recentJobs` query result variable, add explicit fail-closed `markFailure(...)` helpers so missing env/DB query errors and detected missing-SMS conditions set `process.exitCode = 1`, and add regression coverage ensuring both scripts remain read-only and fail non-zero. Regression: `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts`.
- `356. SMS-047` (P0): `src/lib/twilio.ts` (the core `sendSMS` pipeline) previously swallowed outbound message-log persistence failures (message insert errors) and returned plain `success: true`, meaning safety limits could undercount sends (since limits query `messages`) and looped send paths (e.g., bulk sends) could continue dispatching SMS while persistence was degraded. Fix: `sendSMS` now surfaces outbound message logging failures explicitly via `code: 'logging_failed'` + `logFailure: true` (while preserving transport success semantics), and `src/lib/sms/bulk.ts` now aborts bulk loops on fatal safety failures (`logging_failed`, `safety_unavailable`, `idempotency_conflict`) so fanout runs stop immediately when safety/persistence cannot be trusted. Regression: `tests/lib/twilioSendLoggingFailClosed.test.ts`, `tests/lib/smsBulkLoopGuards.test.ts`.
- `355. SCRIPT-067` (P1): `scripts/sms-tools/migrate-invite-reminders.ts` previously deleted pending invite reminders and re-ran the reminder scheduler using the Supabase service-role key with no dry-run default, no explicit booking caps, and could run the scheduler without deletion (duplicate reminder creation risk), increasing risk of unbounded production mutation during incident response. Fix: add `src/lib/migrate-invite-reminders-script-safety.ts` and rewrite the script to default to dry-run unless `--confirm` is provided; require explicit multi-gating (`RUN_MIGRATE_INVITE_REMINDERS_MUTATION=true` + `ALLOW_MIGRATE_INVITE_REMINDERS_MUTATION=true` or legacy `ALLOW_MIGRATE_INVITE_REMINDERS_SCRIPT=true`); require explicit capped `--booking-limit`/`MIGRATE_INVITE_REMINDERS_BOOKING_LIMIT` (hard cap `500`); require explicit operation selection (`--delete-legacy-reminders` and/or `--reschedule`) and block `--reschedule` unless deletion is also requested; and enforce strict per-booking delete row-effect checks. Regression: `tests/lib/migrateInviteRemindersScriptSafety.test.ts`.
- `354. SCRIPT-066` (P1): `scripts/sms-tools/finalize-event-reminders.ts` previously cancelled past-event reminders and pending reminder-processing jobs using the Supabase service-role key with no dry-run default, no explicit caps, and no explicit operation selection, increasing risk of unbounded production cancellations during incident response. Fix: add `src/lib/finalize-event-reminders-script-safety.ts` and rewrite the script to default to dry-run unless `--confirm` is provided; require explicit multi-gating (`RUN_FINALIZE_EVENT_REMINDERS_MUTATION=true` + `ALLOW_FINALIZE_EVENT_REMINDERS_MUTATION=true` or legacy `ALLOW_FINALIZE_EVENT_REMINDERS_SCRIPT=true`); require explicit operation selection (`--cancel-reminders` and/or `--cancel-jobs`); require explicit capped limits (`--reminder-limit`/`--job-limit`, hard cap `500`) before any DB writes; and enforce strict query/mutation row-effect checks. Regression: `tests/lib/finalizeEventRemindersScriptSafety.test.ts`.
- `353. SCRIPT-065` (P1): `scripts/sms-tools/clear-reminder-backlog.ts` previously cancelled reminders and reminder-processing jobs using the Supabase service-role key with no dry-run default, no explicit mutation caps, and only a single allow env var gate, increasing risk of unbounded production mutation during incident response. Fix: add `src/lib/clear-reminder-backlog-script-safety.ts` and rewrite the script to default to dry-run unless `--confirm` is provided; require explicit multi-gating (`RUN_CLEAR_REMINDER_BACKLOG_MUTATION=true` + `ALLOW_CLEAR_REMINDER_BACKLOG_MUTATION=true` or legacy `ALLOW_CLEAR_REMINDER_BACKLOG_SCRIPT=true`); require explicit operation selection (`--cancel-reminders` and/or `--cancel-jobs`); and require explicit capped limits (`--reminder-limit`/`--job-limit`, hard cap `500`) before any DB writes. Regression: `tests/lib/clearReminderBacklogScriptSafety.test.ts`.
- `352. SCRIPT-064` (P1): `scripts/sms-tools/clear-stuck-jobs.ts` previously failed/cleared jobs using the Supabase service-role key with no dry-run default, no explicit mutation caps, and only a single allow env var gate, meaning an incident responder could accidentally delete/mark failed an unbounded set of jobs (including pending SMS jobs). Fix: add `src/lib/clear-stuck-jobs-script-safety.ts` and rewrite the script to default to dry-run unless `--confirm` is provided; require explicit multi-gating (`RUN_CLEAR_STUCK_JOBS_MUTATION=true` + `ALLOW_CLEAR_STUCK_JOBS_MUTATION=true` or legacy `ALLOW_CLEAR_STUCK_SMS_JOBS_SCRIPT=true`); require explicit operation selection (`--fail-stale-processing` and/or `--delete-pending-sms-jobs`); and require explicit capped limits (`--stale-limit`/`--pending-limit`, hard cap `500`) before any DB writes. Regression: `tests/lib/clearStuckJobsScriptSafety.test.ts`.
- `351. SCRIPT-063` (P1): `scripts/sms-tools/cleanup-phone-numbers.ts` previously used the Supabase service-role key to update customer phone numbers without a dry-run default or explicit mutation caps, and only enforced a single allow env var, increasing risk of unbounded production mutation during incident response. Fix: add `src/lib/cleanup-phone-numbers-script-safety.ts` and rewrite the script to default to dry-run unless `--confirm` is provided; require explicit multi-gating (`RUN_CLEANUP_PHONE_NUMBERS_MUTATION=true` + `ALLOW_CLEANUP_PHONE_NUMBERS_MUTATION=true` or legacy `ALLOW_CLEANUP_PHONE_NUMBERS_SCRIPT=true`); require an explicit capped `--limit`/`CLEANUP_PHONE_NUMBERS_LIMIT` (hard cap `500`); and guard check-then-update races by requiring the original phone number match on update. Regression: `tests/lib/cleanupPhoneNumbersScriptSafety.test.ts`.
- `350. EVENT-009` (P1): `cancelEventManualBooking` previously cancelled the event booking but then ran booking-hold release and linked table-booking cancellation updates via `Promise.allSettled(...)` and ignored any DB errors, allowing the action to return success while leaving related rows inconsistent (and potentially re-triggering downstream reminders/notifications). Fix: `src/app/actions/events.ts` now fails closed when follow-up updates error (and logs structured warnings) so staff cannot get a false-success cancellation result. Regression: `tests/actions/eventsManualBookingGuards.test.ts`.
- `349. SCRIPT-062` (P1): `scripts/sms-tools/fix-past-reminders.ts` cancels past-event reminders and deletes pending SMS jobs, but previously lacked dry-run defaults, explicit operation selection, and strict mutation caps, increasing risk of incident scripts accidentally over-mutating production state. Fix: add `src/lib/fix-past-reminders-script-safety.ts` and rewrite the script to default to dry-run unless `--confirm` is provided; require explicit multi-gating (`RUN_FIX_PAST_REMINDERS_MUTATION=true` + `ALLOW_FIX_PAST_REMINDERS_MUTATION=true`); require explicit mutation operations (`--cancel-reminders` and/or `--delete-pending-sms-jobs`); require explicit caps (`--reminder-limit`/`--job-limit`, hard cap `500`); and keep fail-closed row-effect assertions for update/delete. Regression: `tests/lib/fixPastRemindersScriptSafety.test.ts`.
- `348. SMS-046` (P1): Private booking SMS queue auto-send previously called the RBAC-gated `sendSms` server action, which requires an authenticated user session. System contexts (cron/services) could therefore fail with `Insufficient permissions` and mark queue rows as failed, suppressing legitimate reminder sends. Fix: `SmsQueueService.sendPrivateBookingSms` now resolves recipient context via `resolveCustomerIdForSms` and sends via transport-level `sendSMS` directly with stable idempotency metadata (`template_key`, `trigger_type`, `stage` + queue correlation), preserving dedupe/safety guards without depending on user auth. Regression: `tests/services/smsQueue.service.test.ts`.
- `347. SMS-045` (P0): `src/lib/sms/safety.ts` previously still included `job_id` in `DEDUPE_CONTEXT_KEYS`, so including per-job correlation IDs could bypass distributed SMS idempotency dedupe and trigger duplicate sends. Fix: remove `job_id` from the dedupe context key set and add regression coverage ensuring `metadata.job_id` does not affect dedupe key/hash. Regression: `tests/lib/sms/safety.test.ts`.
- `346. SCRIPT-061` (P1): `scripts/tools/send-feb-2026-event-review-sms.ts` previously baked in a production app URL fallback and used `process.exit(...)`, increasing risk of accidental production link sends and making safety checks harder to test. Fix: default to `http://localhost:3000` (never production) unless `NEXT_PUBLIC_APP_URL`/`--url` is provided (and require explicit URL when sending), and fail closed via `process.exitCode=1`. Regression: `tests/scripts/testSendFeb2026EventReviewSmsScriptSafety.test.ts`.
- `345. SCRIPT-060` (P1): Calendar sync testing scripts (`scripts/testing/test-calendar-sync.ts`, `scripts/testing/test-calendar-sync-admin.ts`, `scripts/testing/test-calendar-final.ts`, `scripts/testing/test-booking-calendar-sync.ts`) previously performed external Google Calendar writes and `private_bookings` updates with no gating (and could log-and-continue on failed updates), creating production mutation risk during incident diagnostics. Fix: rewrite as strictly read-only diagnostics, block `--confirm`, remove `syncCalendarEvent` calls and all DB mutation paths, and fail closed via `process.exitCode=1`. Regression: `tests/scripts/testCalendarSyncScriptsReadOnly.test.ts`.
- `344. SCRIPT-059` (P1): `scripts/tools/resync-private-bookings-calendar.ts` previously performed unbounded calendar sync + DB updates for all upcoming private bookings with only a single env gate and no dry-run default, creating production mutation risk and external side effects during incident response. Fix: default to dry-run; require explicit multi-gate mutation enablement (`--confirm` + `RUN_CALENDAR_RESYNC_MUTATION=true` + `ALLOW_CALENDAR_RESYNC_MUTATION=true`); require explicit caps (`--limit` max `50` or `--booking-id`); skip already-synced bookings by default (override with `--include-synced`); and fail closed via `process.exitCode=1` on any failure. Regression: `tests/scripts/testResyncPrivateBookingsCalendarScriptSafety.test.ts`.
- `343. SCRIPT-058` (P1): `scripts/testing/test-demographics.ts` previously inserted test short links and click rows (and deleted them during cleanup) using the Supabase service-role key with no gating, creating production DB mutation risk during incident diagnostics. Fix: rewrite as strictly read-only analytics diagnostics (select/RPC only), require explicit `--short-code`, block `--confirm`, add strict caps (`--days`, click sample limit), and fail closed via `process.exitCode=1` on any query/RPC error. Regression: `tests/scripts/testDemographicsScriptReadOnly.test.ts`.
- `342. SCRIPT-057` (P0): `scripts/testing/test-api-complete-fix.ts`, `scripts/database/check-deployment-status.ts`, and `scripts/database/check-api-key-database.ts` previously embedded real API keys and defaulted to production booking-creation POSTs (and the DB script printed full API keys), creating high risk of accidental production booking creation/outbound SMS and secret leakage. Fix: remove all hardcoded API keys; default to dry-run/read-only; require explicit multi-gate send enablement for any booking-creation POST; avoid production URL defaults; mask sensitive output; and fail closed via `process.exitCode=1` on any failure. Regression: `tests/scripts/testNoHardcodedApiKeysInScripts.test.ts`.
- `341. SCRIPT-056` (P0): `scripts/testing/test-audit-log.ts` and `scripts/testing/test-audit-log-rls.ts` previously inserted audit log rows (and `test-audit-log-rls.ts` attempted to create helper functions via RPC) using admin/service-role clients with no gating, risking production DB mutation during incident diagnostics. Fix: rewrite both scripts as strictly read-only diagnostics (select/RPC only), block `--confirm`, remove all insert/helper-function creation attempts, correct imports, and fail closed via `process.exitCode=1` on any query/RPC error. Regression: `tests/scripts/testAuditLogScriptsReadOnly.test.ts`.
- `340. SCRIPT-055` (P0): `scripts/testing/test-api-booking-fix.ts`, `scripts/testing/test-booking-now.ts`, `scripts/testing/test-sunday-lunch-api.ts`, and `scripts/testing/test-sunday-lunch-payment-fix.ts` previously hardcoded production URLs and/or embedded API keys and baked-in phone numbers while POSTing booking creation requests by default (high risk of accidental production booking creation and outbound SMS spam, plus secret leakage risk from committed keys). Fix: remove baked-in prod URLs/API keys/phones; default to dry-run; require explicit multi-gate send enablement (`--confirm` + `RUN_TEST_TABLE_BOOKING_API_SEND=true` + `ALLOW_TEST_TABLE_BOOKING_API_SEND=true`), plus remote/prod-specific gating (`--url` + `ALLOW_TEST_TABLE_BOOKING_API_REMOTE=true`, `--prod` + `ALLOW_TEST_TABLE_BOOKING_API_PROD=true`); mask secrets/phones in logs; include deterministic `Idempotency-Key`; and fail closed via `process.exitCode=1` on any failure. Regression: `tests/scripts/testTableBookingApiScriptsSafety.test.ts`.
- `339. SCRIPT-054` (P0): `scripts/testing/test-booking-api.ts` previously POSTed to the production booking initiation API (`https://management.orangejelly.co.uk/api/bookings/initiate`) using a baked-in test phone number (`07700900123`) with no explicit send gating (high risk of accidental booking creation and outbound SMS spam during incident diagnostics). Fix: default to dry-run unless `--confirm` is provided; require dual send gates (`RUN_TEST_BOOKING_API_SEND=true` + `ALLOW_TEST_BOOKING_API_SEND=true`), plus remote/prod-specific gating (`ALLOW_TEST_BOOKING_API_REMOTE=true`, `--prod` + `ALLOW_TEST_BOOKING_API_PROD=true`); remove baked-in prod URL/phone; default to `http://localhost:3000` and require explicit `--url` for remote; mask secrets/phones in logs; and fail closed via `process.exitCode=1` on any failure. Regression: `tests/scripts/testBookingApiScriptSafety.test.ts`.
- `338. SCRIPT-053` (P1): `scripts/testing/test-event-crud-fixed.ts` and `scripts/testing/test-event-image-fields.ts` previously inserted/updated/deleted events and categories using the Supabase service-role key with no gating (production DB mutation risk) to probe schema behavior. Fix: rewrite both scripts as strictly read-only schema diagnostics (select-only), including explicit checks that legacy `events.image_url` is not selectable, and fail closed via `process.exitCode=1` on any query/env error. Regression: `tests/scripts/testEventImageScriptsReadOnly.test.ts`.
- `337. SCRIPT-052` (P1): `scripts/testing/test-short-link-crud.ts` previously performed unsafe short-link CRUD (insert/update/delete) using the Supabase service-role key with no gating and could exit 0 on failures, creating production DB mutation risk (and potential link-redirect side effects). Fix: rewrite as strictly read-only diagnostics (select-only) and fail closed via `process.exitCode=1` on any query/env error. Regression: `tests/scripts/testShortLinkCrudScriptReadOnly.test.ts`.
- `336. SCRIPT-051` (P1): `scripts/testing/test-employee-creation.ts` previously inserted and deleted employee/financial/health records using the Supabase service-role key with no gating, which is a production DB mutation risk (and could leave partial data behind on errors). Fix: rewrite as strictly read-only diagnostics (table readability checks only), remove all inserts/deletes, and fail closed via `process.exitCode=1` on any query/env error. Regression: `tests/scripts/testEmployeeCreationScriptReadOnly.test.ts`.
- `335. SCRIPT-050` (P1): `scripts/testing/test-customer-labels-cron.ts` previously invoked the live `/api/cron/apply-customer-labels` route with a real `CRON_SECRET` by default (production DB mutation risk) and could exit 0 on failure, while also printing parts of the secret. Fix: add an authorized read-only `?health=true` mode to `src/app/api/cron/apply-customer-labels/route.ts` (no RPC/audit writes), and rewrite the script to be strictly read-only (health-check only), verify unauth access is rejected, avoid secret printing, and fail closed via `process.exitCode=1` on any failure. Regression: `tests/api/cronApplyCustomerLabelsHealth.test.ts`, `tests/scripts/testCustomerLabelsCronScriptReadOnly.test.ts`.
- `334. SCRIPT-049` (P0): `scripts/testing/test-cron-endpoint.ts` previously POSTed to `/api/jobs/process` using a real `CRON_SECRET` (defaulting to production URL), which can process jobs and trigger outbound side effects (SMS/email), while also exiting 0 on failures (false-success diagnostics). Fix: the script is now strictly read-only; it performs only an authenticated GET health check (`/api/jobs/process?health=true`), asserts unauthenticated access is rejected, never calls POST, and fails closed by setting `process.exitCode=1` on any failure. Regression: `tests/scripts/testCronEndpointScriptReadOnly.test.ts`.
- `333. SCRIPT-048` (P1): `scripts/testing/test-server-action-import.ts` previously called `queueBookingConfirmationSMS(...)` directly (ungated) and could enqueue/send booking SMS or mutate DB state if run with real IDs, while also exiting 0 on import failures (false-success). Fix: script is now strictly read-only (imports only; no server-action calls) and exits non-zero when any import check fails. Regression: `tests/scripts/testServerActionImportScriptReadOnly.test.ts`.
- `332. SMS-044` (P0): `sendSMS` previously trusted a provided `customerId` for eligibility checks without verifying it matched the destination phone (`to`), allowing callers (OTP/manual/queue/script paths) to pair an SMS-eligible customer with an arbitrary `to` and bypass opt-out/eligibility intent. Fix: `sendSMS` now validates the customer phone matches `to` and fails closed on mismatch. Regression: `tests/lib/twilioSendGuards.test.ts`.
- `331. SMS-043` (P0): `resolveCustomerIdForSms` previously trusted a provided `customerId` (and private booking context) without verifying it matched the destination phone, allowing manual sends to bypass opt-out/eligibility intent by pairing an unrelated SMS-eligible customer with an arbitrary `to`. Fix: validate `customerId` matches `to` (and enforce `to` matches private booking `contact_phone`, and `customerId` matches booking `customer_id` when present), failing closed on any mismatch/lookup error. Regression: `tests/lib/smsCustomers.test.ts`.
- `330. EVENT-008` (P1): `createEventManualBooking` previously returned a successful “blocked” response after table-reservation conflicts even when rollback writes failed (booking cancel or payment-hold release), logging and continuing while leaving booking/hold state inconsistent. Fix: `rollbackEventBookingForTableFailure` now throws on rollback persistence failures (including no-row cancellation updates), and `createEventManualBooking` fails closed with an explicit error when rollback cannot be confirmed. Regression: `tests/actions/eventsManualBookingGuards.test.ts`.
- `329. WEBHOOK-017` (P0): Twilio inbound STOP/opt-out keyword handling previously logged and continued even when the customer preference update failed or affected no rows, meaning the webhook could ACK success while silently dropping opt-out compliance (and allowing continued sends). Fix: in `src/app/api/webhooks/twilio/route.ts`, opt-out keyword handling now fails closed (retriable `500`) when the preference update errors or affects no rows, and it skips inbound message insertion until the opt-out write is confirmed so retries can re-attempt the write. Regression: `tests/api/twilioWebhookMutationGuards.test.ts`.
- `328. QUEUE-015` (P0): Queue-driven `send_sms` job execution previously allowed missing `customer_id`, which could fall back to `sendSMS` auto-customer creation and send without verified recipient context. Fix: both `UnifiedJobQueue` and legacy `JobQueue` now fail closed when `customer_id`/`customerId` is missing for `send_sms` payloads. Regression: `tests/lib/unifiedJobQueue.test.ts`, `tests/lib/backgroundJobsQueue.test.ts`.
- `327. SMS-042` (P0): `resolveCustomerIdForSms` (used by the `sendSms` server action) previously called `ensureCustomerForPhone` even when no booking/customer context was provided, creating new customers for arbitrary `to` phone numbers and enabling manual-send flows to silently expand the SMS-eligible population. Fix: when `bookingId`/`customerId` is missing, resolve only existing customers by phone (no inserts) and fail closed on lookup error or missing match. Regression: `tests/lib/smsCustomers.test.ts`.
- `326. SCRIPT-047` (P0): `backfill-twilio-log` (`scripts/sms-tools/backfill-twilio-log.ts`) previously defaulted to mutation behavior and could create missing customers as SMS-eligible (`sms_opt_in: true`) while inserting messages, with no strict insert cap and with unresolved rows only reported after partial writes. Fix: default to dry-run unless explicitly enabled; require explicit mutation gating (`--confirm` + `RUN_TWILIO_LOG_BACKFILL_MUTATION=true` + `ALLOW_TWILIO_LOG_BACKFILL_MUTATION_SCRIPT=true`) plus required `--limit` (hard cap `1000`); allow missing-customer creation only with separate gating and strict cap (`--allow-create-customers` + `RUN_TWILIO_LOG_BACKFILL_CREATE_CUSTOMERS=true` + `ALLOW_TWILIO_LOG_BACKFILL_CREATE_CUSTOMERS=true` + `--create-customers-limit`, hard cap `50`); and create placeholder customers as SMS-deactivated/opted-out by default. Regression: `tests/lib/twilioLogBackfillScriptSafety.test.ts`, `tests/lib/twilioLogBackfillSafety.test.ts`.
- `325. WAITLIST-003` (P1): Guest waitlist-offer acceptance confirm route SMS helper previously ignored event lookup errors/missing rows and could send an acceptance confirmation SMS with placeholder `"your event"` content. Fix: fail closed when event lookup errors or affects no rows before composing/sending acceptance SMS. Regression: `tests/api/guestWaitlistOfferConfirmRouteSmsGuards.test.ts`.
- `324. WAITLIST-002` (P1): `sendWaitlistOfferSms` previously ignored event lookup errors/missing rows and could send a waitlist offer SMS with placeholder `"your event"` content. Fix: fail closed when event lookup errors or affects no rows (before guest token creation and SMS send). Regression: `tests/lib/waitlistOffersSmsPersistence.test.ts`.
- `323. SMS-041` (P0): `sendSMS` eligibility previously checked only `sms_status`, allowing legacy opt-outs (`sms_opt_in=false` with `sms_status=null/active`) to remain SMS-eligible. Fix: include `sms_opt_in` in eligibility lookups and block sends when `sms_opt_in=false`. Regression: `tests/lib/twilioSendGuards.test.ts`.
- `322. SMS-040` (P1): Bulk-customer selection API (`/api/messages/bulk/customers`) previously filtered only on `sms_opt_in`, allowing bulk send audiences to include customers without marketing opt-in and customers with blocked `sms_status`. Fix: enforce `sms_opt_in=true`, `marketing_sms_opt_in=true`, and non-blocked `sms_status` in the route-level filters so recipient selection aligns with bulk dispatch gating. Regression: `tests/api/bulkCustomersRouteMarketingEligibility.test.ts`.
- `321. MSG-003` (P1): `diagnoseMessages` previously ignored messages-table query errors (service-role client + no error checks), producing false-positive “missing messages” results during DB outages. Fix: use `createAdminClient()`, fail closed on DB lookup error, and return early when Twilio returns zero messages. Regression: `tests/actions/diagnoseMessagesActions.test.ts`.
- `320. SMS-039` (P0): Bulk SMS helper previously only filtered on `sms_opt_in`, ignoring `marketing_sms_opt_in` (marketing consent) and `sms_status`, allowing bulk campaigns to send to customers without marketing opt-in and to customers with inconsistent opt-out state. Fix: require `sms_opt_in=true` + `marketing_sms_opt_in=true` + non-blocked `sms_status` (prefer `mobile_e164`) and fail closed on customer/event/category lookup errors. Regression: `tests/lib/smsBulkMarketingEligibility.test.ts`, `tests/lib/smsBulkLoopGuards.test.ts`.

## Files Changed in Latest Segment
- `scripts/testing/test-production-templates.ts`
- `scripts/testing/test-template-loading.ts`
- `scripts/testing/test-demographics.ts`
- `scripts/testing/test-slot-generation.ts`
- `scripts/testing/test-audit-log.ts`
- `scripts/testing/test-audit-log-rls.ts`
- `scripts/testing/test-calendar-sync.ts`
- `tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts`
- `tests/scripts/testDemographicsScriptReadOnly.test.ts`
- `tests/scripts/testAuditLogScriptsReadOnly.test.ts`
- `tests/scripts/testCalendarSyncScriptsReadOnly.test.ts`
- `scripts/testing/test-api-complete-fix.ts`
- `tests/scripts/testApiCompleteFixScriptSafety.test.ts`
- `scripts/testing/test-booking-api.ts`
- `tests/scripts/testBookingApiScriptSafety.test.ts`
- `src/lib/test-table-booking-sms-safety.ts`
- `src/lib/test-enrollment-with-sms-safety.ts`
- `tests/lib/testTableBookingSmsSafety.test.ts`
- `tests/lib/testEnrollmentWithSmsSafety.test.ts`
- `scripts/import-employee-documents.ts`
- `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts`
- `src/lib/sms-template-key-fix-safety.ts`
- `scripts/fixes/fix-sms-template-keys.ts`
- `tests/lib/smsTemplateKeyFixSafety.test.ts`
- `src/lib/table-booking-sms-fix-safety.ts`
- `scripts/fixes/fix-table-booking-sms.ts`
- `tests/lib/tableBookingSmsFixSafety.test.ts`
- `src/lib/pending-payment-fix-safety.ts`
- `scripts/fixes/fix-pending-payment.ts`
- `tests/lib/pendingPaymentFixSafety.test.ts`
- `src/lib/process-jobs-script-safety.ts`
- `scripts/process-jobs.ts`
- `tests/lib/processJobsScriptSafety.test.ts`
- `src/lib/duplicate-loyalty-program-fix-safety.ts`
- `scripts/fixes/fix-duplicate-loyalty-program.ts`
- `tests/lib/duplicateLoyaltyProgramFixSafety.test.ts`
- `src/lib/delete-all-table-bookings-safety.ts`
- `scripts/cleanup/delete-all-table-bookings.ts`
- `tests/lib/deleteAllTableBookingsSafety.test.ts`
- `src/lib/delete-test-bookings-safety.ts`
- `scripts/cleanup/delete-test-bookings.ts`
- `tests/lib/deleteTestBookingsSafety.test.ts`
- `src/lib/delete-specific-customers-safety.ts`
- `scripts/cleanup/delete-specific-customers.ts`
- `tests/lib/deleteSpecificCustomersSafety.test.ts`
- `src/lib/delete-peter-pitcher-bookings-safety.ts`
- `scripts/cleanup/delete-peter-pitcher-bookings.ts`
- `tests/lib/deletePeterPitcherBookingsSafety.test.ts`
- `src/lib/job-retry-script-safety.ts`
- `scripts/reset-jobs.ts`
- `scripts/retry-failed-jobs.ts`
- `tests/lib/jobRetryScriptSafety.test.ts`
- `src/lib/delete-peter-test-bookings-safety.ts`
- `scripts/cleanup/delete-peter-test-bookings.ts`
- `tests/lib/deletePeterTestBookingsSafety.test.ts`
- `src/lib/delete-test-customers-direct-safety.ts`
- `scripts/cleanup/delete-test-customers-direct.ts`
- `tests/lib/deleteTestCustomersDirectSafety.test.ts`
- `src/lib/delete-invoice-cleanup-safety.ts`
- `scripts/cleanup/delete-test-invoices.ts`
- `scripts/cleanup/delete-specific-invoice.ts`
- `tests/lib/deleteInvoiceCleanupSafety.test.ts`
- `src/lib/api/auth.ts`
- `tests/lib/apiAuthRateLimit.test.ts`
- `src/services/sms-queue.ts`
- `tests/services/smsQueue.service.test.ts`
- `src/lib/test-sms-new-customer-safety.ts`
- `scripts/testing/test-sms-new-customer.ts`
- `tests/lib/testSmsNewCustomerSafety.test.ts`
- `scripts/testing/test-and-fix-sms.ts`
- `tests/scripts/testAndFixSmsScriptReadOnly.test.ts`
- `src/lib/unified-job-queue.ts`
- `tests/lib/unifiedJobQueue.test.ts`
- `src/lib/send-feb-2026-event-review-sms-safety.ts`
- `scripts/tools/send-feb-2026-event-review-sms.ts`
- `tests/lib/sendFeb2026EventReviewSmsSafety.test.ts`
- `src/lib/parking/payments.ts`
- `tests/lib/parkingPaymentsPersistence.test.ts`
- `src/lib/test-table-booking-sms-safety.ts`
- `scripts/testing/test-table-booking-sms.ts`
- `tests/lib/testTableBookingSmsSafety.test.ts`
- `src/lib/test-enrollment-with-sms-safety.ts`
- `scripts/testing/test-enrollment-with-sms.ts`
- `tests/lib/testEnrollmentWithSmsSafety.test.ts`
- `scripts/testing/test-loyalty-enrollment.ts`
- `tests/scripts/testLoyaltyEnrollmentScriptReadOnly.test.ts`
- `scripts/testing/test-private-booking-customer-creation.ts`
- `tests/scripts/testPrivateBookingCustomerCreationScriptReadOnly.test.ts`
- `scripts/testing/test-critical-flows.ts`
- `tests/scripts/testCriticalFlowsScriptReadOnly.test.ts`
- `src/app/actions/sms.ts`
- `tests/actions/smsActions.test.ts`
- `src/app/actions/import-messages.ts`
- `src/app/(authenticated)/settings/import-messages/ImportMessagesClient.tsx`
- `src/scripts/import-missed-messages.ts`
- `tests/actions/importMessagesActions.test.ts`
- `tests/scripts/importMissedMessagesLegacyScriptReadOnly.test.ts`
- `src/services/customers.ts`
- `tests/services/mutation-race-guards.test.ts`
- `src/lib/sms/bulk.ts`
- `src/lib/events/waitlist-offers.ts`
- `src/app/actions/diagnose-messages.ts`
- `tests/lib/smsBulkLoopGuards.test.ts`
- `tests/lib/smsBulkMarketingEligibility.test.ts`
- `tests/actions/diagnoseMessagesActions.test.ts`
- `src/app/api/messages/bulk/customers/route.ts`
- `tests/api/bulkCustomersRouteMarketingEligibility.test.ts`
- `src/lib/twilio.ts`
- `src/app/api/webhooks/twilio/route.ts`
- `tests/api/twilioWebhookMutationGuards.test.ts`
- `tests/lib/twilioSendGuards.test.ts`
- `src/app/g/[token]/waitlist-offer/confirm/route.ts`
- `tests/lib/waitlistOffersSmsPersistence.test.ts`
- `tests/api/guestWaitlistOfferConfirmRouteSmsGuards.test.ts`
- `scripts/sms-tools/backfill-twilio-log.ts`
- `src/lib/twilio-log-backfill-safety.ts`
- `src/lib/twilio-log-backfill-script-safety.ts`
- `tests/lib/twilioLogBackfillSafety.test.ts`
- `tests/lib/twilioLogBackfillScriptSafety.test.ts`
- `src/lib/sms/customers.ts`
- `tests/lib/smsCustomers.test.ts`
- `scripts/testing/test-server-action-import.ts`
- `tests/scripts/testServerActionImportScriptReadOnly.test.ts`
- `scripts/testing/test-cron-endpoint.ts`
- `tests/scripts/testCronEndpointScriptReadOnly.test.ts`
- `scripts/testing/test-customer-labels-cron.ts`
- `tests/scripts/testCustomerLabelsCronScriptReadOnly.test.ts`
- `src/app/api/cron/apply-customer-labels/route.ts`
- `tests/api/cronApplyCustomerLabelsHealth.test.ts`
- `scripts/testing/test-employee-creation.ts`
- `tests/scripts/testEmployeeCreationScriptReadOnly.test.ts`
- `scripts/testing/test-short-link-crud.ts`
- `tests/scripts/testShortLinkCrudScriptReadOnly.test.ts`
- `scripts/testing/test-event-crud-fixed.ts`
- `scripts/testing/test-event-image-fields.ts`
- `tests/scripts/testEventImageScriptsReadOnly.test.ts`
- `scripts/testing/test-booking-api.ts`
- `tests/scripts/testBookingApiScriptSafety.test.ts`
- `scripts/testing/test-api-booking-fix.ts`
- `scripts/testing/test-booking-now.ts`
- `scripts/testing/test-sunday-lunch-api.ts`
- `scripts/testing/test-sunday-lunch-payment-fix.ts`
- `tests/scripts/testTableBookingApiScriptsSafety.test.ts`
- `scripts/testing/test-audit-log.ts`
- `scripts/testing/test-audit-log-rls.ts`
- `tests/scripts/testAuditLogScriptsReadOnly.test.ts`
- `scripts/testing/test-api-complete-fix.ts`
- `scripts/database/check-deployment-status.ts`
- `scripts/database/check-api-key-database.ts`
- `tests/scripts/testNoHardcodedApiKeysInScripts.test.ts`
- `scripts/testing/test-demographics.ts`
- `tests/scripts/testDemographicsScriptReadOnly.test.ts`
- `scripts/clear-cashing-up-data.ts`
- `scripts/verify-hiring-flow.ts`
- `scripts/debug-outstanding.ts`
- `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts`
- `tests/scripts/testScriptsFailClosedCatchHandlers.test.ts`
- `src/lib/background-jobs.ts`
- `tests/lib/backgroundJobsQueue.test.ts`
- `src/app/actions/events.ts`
- `tests/actions/eventsManualBookingGuards.test.ts`
- `scripts/tools/resync-private-bookings-calendar.ts`
- `tests/scripts/testResyncPrivateBookingsCalendarScriptSafety.test.ts`
- `scripts/testing/test-calendar-sync.ts`
- `scripts/testing/test-calendar-sync-admin.ts`
- `scripts/testing/test-calendar-final.ts`
- `scripts/testing/test-booking-calendar-sync.ts`
- `tests/scripts/testCalendarSyncScriptsReadOnly.test.ts`
- `tests/scripts/testSendFeb2026EventReviewSmsScriptSafety.test.ts`
- `src/lib/sms/safety.ts`
- `tests/lib/sms/safety.test.ts`
- `src/lib/fix-past-reminders-script-safety.ts`
- `scripts/sms-tools/fix-past-reminders.ts`
- `tests/lib/fixPastRemindersScriptSafety.test.ts`
- `src/lib/cleanup-phone-numbers-script-safety.ts`
- `scripts/sms-tools/cleanup-phone-numbers.ts`
- `tests/lib/cleanupPhoneNumbersScriptSafety.test.ts`
- `src/lib/clear-stuck-jobs-script-safety.ts`
- `scripts/sms-tools/clear-stuck-jobs.ts`
- `tests/lib/clearStuckJobsScriptSafety.test.ts`
- `src/lib/clear-reminder-backlog-script-safety.ts`
- `scripts/sms-tools/clear-reminder-backlog.ts`
- `tests/lib/clearReminderBacklogScriptSafety.test.ts`
- `src/app/api/cron/sunday-preorder/route.ts`
- `tests/api/sundayPreorderRouteErrors.test.ts`
- `scripts/oj-projects/fix-typo.ts`
- `scripts/oj-projects/fix-entry-rates.ts`
- `scripts/oj-projects/move-all-to-retainers.ts`
- `scripts/oj-projects/move-to-website-content.ts`
- `scripts/oj-projects/update-barons-retainer.ts`
- `scripts/oj-projects/update-barons-retainer-hours.ts`
- `scripts/oj-projects/add-barons-pubs-entries.ts`
- `tests/scripts/testOjProjectsScriptsSafety.test.ts`
- `scripts/testing/test-paypal-credentials.ts`
- `scripts/testing/test-microsoft-graph-email.ts`
- `tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts`
- `scripts/clear-cashing-up-data.ts`
- `scripts/verify-hiring-flow.ts`
- `scripts/seed-cashing-up.ts`
- `scripts/seed-cashup-targets.ts`
- `scripts/clear-2025-data.ts`
- `scripts/fix-bookings-is-reminder-only.ts`
- `scripts/setup-dev-user.ts`
- `scripts/apply-event-categorization.ts`
- `scripts/insert-golden-barrels-hours.ts`
- `scripts/rectify-golden-barrels.ts`
- `scripts/reprocess-cvs.ts`
- `scripts/trigger-invoice-reminders.ts`
- `scripts/hiring/cleanup-stuck-cvs.ts`
- `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts`
- `tests/scripts/testHiringCleanupStuckCvsSafety.test.ts`
- `scripts/database/check-failed-jobs.ts`
- `scripts/database/check-job-tables.ts`
- `scripts/database/check-jobs.ts`
- `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts`
- `scripts/cleanup/delete-old-sms-messages.ts`
- `scripts/cleanup/delete-all-pending-sms.ts`
- `scripts/cleanup/delete-pending-sms.ts`
- `scripts/cleanup/delete-all-queued-messages.ts`
- `scripts/cleanup/delete-specific-customers.ts`
- `scripts/fixes/fix-duplicate-loyalty-program.ts`
- `tests/scripts/testSmsCleanupScriptsSafety.test.ts`
- `scripts/database/check-deployment-status.ts`
- `tests/scripts/testNoHardcodedApiKeysInScripts.test.ts`
- `src/lib/fix-superadmin-permissions-script-safety.ts`
- `tests/lib/fixSuperadminPermissionsScriptSafety.test.ts`
- `tests/scripts/testScriptMutationGating.test.ts`
- `FULL_APPLICATION_REVIEW_BLUEPRINT.md`
- `AGENT_HANDOFF_2026-02-14.md`

## Latest Batch Validation Evidence
Validation evidence (latest Dev 3 batch, finding 500 follow-up - deployment-status strict confirm cap parsing):
- `./node_modules/.bin/eslint /Users/peterpitcher/Cursor/anchor-management-tools/scripts/database/check-deployment-status.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testNoHardcodedApiKeysInScripts.test.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testScriptMutationGating.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testNoHardcodedApiKeysInScripts.test.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testScriptMutationGating.test.ts --reporter=dot` passed (`2 files, 18 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`224 files, 1004 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 3 batch, finding 500 follow-up - cleanup/fixes strict cap parser hardening):
- `./node_modules/.bin/eslint /Users/peterpitcher/Cursor/anchor-management-tools/scripts/cleanup/delete-pending-sms.ts /Users/peterpitcher/Cursor/anchor-management-tools/scripts/cleanup/delete-all-queued-messages.ts /Users/peterpitcher/Cursor/anchor-management-tools/scripts/cleanup/delete-specific-customers.ts /Users/peterpitcher/Cursor/anchor-management-tools/scripts/fixes/fix-duplicate-loyalty-program.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testSmsCleanupScriptsSafety.test.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testScriptMutationGating.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testSmsCleanupScriptsSafety.test.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testScriptMutationGating.test.ts --reporter=dot` passed (`2 files, 24 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`224 files, 1004 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 4 batch, finding 535 follow-up - read-only diagnostics strict bounded parsing):
- `./node_modules/.bin/eslint scripts/testing/test-production-templates.ts scripts/testing/test-template-loading.ts scripts/testing/test-demographics.ts scripts/testing/test-slot-generation.ts scripts/testing/test-audit-log.ts scripts/testing/test-audit-log-rls.ts scripts/testing/test-calendar-sync.ts tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testDemographicsScriptReadOnly.test.ts tests/scripts/testAuditLogScriptsReadOnly.test.ts tests/scripts/testCalendarSyncScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testDemographicsScriptReadOnly.test.ts tests/scripts/testAuditLogScriptsReadOnly.test.ts tests/scripts/testCalendarSyncScriptsReadOnly.test.ts --reporter=dot` passed (`4 files, 20 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`224 files, 1001 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 3 batch, finding 500 follow-up - superadmin cap parser strictness):
- `./node_modules/.bin/eslint /Users/peterpitcher/Cursor/anchor-management-tools/src/lib/fix-superadmin-permissions-script-safety.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/lib/fixSuperadminPermissionsScriptSafety.test.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testScriptMutationGating.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run /Users/peterpitcher/Cursor/anchor-management-tools/tests/lib/fixSuperadminPermissionsScriptSafety.test.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testScriptMutationGating.test.ts --reporter=dot` passed (`2 files, 20 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`224 files, 998 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 3 batch, finding 500 follow-up - cleanup parser strictness):
- `./node_modules/.bin/eslint /Users/peterpitcher/Cursor/anchor-management-tools/scripts/cleanup/delete-old-sms-messages.ts /Users/peterpitcher/Cursor/anchor-management-tools/scripts/cleanup/delete-all-pending-sms.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testSmsCleanupScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testSmsCleanupScriptsSafety.test.ts --reporter=dot` passed (`1 file, 9 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 993 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`Could not find a production build in '.next' directory` during export step)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOTEMPTY: .../.next/export`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` failed (`ENOENT: .../.next/server/pages-manifest.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 4 batch, finding 539 follow-up - test-api-complete-fix strict cap parsing):
- `./node_modules/.bin/eslint scripts/testing/test-api-complete-fix.ts tests/scripts/testApiCompleteFixScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testApiCompleteFixScriptSafety.test.ts --reporter=dot` passed (`1 file, 1 test`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 993 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 4 batch, finding 539 follow-up):
- `./node_modules/.bin/eslint scripts/testing/test-booking-api.ts tests/scripts/testBookingApiScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testBookingApiScriptSafety.test.ts --reporter=dot` passed (`1 file, 1 test`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 988 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 3 batch, finding 500 follow-up):
- `./node_modules/.bin/eslint /Users/peterpitcher/Cursor/anchor-management-tools/src/lib/process-jobs-script-safety.ts /Users/peterpitcher/Cursor/anchor-management-tools/src/lib/job-retry-script-safety.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/lib/processJobsScriptSafety.test.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/lib/jobRetryScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run /Users/peterpitcher/Cursor/anchor-management-tools/tests/lib/processJobsScriptSafety.test.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/lib/jobRetryScriptSafety.test.ts --reporter=dot` passed (`2 files, 16 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 988 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 4 batch, finding 538 follow-up):
- `./node_modules/.bin/eslint src/lib/test-table-booking-sms-safety.ts src/lib/test-enrollment-with-sms-safety.ts tests/lib/testTableBookingSmsSafety.test.ts tests/lib/testEnrollmentWithSmsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/testTableBookingSmsSafety.test.ts tests/lib/testEnrollmentWithSmsSafety.test.ts --reporter=dot` passed (`2 files, 14 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 988 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 1 batch, finding 420 follow-up):
- `./node_modules/.bin/eslint src/app/api/webhooks/twilio/route.ts tests/api/twilioWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/twilioWebhookMutationGuards.test.ts --reporter=dot` passed (`1 file, 8 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 986 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 1 batch, finding 420 follow-up 2):
- `./node_modules/.bin/eslint src/app/api/parking/bookings/route.ts tests/api/idempotencyPersistFailClosedAdditionalRoutes.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/idempotencyPersistFailClosedAdditionalRoutes.test.ts --reporter=dot` passed (`1 file, 5 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 993 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .../.next/export-detail.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .../.next/server/app/_not-found/page.js.nft.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 1 batch, finding 420 follow-up 3):
- `./node_modules/.bin/eslint src/app/api/event-bookings/route.ts src/app/api/event-waitlist/route.ts src/app/api/foh/event-bookings/route.ts tests/api/eventBookingsRouteSmsMeta.test.ts tests/api/eventWaitlistRouteSmsMeta.test.ts tests/api/fohEventBookingsSmsMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/eventBookingsRouteSmsMeta.test.ts tests/api/eventWaitlistRouteSmsMeta.test.ts tests/api/fohEventBookingsSmsMeta.test.ts --reporter=dot` passed (`3 files, 14 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`224 files, 1001 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-failed-jobs.ts scripts/database/check-job-tables.ts scripts/database/check-jobs.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts --reporter=dot` passed (`1 file, 8 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` failed (`1 failed | 985 passed (986)`; failing test: `tests/api/twilioWebhookMutationGuards.test.ts > fails closed when post-status customer delivery-outcome updates cannot be applied`)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 986 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/clear-cashing-up-data.ts scripts/verify-hiring-flow.ts scripts/seed-cashing-up.ts scripts/seed-cashup-targets.ts scripts/clear-2025-data.ts scripts/fix-bookings-is-reminder-only.ts scripts/setup-dev-user.ts scripts/apply-event-categorization.ts scripts/insert-golden-barrels-hours.ts scripts/rectify-golden-barrels.ts scripts/reprocess-cvs.ts scripts/trigger-invoice-reminders.ts scripts/hiring/cleanup-stuck-cvs.ts tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts tests/scripts/testHiringCleanupStuckCvsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts tests/scripts/testHiringCleanupStuckCvsSafety.test.ts --reporter=dot` passed (`2 files, 17 tests`)
- `./node_modules/.bin/tsc --noEmit` failed (`src/lib/events/event-payments.ts:479/499/520 Type 'null' is not assignable to type 'string | undefined'`)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 976 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .../.next/server/pages-manifest.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .../.next/server/pages-manifest.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` failed (`ENOTEMPTY: .../.next/export`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-paypal-credentials.ts scripts/testing/test-microsoft-graph-email.ts tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 17 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (222 files, 969 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/oj-projects/fix-typo.ts scripts/oj-projects/fix-entry-rates.ts scripts/oj-projects/move-all-to-retainers.ts scripts/oj-projects/move-to-website-content.ts scripts/oj-projects/update-barons-retainer.ts scripts/oj-projects/update-barons-retainer-hours.ts scripts/oj-projects/add-barons-pubs-entries.ts tests/scripts/testOjProjectsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testOjProjectsScriptsSafety.test.ts --reporter=dot` passed (1 file, 9 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 963 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`Cannot find module '.next/server/next-font-manifest.json'`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/menu/seed-chefs-essentials-chips.js scripts/menu/seed-chefs-larder-slow-cooked-lamb-shanks.js scripts/menu/seed-chefs-larder-garden-peas.js scripts/menu/seed-chefs-larder-buttery-mash.js scripts/menu/seed-chefs-larder-sweet-potato-fries.js scripts/menu/seed-menu-dishes.js scripts/menu/seed-menu-dishes.ts tests/scripts/testMenuSeedScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testMenuSeedScriptsSafety.test.ts --reporter=dot` passed (1 file, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 961 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-booking-now.ts scripts/testing/test-sunday-lunch-api.ts scripts/testing/test-sunday-lunch-payment-fix.ts scripts/testing/test-api-booking-fix.ts tests/scripts/testTableBookingApiScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testTableBookingApiScriptsSafety.test.ts --reporter=dot` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (220 files, 957 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-api-complete-fix.ts tests/scripts/testApiCompleteFixScriptSafety.test.ts tests/scripts/testNoHardcodedApiKeysInScripts.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testApiCompleteFixScriptSafety.test.ts tests/scripts/testNoHardcodedApiKeysInScripts.test.ts --reporter=dot` passed (2 files, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (220 files, 955 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/setup-dev-user.ts tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts --reporter=dot` passed (1 file, 14 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 953 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-sms-new-customer.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts tests/lib/testSmsNewCustomerSafety.test.ts --reporter=dot` passed (2 files, 9 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 951 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-booking-api.ts scripts/testing/test-sms-new-customer.ts src/lib/test-sms-new-customer-safety.ts tests/scripts/testBookingApiScriptSafety.test.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts tests/lib/testSmsNewCustomerSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testBookingApiScriptSafety.test.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts tests/lib/testSmsNewCustomerSafety.test.ts --reporter=dot` passed (3 files, 10 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 950 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOTEMPTY: .next`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && ./node_modules/.bin/next build` failed (`ENOENT: .next/static/.../_ssgManifest.js`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-table-booking-sms.ts scripts/testing/test-enrollment-with-sms.ts src/lib/test-table-booking-sms-safety.ts src/lib/test-enrollment-with-sms-safety.ts tests/lib/testTableBookingSmsSafety.test.ts tests/lib/testEnrollmentWithSmsSafety.test.ts tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/testTableBookingSmsSafety.test.ts tests/lib/testEnrollmentWithSmsSafety.test.ts tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts --reporter=dot` passed (3 files, 16 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 941 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/hiring/cleanup-stuck-cvs.ts scripts/menu/seed-chefs-essentials-chips.js scripts/menu/seed-chefs-larder-slow-cooked-lamb-shanks.js scripts/menu/seed-chefs-larder-garden-peas.js scripts/menu/seed-chefs-larder-buttery-mash.js scripts/menu/seed-chefs-larder-sweet-potato-fries.js scripts/menu/seed-menu-dishes.js scripts/menu/seed-menu-dishes.ts scripts/oj-projects/fix-typo.ts scripts/oj-projects/move-to-website-content.ts scripts/oj-projects/update-barons-retainer-hours.ts scripts/oj-projects/fix-entry-rates.ts scripts/oj-projects/add-barons-pubs-entries.ts scripts/oj-projects/update-barons-retainer.ts scripts/oj-projects/move-all-to-retainers.ts scripts/oj-projects/verify-closing-logic.ts scripts/testing/test-slot-generation.ts scripts/testing/test-analytics-function.ts scripts/testing/test-short-link.ts scripts/testing/test-vip-club-redirect.ts scripts/testing/test-paypal-credentials.ts scripts/testing/test-critical-flows.ts tests/scripts/testMenuSeedScriptsSafety.test.ts tests/scripts/testOjProjectsScriptsSafety.test.ts tests/scripts/testHiringCleanupStuckCvsSafety.test.ts tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testMenuSeedScriptsSafety.test.ts tests/scripts/testOjProjectsScriptsSafety.test.ts tests/scripts/testHiringCleanupStuckCvsSafety.test.ts tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts --reporter=dot` passed (4 files, 21 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (198 files, 771 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/events/event-payments.ts tests/lib/eventBookingSeatUpdateSmsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/eventBookingSeatUpdateSmsSafety.test.ts --reporter=dot` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (184 files, 715 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/services/sms-queue.ts src/services/private-bookings.ts tests/services/smsQueue.service.test.ts tests/services/testPrivateBookingServiceFailClosedCatchHandlers.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/smsQueue.service.test.ts tests/services/testPrivateBookingServiceFailClosedCatchHandlers.test.ts --reporter=dot` passed (2 files, 11 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (184 files, 715 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint tests/scripts/testScriptsFailClosedCatchHandlers.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testScriptsFailClosedCatchHandlers.test.ts --reporter=dot` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (183 files, 712 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/services/private-bookings.ts src/lib/events/staff-seat-updates.ts tests/services/privateBookingsSmsSideEffects.test.ts tests/lib/staffSeatUpdatesMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/privateBookingsSmsSideEffects.test.ts tests/lib/staffSeatUpdatesMutationGuards.test.ts --reporter=dot` passed (2 files, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (189 files, 729 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-event-categories-migration.ts scripts/database/check-migration-simple.ts scripts/backfill/parking-sms.ts scripts/fixes/fix-rpc-functions.ts scripts/fixes/fix-rpc-functions-direct.ts src/lib/parking-sms-backfill-safety.ts src/lib/parking-sms-backfill-script-safety.ts tests/scripts/testDatabaseEventCategoriesMigrationScriptsReadOnly.test.ts tests/lib/parkingSmsBackfillSafety.test.ts tests/lib/parkingSmsBackfillScriptSafety.test.ts tests/scripts/testFixRpcFunctionsScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseEventCategoriesMigrationScriptsReadOnly.test.ts tests/lib/parkingSmsBackfillSafety.test.ts tests/lib/parkingSmsBackfillScriptSafety.test.ts tests/scripts/testFixRpcFunctionsScriptsReadOnly.test.ts --reporter=dot` passed (4 files, 16 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (189 files, 729 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/services/sms-queue.ts tests/services/smsQueue.service.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/smsQueue.service.test.ts --reporter=dot` passed (1 file, 12 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (191 files, 738 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/stripe/webhook/route.ts src/app/api/webhooks/paypal/parking/route.ts tests/api/stripeWebhookMutationGuards.test.ts tests/api/paypalParkingWebhookFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/stripeWebhookMutationGuards.test.ts tests/api/paypalParkingWebhookFailClosed.test.ts --reporter=dot` passed (2 files, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (191 files, 738 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/actions/privateBookingActions.ts tests/actions/privateBookingActionsSmsMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/privateBookingActionsSmsMeta.test.ts --reporter=dot` passed (1 file, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (199 files, 774 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/seed-cashing-up.ts scripts/seed-cashup-targets.ts scripts/clear-2025-data.ts scripts/fix-bookings-is-reminder-only.ts scripts/setup-dev-user.ts tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts --reporter=dot` passed (1 file, 8 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (208 files, 832 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/events/waitlist-offers.ts tests/lib/waitlistOffersSmsPersistence.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/waitlistOffersSmsPersistence.test.ts --reporter=dot` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (216 files, 886 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/stripe/webhook/route.ts src/lib/table-bookings/bookings.ts tests/api/stripeWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/stripeWebhookMutationGuards.test.ts --reporter=dot` passed (1 file, 12 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 953 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/actions/events.ts tests/actions/eventsManualBookingGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/eventsManualBookingGuards.test.ts --reporter=dot` passed (1 file, 11 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 954 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/stripe/webhook/route.ts tests/api/stripeWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/stripeWebhookMutationGuards.test.ts --reporter=dot` passed (1 file, 14 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (222 files, 969 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/actions/events.ts tests/actions/eventsManualBookingGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/eventsManualBookingGuards.test.ts --reporter=dot` passed (1 file, 13 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (222 files, 972 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/stripe/webhook/route.ts tests/api/stripeWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/stripeWebhookMutationGuards.test.ts --reporter=dot` passed (1 file, 15 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (222 files, 978 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

## Immediate Next Work
1. Continue fail-closed sweep on remaining send/dedupe paths in actions/services/webhooks.
2. Continue sweeping `scripts/` (264 files) for unsafe mutation/fail-open assumptions, prioritizing remaining send/remediation scripts.
3. Replace remaining swallowed DB errors in count/dedupe checks near write/send paths.
4. Add targeted regression tests for each fix.
5. Keep the blueprint updated after each batch (new IDs starting at `381`).

## Required Process
- Do not revert unrelated existing changes.
- Prefer `rg` for search.
- Use local binaries for validation commands:
  - `./node_modules/.bin/eslint ...`
  - `./node_modules/.bin/tsc --noEmit`
  - `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run ...`
  - `./node_modules/.bin/next build`
- After each substantial batch:
  - run targeted lint/tests,
  - run `tsc --noEmit`,
  - run full vitest,
  - run next build,
  - append evidence to blueprint.

## Handover Addendum (2026-02-15)

Status:
- Findings are complete through `420`. Next finding ID cursor: `range exhausted (381-420 complete)`.
- Baseline remains the validated set above.
- Post-`420` re-triage of owned non-cron send/write routes (`src/app/actions` SMS/message queue surfaces + `src/app/api` non-cron/webhook surfaces in scope) identified three additional gaps and fixed all under `420` follow-ups: Twilio status webhook customer delivery-outcome fail-open behavior (`src/app/api/webhooks/twilio/route.ts`, regression in `tests/api/twilioWebhookMutationGuards.test.ts`), parking booking create SMS safety-meta surfacing (`src/app/api/parking/bookings/route.ts`, regression in `tests/api/idempotencyPersistFailClosedAdditionalRoutes.test.ts`), and event booking/waitlist route-level rejected SMS-task meta surfacing (`src/app/api/event-bookings/route.ts`, `src/app/api/event-waitlist/route.ts`, `src/app/api/foh/event-bookings/route.ts`, regressions in `tests/api/eventBookingsRouteSmsMeta.test.ts`, `tests/api/eventWaitlistRouteSmsMeta.test.ts`, `tests/api/fohEventBookingsSmsMeta.test.ts`); no further P0/P1 gaps were identified without opening a new finding-ID range.

Time estimate (remaining P0/P1 work):
- `4-8` engineering days for the remaining fail-closed sweep + script safety triage, including regression tests, validation batches, and doc updates.

Outstanding high-priority work (P0/P1 focus):
1. Continue fail-closed sweep for remaining send/dedupe paths outside cron (actions/services/webhooks).
2. Continue sweeping `scripts/` (264 tracked files) for unsafe mutation/fail-open behavior, prioritizing remaining send/remediation scripts.
3. Replace remaining swallowed DB errors in count/dedupe checks near write/send paths.
4. Add strict row-effect checks for state transitions (update/delete must prove 1+ rows changed).
5. Add race-condition guards for check-then-insert/update patterns (prefer single-statement conditional updates, idempotency locks, or unique-key upserts with reconciliation).

Fast triage numbers (current repo state):
- `scripts/` tracked file count: `264`.
- Scripts mentioning SMS/Twilio/queue keywords: `32`.
- Scripts containing mutation-ish calls (`insert/update/delete/upsert/rpc`): `96` (note: `rpc` may be read-only; still review).
- `src/` files mentioning send/dedupe/idempotency/Twilio-ish terms (actions/api/services/lib): `37`.

Repro commands (avoid `cat/head/ls` in this shell; prefer `rg` and `node -e`):
```sh
# scripts file count (tracked)
rg --files scripts | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log(d.trim().split(/\\n/).filter(Boolean).length));'

# scripts likely touching SMS
rg -l "\\b(sendSms|sendSMS|twilio|messageSid|send_sms|sms-queue|SmsQueue)\\b" scripts

# scripts with mutation-ish calls (rpc may be read-only, still review)
rg -l "\\.(insert|update|delete|upsert|rpc)\\(" scripts

# src send/dedupe/idempotency surface (actions/api/services/lib)
rg -l "\\b(sendSms|sendSMS|SmsQueue|sms-queue|idempot|dedupe|twilio)\\b" src/app/actions src/app/api src/services src/lib
```

Prompt to forward to next developer:
```text
You are taking over a production-hardening reliability/safety review after a severe SMS spam incident.

Repo: /Users/peterpitcher/Cursor/anchor-management-tools

Read these first (fully):
1) /Users/peterpitcher/Cursor/anchor-management-tools/AGENT_HANDOFF_2026-02-14.md
2) /Users/peterpitcher/Cursor/anchor-management-tools/FULL_APPLICATION_REVIEW_BLUEPRINT.md

Hard rules:
- Repo is intentionally dirty: do NOT revert unrelated changes.
- Prefer rg for discovery. In this shell, common utilities like cat/sed/ls/head may be missing; use rg and node -e to read/print files.
- npm scripts are unreliable; validate using local binaries only:
  - ./node_modules/.bin/eslint ...
  - ./node_modules/.bin/tsc --noEmit
  - VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run ...
  - node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build
- After each substantial batch: targeted eslint/vitest -> tsc -> full vitest -> next build.
- Every fix must include regression tests.
- After each batch, update BOTH docs above with:
  - new finding IDs (continue within your reserved finding-ID range; see the reserved ranges section in these docs)
  - severity + summary
  - regression coverage entries
  - exact validation evidence commands/results (with updated test/file counts)

Current validated baseline:
- ./node_modules/.bin/tsc --noEmit passed
- VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot passed (219 files, 954 tests)
- node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build passed (warnings: Browserslist age, webpack cache big strings)

Outstanding P0/P1 work:
1) Fail-closed sweep for remaining send/dedupe paths outside cron (actions/services/webhooks). Replace swallowed DB errors near send/write paths, add strict row-effect checks, and guard check-then-insert/update races.
2) Continue scripts/ audit for unsafe mutation/fail-open behavior. Any script that can send SMS or mutate DB must default to read-only/dry-run, require multi-gating + explicit caps for mutation/send, and must never exit 0 if safety checks or expected row counts fail.

Useful triage commands:
- rg -l "\\b(sendSms|sendSMS|twilio|messageSid|send_sms|sms-queue|SmsQueue)\\b" scripts
- rg -l "\\.(insert|update|delete|upsert|rpc)\\(" scripts
- rg -l "\\b(sendSms|sendSMS|SmsQueue|sms-queue|idempot|dedupe|twilio)\\b" src/app/actions src/app/api src/services src/lib
```

## 4-Developer Parallel Handoff (2026-02-15)

Goal: split remaining P0/P1 work across 4 devs, minimize merge conflicts, and avoid finding-ID collisions.

Reserved finding ID ranges (do not use IDs outside your range):
- Dev 1 (actions + API routes + webhooks): `381-420`
- Dev 2 (services + libs): `421-460`
- Dev 3 (scripts: database + cleanup + sms-tools + fixes): `461-500`
- Dev 4 (scripts: menu + oj-projects + testing + root mutation scripts): `501-540`

Shared rules (all devs):
- Every fix must include regression tests.
- After each substantial batch: targeted eslint/vitest -> `tsc --noEmit` -> full vitest -> `next build`.
- After each batch, update BOTH `/Users/peterpitcher/Cursor/anchor-management-tools/AGENT_HANDOFF_2026-02-14.md` and `/Users/peterpitcher/Cursor/anchor-management-tools/FULL_APPLICATION_REVIEW_BLUEPRINT.md` with: new finding IDs (within your reserved range), severity + summary, regression coverage entries, and exact validation evidence (include test/file counts).

### Prompt (Dev 1): Actions + API Routes + Webhooks (Non-cron)
```text
You are Developer 1 of 4 taking over a production-hardening reliability/safety review after a severe SMS spam incident.

Repo: /Users/peterpitcher/Cursor/anchor-management-tools

Read these first (fully):
1) /Users/peterpitcher/Cursor/anchor-management-tools/AGENT_HANDOFF_2026-02-14.md
2) /Users/peterpitcher/Cursor/anchor-management-tools/FULL_APPLICATION_REVIEW_BLUEPRINT.md

Hard rules:
- Repo is intentionally dirty: do NOT revert unrelated changes.
- Prefer rg for discovery. In this shell, common utilities like cat/sed/ls/head may be missing; use rg and node -e to read/print files.
- npm scripts are unreliable; validate using local binaries only:
  - ./node_modules/.bin/eslint ...
  - ./node_modules/.bin/tsc --noEmit
  - VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run ...
  - node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build
- After each substantial batch: targeted eslint/vitest -> tsc -> full vitest -> next build.
- Every fix must include regression tests.

Finding IDs:
- You MUST use only finding IDs 381-420 (inclusive). Do not use IDs outside this range.

Scope (own these areas):
- Next.js route handlers in src/app/api/** excluding cron (plus the Stripe/PayPal webhooks).
- Server actions in src/app/actions/** that send/enqueue SMS or touch messages/sms queue.
- Tests you add/update should live primarily in tests/api/** and tests/actions/**.

P0/P1 goals:
1) Fail-closed sweep for remaining send/dedupe paths outside cron. Replace swallowed DB errors near send/write paths, add strict row-effect checks, and guard check-then-insert/update races.
2) Remove/replace any .catch(console.error) and other fail-open patterns on send/write paths in your scope.

Start here (triage):
- rg -l "\\b(sendSms|sendSMS|SmsQueue|sms-queue|idempot|dedupe|twilio)\\b" src/app/actions src/app/api --glob '!src/app/api/cron/**'
- ALSO audit (even if keyword search misses it):
  - src/app/api/stripe/webhook/route.ts
  - src/app/api/webhooks/paypal/parking/route.ts
  - src/app/api/public/private-booking/route.ts
  - src/app/api/external/create-booking/route.ts
- Look for: Promise.all/Promise.allSettled ignoring results, swallowed Supabase errors, update/delete without checking affected rows, and check-then-insert races around dedupe/history tables.

Regression requirements:
- Add a focused vitest regression for each fix (route-level behavior, abort semantics, meta surface, or row-effect checks).
- Do not introduce retry-driven duplicate-send loops: prefer returning HTTP 200 with explicit abort metadata when a fatal safety signal happens after any transport send, but still persist a failed run/attempt when applicable.

After each batch:
- Update BOTH docs with your findings (381-420 only), regression coverage, and exact validation evidence commands/results (with updated test counts).
```

### Prompt (Dev 2): Services + Libs (Send/Dedupe/Idempotency/Row-Effect)
```text
You are Developer 2 of 4 taking over a production-hardening reliability/safety review after a severe SMS spam incident.

Repo: /Users/peterpitcher/Cursor/anchor-management-tools

Read these first (fully):
1) /Users/peterpitcher/Cursor/anchor-management-tools/AGENT_HANDOFF_2026-02-14.md
2) /Users/peterpitcher/Cursor/anchor-management-tools/FULL_APPLICATION_REVIEW_BLUEPRINT.md

Hard rules:
- Repo is intentionally dirty: do NOT revert unrelated changes.
- Prefer rg for discovery. In this shell, common utilities like cat/sed/ls/head may be missing; use rg and node -e to read/print files.
- npm scripts are unreliable; validate using local binaries only:
  - ./node_modules/.bin/eslint ...
  - ./node_modules/.bin/tsc --noEmit
  - VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run ...
  - node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build
- After each substantial batch: targeted eslint/vitest -> tsc -> full vitest -> next build.
- Every fix must include regression tests.

Finding IDs:
- You MUST use only finding IDs 421-460 (inclusive). Do not use IDs outside this range.

Scope (own these areas):
- Service + library layers: src/services/** and src/lib/**.
- Tests you add/update should live primarily in tests/services/** and tests/lib/**.

P0/P1 goals:
1) Fail-closed sweep for remaining send/dedupe/idempotency paths outside cron: no swallowed DB errors near send/write paths, strict row-effect checks, and guard check-then-insert/update races.
2) Ensure send helpers consistently propagate safety meta (code/logFailure) and that loops/batches abort on fatal safety signals (logging_failed, safety_unavailable, idempotency_conflict) where continuing could fan out spam.

Start here (triage):
- rg -l "\\b(sendSms|sendSMS|SmsQueue|sms-queue|idempot|dedupe|twilio)\\b" src/services src/lib
- rg -n "\\.catch\\(console\\.error\\)" src/services src/lib
- Review especially:
  - src/lib/twilio.ts (sendSMS pipeline)
  - src/services/sms-queue.ts (enqueue/dedupe/locks)
  - src/lib/unified-job-queue.ts + src/lib/background-jobs.ts (job concurrency + abort semantics)
  - src/services/messages.ts (reply/send paths)
  - src/lib/sms/** and src/lib/events/** send helpers that return { success, code, logFailure }
- Look for: check-then-insert patterns without idempotency locks, update/delete calls that ignore affected row count, and error handling that logs but continues.

Regression requirements:
- Add a focused vitest regression for each fix (race guard behavior, row-effect failures, fatal safety-signal abort).
- Prefer tests that prove we fail closed on DB errors adjacent to send/write paths.

After each batch:
- Update BOTH docs with your findings (421-460 only), regression coverage, and exact validation evidence commands/results (with updated test counts).
```

### Prompt (Dev 3): Scripts (database + cleanup + sms-tools + fixes)
```text
You are Developer 3 of 4 taking over a production-hardening reliability/safety review after a severe SMS spam incident.

Repo: /Users/peterpitcher/Cursor/anchor-management-tools

Read these first (fully):
1) /Users/peterpitcher/Cursor/anchor-management-tools/AGENT_HANDOFF_2026-02-14.md
2) /Users/peterpitcher/Cursor/anchor-management-tools/FULL_APPLICATION_REVIEW_BLUEPRINT.md

Hard rules:
- Repo is intentionally dirty: do NOT revert unrelated changes.
- Prefer rg for discovery. In this shell, common utilities like cat/sed/ls/head may be missing; use rg and node -e to read/print files.
- npm scripts are unreliable; validate using local binaries only:
  - ./node_modules/.bin/eslint ...
  - ./node_modules/.bin/tsc --noEmit
  - VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run ...
  - node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build
- After each substantial batch: targeted eslint/vitest -> tsc -> full vitest -> next build.
- Every fix must include regression tests.

Finding IDs:
- You MUST use only finding IDs 461-500 (inclusive). Do not use IDs outside this range.

Scope (own these areas):
- scripts/database/**
- scripts/cleanup/**
- scripts/sms-tools/**
- scripts/fixes/** (all; coordinate with Dev 4 if you touch non-SMS-related ones)
- plus any root-level scripts that send SMS / mutate messages/jobs.
- Tests you add/update should live primarily in tests/scripts/** and tests/lib/** (existing script-safety harnesses).

P0/P1 goals (scripts):
1) Any script that can send SMS or mutate DB must default to read-only/dry-run.
2) Any mutation/send requires multi-gating + explicit caps/limits (with hard caps).
3) Scripts must fail closed: never exit 0 if safety checks, env validation, DB reads/writes, or expected row counts fail.
4) No .catch(console.error) (or log-and-continue) in scripts.

Start here (triage):
- rg -l "\\b(sendSms|sendSMS|twilio|messageSid|send_sms|sms-queue|SmsQueue)\\b" scripts
- rg -l "\\.(insert|update|delete|upsert|rpc)\\(" scripts/database scripts/cleanup scripts/sms-tools scripts/fixes
- rg -n "\\.catch\\(console\\.error\\)" scripts/database scripts/cleanup scripts/sms-tools scripts/fixes

Regression requirements:
- Every script you change must be covered by a vitest regression (read-only default, gating required, caps enforced, fails non-zero on safety failures).
- Prefer to extend existing script safety tests rather than inventing a new framework.

After each batch:
- Update BOTH docs with your findings (461-500 only), regression coverage, and exact validation evidence commands/results (with updated test counts).
```

### Prompt (Dev 4): Scripts (menu + oj-projects + testing + root mutation scripts)
```text
You are Developer 4 of 4 taking over a production-hardening reliability/safety review after a severe SMS spam incident.

Repo: /Users/peterpitcher/Cursor/anchor-management-tools

Read these first (fully):
1) /Users/peterpitcher/Cursor/anchor-management-tools/AGENT_HANDOFF_2026-02-14.md
2) /Users/peterpitcher/Cursor/anchor-management-tools/FULL_APPLICATION_REVIEW_BLUEPRINT.md

Hard rules:
- Repo is intentionally dirty: do NOT revert unrelated changes.
- Prefer rg for discovery. In this shell, common utilities like cat/sed/ls/head may be missing; use rg and node -e to read/print files.
- npm scripts are unreliable; validate using local binaries only:
  - ./node_modules/.bin/eslint ...
  - ./node_modules/.bin/tsc --noEmit
  - VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run ...
  - node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build
- After each substantial batch: targeted eslint/vitest -> tsc -> full vitest -> next build.
- Every fix must include regression tests.

Finding IDs:
- You MUST use only finding IDs 501-540 (inclusive). Do not use IDs outside this range.

Scope (own these areas):
- scripts/menu/**
- scripts/oj-projects/**
- scripts/testing/**
- root-level scripts that mutate DB (coordinate with Dev 3 if it is SMS/messages/jobs-related)
- scripts/hiring/** and other remaining mutation scripts not covered by Dev 3.

P0/P1 goals (scripts):
1) Any script that can mutate DB must be safe by default: read-only/dry-run unless explicitly enabled.
2) Any mutation requires multi-gating + explicit caps/limits (with hard caps).
3) Scripts must fail closed: never exit 0 if env validation, DB reads/writes, or expected row counts fail.
4) Remove remaining fail-open patterns (.catch(console.error), process.exit(0) on error, or silent partial-failure continues).

Start here (triage):
- rg -l "\\.(insert|update|delete|upsert|rpc)\\(" scripts/menu scripts/oj-projects scripts/testing
- rg -n "\\.catch\\(console\\.error\\)" scripts/menu scripts/oj-projects scripts/testing

Regression requirements:
- Every script you change must be covered by a vitest regression (read-only default, gating required, caps enforced, fails non-zero on safety failures).
- For one-off fix scripts, add tests that assert the safety wrapper is used and that dangerous defaults are blocked.

After each batch:
- Update BOTH docs with your findings (501-540 only), regression coverage, and exact validation evidence commands/results (with updated test counts).
```
