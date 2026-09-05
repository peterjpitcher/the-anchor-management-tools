# Changed files and retained counterparts

Application edits are in isolated codex/anchor-booking-growth worktrees. Original working copies and unrelated edits remain untouched.

## Management

- `src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx`

- `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx`

- `src/app/(authenticated)/table-bookings/foh/components/FohMiniModals.tsx`

- `src/app/api/boh/table-bookings/[id]/party-size/route.ts`

- `src/app/api/event-bookings/route.ts`

- `src/app/api/foh/bookings/[id]/christmas-courses/route.ts`

- `src/app/api/foh/bookings/[id]/party-size/route.ts`

- `src/app/api/table-bookings/periods/route.test.ts`

- `src/app/api/table-bookings/periods/route.ts`

- `src/app/api/table-bookings/route.ts`

- `src/app/g/[token]/table-manage/PreorderSection.tsx`

- `src/app/g/[token]/table-manage/__tests__/preorder-cutoff.test.ts`

- `src/components/features/table-bookings/ChristmasCourseFields.tsx`

- `src/components/features/table-bookings/preorder/SeasonalPreorderSection.tsx`

- `src/lib/event-booking-sheet-template.test.ts`

- `src/lib/events/staff-seat-updates.test.ts`

- `src/lib/events/staff-seat-updates.ts`

- `src/lib/table-bookings/booking-idempotency.test.ts`

- `src/lib/table-bookings/booking-idempotency.ts`

- `src/lib/table-bookings/bookings.ts`

- `src/lib/table-bookings/highchair-outside.test.ts`

- `src/lib/table-bookings/preorder.test.ts`

- `src/lib/table-bookings/preorder.ts`

- `src/services/__tests__/event-bookings-dining-requests.test.ts`

- `src/services/event-bookings.ts`

- `src/types/preorders.ts`

- `supabase/migrations/20260905100155_christmas_course_snapshot.sql`

- `supabase/migrations/20260905100521_event_booking_dining_requests.sql`

- `tasks/anchor-booking-growth/baseline.sql`

- `tasks/anchor-booking-growth/capacity-review.md`

- `tasks/anchor-booking-growth/changed-files.md`

- `tasks/anchor-booking-growth/christmas-course-activate.sql`

- `tasks/anchor-booking-growth/christmas-course-disable.sql`

- `tasks/anchor-booking-growth/christmas-policy-verification.md`

- `tasks/anchor-booking-growth/measurement.md`

- `tasks/anchor-booking-growth/menu-corrections.json`

- `tasks/anchor-booking-growth/promotion-brief.md`

- `tasks/anchor-booking-growth/release-approval.md`

- `tasks/anchor-booking-growth/verification.md`

- `tasks/event-dining-request-migration-2026-09-05.md`

- `tasks/plan-2026-09-05-anchor-booking-growth.md`

- `tasks/todo.md`

- `tests/api/event-bookings-dining-requests.test.ts`

- `tests/api/tableBookingRouteErrorPayloads.test.ts`

- `tests/api/tableBookingStructuredPersistence.test.ts`

- `tests/database/event-booking-dining-requests.sql`

- `tests/db/christmas-course-activation.sql`

- `tests/db/christmas-course-snapshot.sql`

## Website

- `app/api/analytics/route.test.ts`

- `app/api/analytics/route.ts`

- `app/api/enquiry/christmas/route.ts`

- `app/api/event-bookings/route.ts`

- `app/api/public/private-booking/route.ts`

- `app/api/table-bookings/route.ts`

- `app/book-table/page.tsx`

- `app/christmas-parties/client-components.tsx`

- `app/christmas-parties/page.tsx`

- `app/events/[id]/page.tsx`

- `app/sunday-roast/page.tsx`

- `components/CommunicationConsentFields.tsx`

- `components/PrivateBookingSection.tsx`

- `components/PrivateHireQuickEnquiry.tsx`

- `components/features/EventBooking/ManagementEventBookingForm.tsx`

- `components/features/TableBooking/ManagementTableBookingForm.tsx`

- `components/features/TableBooking/SeasonalPreorderPicker.tsx`

- `components/features/christmas/ChristmasLightbox.tsx`

- `components/features/christmas/__tests__/lightbox-suppression.test.ts`

- `components/layout/StickyCtas.tsx`

- `docs/SSOT.md`

- `lib/api/bookings.ts`

- `lib/api/events.ts`

- `lib/booking-cta.ts`

- `lib/table-booking-idempotency.ts`

- `lib/table-booking/__tests__/quick-book.test.ts`

- `lib/table-booking/quick-book.ts`

- `lib/table-booking/submission.ts`

- `lib/tracking/dispatcher.ts`

- `lib/tracking/url-context.ts`

- `scripts/booking-growth-smoke-server.cjs`

- `scripts/christmas-course-growth-smoke.cjs`

- `scripts/cta-growth-smoke.cjs`

- `scripts/event-request-growth-smoke.cjs`

- `scripts/full-table-growth-smoke.cjs`

- `scripts/private-hire-smoke.cjs`

- `scripts/table-growth-smoke.cjs`

- `tasks/todo.md`

- `tests/api/christmas-enquiry.test.ts`

- `tests/api/event-bookings-idempotency.test.ts`

- `tests/api/private-booking-idempotency.test.ts`

- `tests/lib/tracking-url-context.test.ts`

- `tests/ssot-drift-guard.test.ts`

- `tests/unit/ManagementEventBookingForm.test.tsx`

- `tests/unit/ManagementTableBookingForm.test.tsx`

- `tests/unit/booking-cta.test.ts`

- `tests/unit/christmas-course-policy.test.tsx`

- `tests/unit/christmas-parties-booking-journeys.test.ts`

- `tests/unit/christmas-parties-responsive.test.ts`

- `tests/unit/private-hire-quick-enquiry.test.tsx`

- `tests/unit/sticky-ctas-journeys.test.tsx`


## Deliberately unchanged

Existing allocation RPCs v06/v07, ordinary table availability API purpose rules, waitlist machinery, payment capture/refund arithmetic, event booking-sheet renderer and published operating hours remain unchanged. The new wrappers call the existing allocators. The sheet already reads notes. Existing private-hire queues are reused. Latest unrelated main-branch API fixes were incorporated without conflict.
