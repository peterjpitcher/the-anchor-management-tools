---
phase: 02-screen-migrations
plan: 05
subsystem: ui
tags: [auth-layout, public-layout, portal-layout, kiosk-layout, onboard-layout, standalone-screens, css-layout]

requires:
  - phase: 02-01
    provides: "Layout CSS classes (.auth, .public, .portal, .kiosk, .onboard) and ds/ component library"
provides:
  - "10 migrated standalone-layout screens using ds/ components and layout CSS"
  - "Login with auth card, 2FA, Microsoft SSO placeholder"
  - "Onboarding 6-step wizard with Stepper rail"
  - "Timeclock kiosk with dark full-screen layout and staff grid"
  - "Public booking 3-step wizard with party chips and time slots"
  - "Public parking with booking details and pricing"
  - "Booking confirmation with QR ticket stub"
  - "Privacy policy with prose layout"
  - "Error page with reference code card"
  - "Unauthorized page with attempted path display"
affects: [phase-03, phase-04]

tech-stack:
  added: []
  patterns:
    - "Standalone layout CSS classes for non-authenticated screens"
    - "_components/ subdirectory pattern for migrated client components"

key-files:
  created:
    - "src/app/auth/login/_components/LoginClient.tsx"
    - "src/app/error/_components/ErrorClient.tsx"
    - "src/app/unauthorized/page.tsx"
    - "src/app/(employee-onboarding)/onboarding/[token]/_components/OnboardingClient.tsx"
    - "src/app/(staff-portal)/portal/_components/PortalClient.tsx"
    - "src/app/(staff-portal)/portal/page.tsx"
    - "src/app/(timeclock)/timeclock/_components/TimeclockClient.tsx"
    - "src/app/table-booking/_components/PublicBookingClient.tsx"
    - "src/app/parking/guest/[id]/_components/PublicParkingClient.tsx"
    - "src/app/booking-confirmation/[token]/_components/BookingConfirmationClient.tsx"
  modified:
    - "src/app/auth/login/page.tsx"
    - "src/app/error/page.tsx"
    - "src/app/(employee-onboarding)/onboarding/[token]/page.tsx"
    - "src/app/(timeclock)/timeclock/page.tsx"
    - "src/app/parking/guest/[id]/page.tsx"
    - "src/app/privacy/page.tsx"

key-decisions:
  - "Toast and formatCurrency utility imports from ui-v2 kept as acceptable migration exception per prior decision"
  - "Staff portal root page redirects to /portal/shifts (existing primary view) rather than duplicate landing page"
  - "Old page-client.tsx preserved as dead code -- will be cleaned in Phase 4"

patterns-established:
  - "_components/ subdirectory for migrated standalone-layout client components"
  - ".auth layout for centered card screens (login, error, unauthorized, onboarding edge cases)"
  - ".public layout for customer-facing pages (booking, parking, confirmation, privacy)"
  - ".kiosk layout for full-screen dark timeclock interface"
  - ".onboard layout for wizard-style onboarding with rail sidebar"
  - ".portal layout for staff-only views with topbar navigation"

requirements-completed: [MIG-19, MIG-20, MIG-21, MIG-22, MIG-23, MIG-24, MIG-25, MIG-26, MIG-27, MIG-28]

duration: 9min
completed: 2026-05-18
---

# Phase 02 Plan 05: Auth, Public & Standalone Layout Screens Summary

**10 standalone-layout screens migrated to ds/ components with .auth/.public/.portal/.kiosk/.onboard CSS classes -- Login with 2FA/SSO, Onboarding wizard with Stepper, Timeclock kiosk with staff grid, Public Booking 3-step flow, and 6 more**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-18T18:11:09Z
- **Completed:** 2026-05-18T18:20:51Z
- **Tasks:** 3
- **Files modified:** 16

## Accomplishments
- Login page migrated with auth card, 2FA flow, Microsoft SSO button using .auth layout
- Onboarding wizard migrated with 6-step flow, ds/ Stepper rail, .onboard layout
- Timeclock kiosk migrated with dark full-screen, staff grid with Avatar cards, live clock, .kiosk layout
- Public booking, parking, confirmation, and privacy pages all migrated to .public layout
- Error and Unauthorized pages migrated with centered cards, icons, reference codes using .auth layout
- All 10 screens use standalone CSS layout classes and ds/ component imports

## Task Commits

Each task was committed atomically:

1. **Task 1: Login, Error, Unauthorised (.auth layout)** - `78177fda` (feat)
2. **Task 2: Onboarding, Staff Portal, Timeclock** - `a735368b` (feat)
3. **Task 3: Public Booking, Parking, Confirmation, Privacy** - `16eede47` (feat)

## Files Created/Modified
- `src/app/auth/login/_components/LoginClient.tsx` - Auth card with email/password, 2FA, SSO
- `src/app/auth/login/page.tsx` - Updated to use _components/LoginClient
- `src/app/error/_components/ErrorClient.tsx` - Error card with reference code display
- `src/app/error/page.tsx` - Updated to use ErrorClient component
- `src/app/unauthorized/page.tsx` - Access denied card with attempted path
- `src/app/(employee-onboarding)/onboarding/[token]/_components/OnboardingClient.tsx` - 6-step wizard with Stepper
- `src/app/(employee-onboarding)/onboarding/[token]/page.tsx` - Updated to use _components path
- `src/app/(staff-portal)/portal/page.tsx` - Redirect to /portal/shifts
- `src/app/(staff-portal)/portal/_components/PortalClient.tsx` - Portal landing with clock-in, stats, shifts
- `src/app/(timeclock)/timeclock/_components/TimeclockClient.tsx` - Dark kiosk with staff grid
- `src/app/(timeclock)/timeclock/page.tsx` - Updated to use _components path
- `src/app/table-booking/_components/PublicBookingClient.tsx` - 3-step booking wizard
- `src/app/parking/guest/[id]/_components/PublicParkingClient.tsx` - Parking details with pricing
- `src/app/parking/guest/[id]/page.tsx` - Updated to use PublicParkingClient
- `src/app/booking-confirmation/[token]/_components/BookingConfirmationClient.tsx` - QR ticket stub
- `src/app/privacy/page.tsx` - Prose layout with .public classes

## Decisions Made
- Toast and formatCurrency utility imports from ui-v2 kept as acceptable migration exception per Phase 02 decision
- Staff portal root page redirects to /portal/shifts rather than creating duplicate landing page
- Old login page-client.tsx left in place (dead code) for Phase 4 cleanup

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Badge and CardHeader API mismatches**
- **Found during:** Task 2 (PortalClient)
- **Issue:** Badge uses `tone` not `variant`, CardHeader requires `title` prop not children
- **Fix:** Updated to use correct ds/ API: `tone=` for Badge, `title=` + `action=` for CardHeader
- **Files modified:** src/app/(staff-portal)/portal/_components/PortalClient.tsx
- **Verification:** TypeScript --noEmit passes clean
- **Committed in:** a735368b (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor API mismatch caught by type checker. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
- `src/app/table-booking/_components/PublicBookingClient.tsx` - Booking form UI template created but table-booking/page.tsx still redirects to external site. The PublicBookingClient exists ready for when this route is activated locally. Intentional -- existing production redirect preserved per D-09.
- `src/app/booking-confirmation/[token]/_components/BookingConfirmationClient.tsx` - Confirmation UI template created but booking-confirmation/[token]/page.tsx still redirects externally. Same rationale as above.

## Next Phase Readiness
- All 28 screens across Phase 02 plans 01-05 are now migrated
- Phase 03 (new sections) can proceed with Events, Performers, Cashing Up
- Phase 04 cleanup should remove old page-client.tsx and other dead code

---
*Phase: 02-screen-migrations*
*Completed: 2026-05-18*
