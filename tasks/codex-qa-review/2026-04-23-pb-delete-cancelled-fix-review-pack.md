# Review Pack: pb-delete-cancelled-fix

**Generated:** 2026-04-23
**Mode:** B (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`
**Base ref:** `HEAD`
**HEAD:** `20b15030`
**Diff range:** `HEAD`
**Stats:**  12 files changed, 78 insertions(+), 193 deletions(-)

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

```
.claude/changes-manifest.log
docs/architecture/README.md
docs/architecture/data-model.md
docs/architecture/overview.md
docs/architecture/relationships.md
docs/architecture/routes.md
docs/architecture/server-actions.md
scripts/one-off/correction-send.ts
scripts/one-off/send-music-bingo-promo-2026-04-20.ts
src/app/actions/privateBookingActions.ts
src/services/private-bookings/mutations.ts
supabase/.temp/gotrue-version
supabase/.temp/storage-version
supabase/migrations/20260623000000_allow_delete_cancelled_bookings.sql
tasks/database-schema.md
tasks/event-promo-sms-fix-spec.md
tasks/event-promo-sms-handoff.md
tasks/expenses-backup-2026-04-20T14-45-58-645Z.json
tasks/lessons.md
```

## User Concerns

Fix allows deletion of cancelled private bookings by bypassing SMS gate. Three layers: server action eligibility, service mutation, DB trigger migration.

## Diff (`HEAD`)

```diff
diff --git a/.claude/changes-manifest.log b/.claude/changes-manifest.log
index 0e07e353..98753b8c 100644
--- a/.claude/changes-manifest.log
+++ b/.claude/changes-manifest.log
@@ -1,162 +1,3 @@
 # manifest-version: 1
-2026-04-16T13:41:21Z|CREATE|supabase/migrations/20260416000000_cross_promo_general_audience.sql|migration|database
-2026-04-16T13:41:25Z|EDIT|src/app/api/cron/event-guest-engagement/route.ts|route|structure,docs
-2026-04-16T13:41:36Z|EDIT|src/lib/sms/cross-promo.ts|utility|structure
-2026-04-16T13:41:41Z|EDIT|src/lib/sms/cross-promo.ts|utility|structure
-2026-04-16T13:41:52Z|EDIT|src/lib/sms/cross-promo.ts|utility|structure
-2026-04-16T13:41:57Z|EDIT|src/lib/sms/cross-promo.ts|utility|structure
-2026-04-16T13:42:19Z|EDIT|src/lib/sms/cross-promo.ts|utility|structure
-2026-04-16T13:42:27Z|EDIT|src/lib/sms/__tests__/cross-promo.test.ts|utility|structure
-2026-04-16T13:42:57Z|EDIT|src/lib/sms/__tests__/cross-promo.test.ts|utility|structure
-2026-04-16T15:03:53Z|CREATE|supabase/migrations/20260613000000_promo_sequence_table.sql|migration|database
-2026-04-16T15:03:55Z|EDIT|src/lib/dateUtils.ts|utility|structure
-2026-04-16T15:04:00Z|CREATE|supabase/migrations/20260613000001_follow_up_recipients_rpc.sql|migration|database
-2026-04-16T15:04:00Z|EDIT|src/lib/__tests__/dateUtils.test.ts|utility|structure
-2026-04-16T15:04:11Z|EDIT|src/lib/__tests__/dateUtils.test.ts|utility|structure
-2026-04-16T15:04:31Z|EDIT|src/lib/dateUtils.ts|utility|structure
-2026-04-16T15:05:44Z|EDIT|src/lib/sms/cross-promo.ts|utility|structure
-2026-04-16T15:05:50Z|EDIT|src/lib/sms/cross-promo.ts|utility|structure
-2026-04-16T15:06:01Z|EDIT|src/lib/sms/cross-promo.ts|utility|structure
-2026-04-16T15:06:13Z|EDIT|src/lib/sms/cross-promo.ts|utility|structure
-2026-04-16T15:06:21Z|EDIT|src/lib/sms/cross-promo.ts|utility|structure
-2026-04-16T15:06:59Z|EDIT|src/app/api/cron/event-guest-engagement/route.ts|route|structure,docs
-2026-04-16T15:07:03Z|EDIT|src/app/api/cron/event-guest-engagement/route.ts|route|structure,docs
-2026-04-16T15:07:22Z|EDIT|src/lib/sms/cross-promo.ts|utility|structure
-2026-04-16T15:07:24Z|EDIT|src/app/api/cron/event-guest-engagement/route.ts|route|structure,docs
-2026-04-16T15:07:33Z|EDIT|src/lib/sms/__tests__/cross-promo.test.ts|utility|structure
-2026-04-16T15:07:38Z|EDIT|src/app/api/cron/event-guest-engagement/route.ts|route|structure,docs
-2026-04-16T15:07:44Z|EDIT|src/app/api/cron/event-guest-engagement/route.ts|route|structure,docs
-2026-04-16T15:07:46Z|EDIT|src/lib/sms/__tests__/cross-promo.test.ts|utility|structure
-2026-04-16T15:08:00Z|EDIT|src/lib/sms/__tests__/cross-promo.test.ts|utility|structure
-2026-04-16T15:08:43Z|EDIT|src/lib/sms/__tests__/cross-promo.test.ts|utility|structure
-2026-04-16T15:10:37Z|EDIT|src/lib/sms/__tests__/cross-promo.test.ts|utility|structure
-2026-04-16T15:10:39Z|EDIT|src/app/api/cron/event-guest-engagement/route.ts|route|structure,docs
-2026-04-16T15:11:19Z|EDIT|src/app/api/cron/event-guest-engagement/route.ts|route|structure,docs
-2026-04-16T15:53:19Z|CREATE|supabase/migrations/20260614000000_update_catering_package_pricing_july_2026.sql|migration|database
-2026-04-16T15:56:59Z|CREATE|supabase/migrations/20260614000001_update_welcome_drinks_and_kids_minimums.sql|migration|database
-2026-04-16T20:45:12Z|CREATE|supabase/migrations/20260615000000_add_event_promo_sms_and_bookings_enabled.sql|migration|database
-2026-04-16T20:45:30Z|EDIT|src/types/event.ts|type|structure
-2026-04-16T20:45:32Z|EDIT|src/types/event.ts|type|structure
-2026-04-16T20:45:37Z|EDIT|src/types/event-categories.ts|type|structure
-2026-04-16T20:45:56Z|EDIT|src/types/event.ts|type|structure
-2026-04-16T20:48:19Z|EDIT|src/components/features/events/EventFormGrouped.tsx|component|structure
-2026-04-16T20:48:21Z|EDIT|src/app/api/event-bookings/route.ts|route|structure,docs
-2026-04-16T20:48:25Z|EDIT|src/components/features/events/EventFormGrouped.tsx|component|structure
-2026-04-16T20:48:26Z|EDIT|src/app/api/event-bookings/route.ts|route|structure,docs
-2026-04-16T20:48:33Z|EDIT|src/components/features/events/EventFormGrouped.tsx|component|structure
-2026-04-16T20:48:42Z|EDIT|src/app/api/events/route.ts|route|structure,docs
-2026-04-16T20:48:49Z|EDIT|src/components/features/events/EventFormGrouped.tsx|component|structure
-2026-04-16T20:48:56Z|EDIT|src/app/api/events/[id]/route.ts|route|structure,docs
-2026-04-16T20:48:57Z|EDIT|src/components/features/events/EventCategoryFormGrouped.tsx|component|structure
-2026-04-16T20:49:02Z|EDIT|src/components/features/events/EventCategoryFormGrouped.tsx|component|structure
-2026-04-16T20:49:09Z|EDIT|src/app/api/cron/event-guest-engagement/route.ts|route|structure,docs
-2026-04-16T20:49:11Z|EDIT|src/app/api/cron/event-guest-engagement/route.ts|route|structure,docs
-2026-04-16T20:49:16Z|EDIT|src/components/features/events/EventCategoryFormGrouped.tsx|component|structure
-2026-04-16T20:49:17Z|EDIT|src/app/api/cron/event-guest-engagement/route.ts|route|structure,docs
-2026-04-16T20:49:18Z|EDIT|src/app/api/cron/event-guest-engagement/route.ts|route|structure,docs
-2026-04-16T20:49:24Z|EDIT|src/app/api/cron/event-guest-engagement/route.ts|route|structure,docs
-2026-04-16T20:49:31Z|EDIT|src/types/event-categories.ts|type|structure
-2026-04-16T20:49:39Z|EDIT|src/app/api/cron/event-guest-engagement/route.ts|route|structure,docs
-2026-04-16T20:49:58Z|EDIT|src/app/api/cron/event-waitlist-offers/route.ts|route|structure,docs
-2026-04-16T20:50:01Z|EDIT|src/types/database.ts|type|structure
-2026-04-16T20:50:03Z|EDIT|src/lib/events/waitlist-offers.ts|utility|structure
-2026-04-16T20:50:10Z|EDIT|src/lib/events/waitlist-offers.ts|utility|structure
-2026-04-16T20:52:59Z|EDIT|/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/api/events/[id]/availability/route.ts|route|structure,docs
-2026-04-16T20:54:26Z|EDIT|/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/api/event-bookings/route.ts|route|structure,docs
-2026-04-16T20:54:33Z|EDIT|/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/api/event-bookings/route.ts|route|structure,docs
-2026-04-16T20:54:41Z|EDIT|/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/api/event-waitlist/route.ts|route|structure,docs
-2026-04-16T20:54:47Z|EDIT|/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/api/event-waitlist/route.ts|route|structure,docs
-2026-04-17T07:02:45Z|EDIT|src/components/features/events/EventFormGrouped.tsx|component|structure
-2026-04-17T07:02:58Z|EDIT|src/components/features/events/EventFormGrouped.tsx|component|structure
-2026-04-17T11:33:43Z|CREATE|src/components/schedule-calendar/types.ts|component|structure
-2026-04-17T11:33:50Z|CREATE|src/components/schedule-calendar/sort.ts|component|structure
-2026-04-17T11:33:55Z|CREATE|src/components/schedule-calendar/hour-range.ts|component|structure
-2026-04-17T11:34:33Z|CREATE|src/components/schedule-calendar/adapters.ts|component|structure
-2026-04-17T11:34:44Z|EDIT|src/components/events/command-center/CommandCenterShell.tsx|component|structure
-2026-04-17T11:34:52Z|EDIT|src/components/events/command-center/CommandCenterShell.tsx|component|structure
-2026-04-17T11:34:56Z|EDIT|src/components/events/command-center/CommandCenterShell.tsx|component|structure
-2026-04-17T11:37:33Z|EDIT|src/components/schedule-calendar/adapters.ts|component|structure
-2026-04-17T11:37:36Z|EDIT|src/components/schedule-calendar/adapters.ts|component|structure
-2026-04-17T11:39:52Z|CREATE|src/components/schedule-calendar/ScheduleCalendarMonth.tsx|component|structure
-2026-04-17T11:40:37Z|CREATE|src/components/schedule-calendar/ScheduleCalendarWeek.tsx|component|structure
-2026-04-17T11:41:03Z|CREATE|src/components/schedule-calendar/ScheduleCalendarList.tsx|component|structure
-2026-04-17T11:41:44Z|EDIT|src/components/schedule-calendar/ScheduleCalendarWeek.tsx|component|structure
-2026-04-17T11:41:49Z|EDIT|src/components/schedule-calendar/ScheduleCalendarWeek.tsx|component|structure
-2026-04-17T11:55:48Z|CREATE|src/components/schedule-calendar/ScheduleCalendar.tsx|component|structure
-2026-04-17T11:55:52Z|CREATE|src/components/schedule-calendar/index.ts|component|structure
-2026-04-17T11:56:36Z|CREATE|src/components/events/command-center/EventCalendarView.tsx|component|structure
-2026-04-17T11:56:40Z|EDIT|src/components/events/command-center/ControlBar.tsx|component|structure
-2026-04-17T11:56:50Z|EDIT|src/components/events/command-center/ControlBar.tsx|component|structure
-2026-04-17T11:56:54Z|EDIT|src/components/events/command-center/CommandCenterShell.tsx|component|structure
-2026-04-17T11:56:57Z|EDIT|src/components/events/command-center/CommandCenterShell.tsx|component|structure
-2026-04-17T11:57:03Z|EDIT|src/components/events/command-center/CommandCenterShell.tsx|component|structure
-2026-04-17T12:03:41Z|EDIT|src/components/ui-v2/display/Calendar.tsx|component|structure
-2026-04-17T12:03:42Z|EDIT|src/components/ui-v2/index.ts|component|structure
-2026-04-17T12:21:30Z|EDIT|src/app/(authenticated)/dashboard/page.tsx|route|structure,docs
-2026-04-17T12:21:44Z|EDIT|src/components/schedule-calendar/ScheduleCalendarWeek.tsx|component|structure
-2026-04-17T12:21:51Z|EDIT|src/components/schedule-calendar/ScheduleCalendarWeek.tsx|component|structure
-2026-04-17T12:22:07Z|EDIT|src/components/schedule-calendar/ScheduleCalendarList.tsx|component|structure
-2026-04-17T12:23:01Z|EDIT|src/components/events/command-center/ControlBar.tsx|component|structure
-2026-04-17T12:45:19Z|EDIT|src/components/schedule-calendar/ScheduleCalendarMonth.tsx|component|structure
-2026-04-17T12:45:32Z|EDIT|src/components/schedule-calendar/ScheduleCalendarMonth.tsx|component|structure
-2026-04-17T12:45:42Z|EDIT|src/components/schedule-calendar/ScheduleCalendarMonth.tsx|component|structure
-2026-04-17T12:46:04Z|EDIT|src/components/schedule-calendar/ScheduleCalendarWeek.tsx|component|structure
-2026-04-17T12:46:29Z|EDIT|src/components/schedule-calendar/ScheduleCalendarList.tsx|component|structure
-2026-04-18T16:41:32Z|CREATE|supabase/migrations/20260418120000_pb_sms_review_lifecycle.sql|migration|database
-2026-04-18T16:42:04Z|CREATE|supabase/migrations/20260418120100_pb_outcome_token_action.sql|migration|database
-2026-04-18T16:42:17Z|CREATE|src/lib/sms/sanitise.ts|utility|structure
-2026-04-18T16:42:25Z|CREATE|supabase/migrations/20260418120200_pb_send_idempotency.sql|migration|database
-2026-04-18T16:42:39Z|EDIT|src/lib/sms/sanitise.ts|utility|structure
-2026-04-18T16:42:46Z|CREATE|supabase/migrations/20260418120300_pb_delete_gate_trigger.sql|migration|database
-2026-04-18T16:43:22Z|CREATE|src/lib/private-bookings/tbd-detection.ts|utility|structure
-2026-04-18T16:45:14Z|CREATE|src/lib/private-bookings/messages.ts|utility|structure
-2026-04-18T16:45:44Z|EDIT|src/lib/sms/sanitise.ts|utility|structure
-2026-04-18T16:54:52Z|EDIT|src/app/api/cron/private-booking-monitor/route.ts|route|structure,docs
-2026-04-18T16:55:02Z|EDIT|src/app/api/cron/private-booking-monitor/route.ts|route|structure,docs
-2026-04-18T16:55:22Z|EDIT|src/app/api/cron/private-booking-monitor/route.ts|route|structure,docs
-2026-04-18T16:55:37Z|EDIT|src/app/api/cron/private-booking-monitor/route.ts|route|structure,docs
-2026-04-18T16:55:45Z|EDIT|src/app/api/cron/private-booking-monitor/route.ts|route|structure,docs
-2026-04-18T16:55:54Z|EDIT|src/app/api/cron/private-booking-monitor/route.ts|route|structure,docs
-2026-04-18T16:56:33Z|EDIT|src/app/api/cron/private-booking-monitor/route.ts|route|structure,docs
-2026-04-18T16:56:48Z|EDIT|src/app/api/cron/private-booking-monitor/route.ts|route|structure,docs
-2026-04-18T17:10:34Z|EDIT|src/lib/private-bookings/manager-notifications.ts|utility|structure
-2026-04-18T17:11:23Z|EDIT|src/lib/private-bookings/manager-notifications.ts|utility|structure
-2026-04-18T17:12:42Z|CREATE|src/components/private-bookings/DeleteBookingButton.tsx|component|structure
-2026-04-18T17:22:35Z|EDIT|src/lib/guest/tokens.ts|utility|structure
-2026-04-18T17:22:41Z|EDIT|src/lib/private-bookings/manager-notifications.ts|utility|structure
-2026-04-18T17:23:30Z|CREATE|src/app/api/private-bookings/outcome/[outcome]/[token]/route.ts|route|structure,docs
-2026-04-18T17:25:23Z|EDIT|src/app/api/private-bookings/outcome/[outcome]/[token]/route.ts|route|structure,docs
-2026-04-18T17:25:26Z|EDIT|src/app/api/private-bookings/outcome/[outcome]/[token]/route.ts|route|structure,docs
-2026-04-18T17:25:30Z|EDIT|src/app/api/private-bookings/outcome/[outcome]/[token]/route.ts|route|structure,docs
-2026-04-18T17:26:36Z|CREATE|src/components/private-bookings/CommunicationsTab.tsx|component|structure
-2026-04-18T17:26:48Z|EDIT|src/app/api/cron/private-booking-monitor/route.ts|route|structure,docs
-2026-04-18T17:26:55Z|EDIT|src/app/api/cron/private-booking-monitor/route.ts|route|structure,docs
-2026-04-18T17:26:57Z|CREATE|src/components/private-bookings/CommunicationsTabServer.tsx|component|structure
-2026-04-18T17:27:16Z|CREATE|src/app/(authenticated)/private-bookings/[id]/communications/page.tsx|route|structure,docs
-2026-04-18T17:27:34Z|EDIT|src/app/(authenticated)/private-bookings/[id]/items/page.tsx|route|structure,docs
-2026-04-18T17:27:56Z|EDIT|src/app/api/cron/private-booking-monitor/route.ts|route|structure,docs
-2026-04-18T17:28:04Z|EDIT|src/app/api/cron/private-booking-monitor/route.ts|route|structure,docs
-2026-04-18T17:28:12Z|EDIT|src/app/api/cron/private-booking-monitor/route.ts|route|structure,docs
-2026-04-18T17:28:25Z|EDIT|src/app/api/cron/private-booking-monitor/route.ts|route|structure,docs
-2026-04-18T17:35:30Z|CREATE|src/lib/private-bookings/stale-outcomes.ts|utility|structure
-2026-04-18T17:35:39Z|EDIT|src/lib/private-bookings/manager-notifications.ts|utility|structure
-2026-04-18T17:35:53Z|EDIT|src/lib/private-bookings/manager-notifications.ts|utility|structure
-2026-04-18T17:35:58Z|EDIT|src/lib/private-bookings/manager-notifications.ts|utility|structure
-2026-04-18T17:36:09Z|EDIT|src/lib/private-bookings/manager-notifications.ts|utility|structure
-2026-04-18T17:36:17Z|EDIT|src/app/api/cron/private-bookings-weekly-summary/route.ts|route|structure,docs
-2026-04-18T17:36:26Z|EDIT|src/app/api/cron/private-bookings-weekly-summary/route.ts|route|structure,docs
-2026-04-18T17:54:05Z|EDIT|src/app/api/cron/private-booking-monitor/route.ts|route|structure,docs
-2026-04-18T17:55:36Z|EDIT|src/app/api/cron/private-booking-monitor/route.ts|route|structure,docs
-2026-04-18T18:17:37Z|EDIT|paypal-fix/src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts|route|structure,docs
-2026-04-18T18:17:47Z|EDIT|paypal-fix/src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts|route|structure,docs
-2026-04-18T18:17:52Z|EDIT|paypal-fix/src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts|route|structure,docs
-2026-04-18T18:18:10Z|EDIT|paypal-fix/src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts|route|structure,docs
-2026-04-18T18:18:19Z|EDIT|paypal-fix/src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts|route|structure,docs
-2026-04-18T18:36:34Z|EDIT|structured-preorder/src/app/api/table-bookings/route.ts|route|structure,docs
-2026-04-18T18:36:46Z|EDIT|structured-preorder/src/app/api/table-bookings/route.ts|route|structure,docs
-2026-04-18T18:36:54Z|EDIT|structured-preorder/src/app/api/table-bookings/route.ts|route|structure,docs
-2026-04-18T18:37:12Z|EDIT|structured-preorder/src/app/api/table-bookings/route.ts|route|structure,docs
-2026-04-18T18:45:19Z|EDIT|/Users/peterpitcher/Cursor/OJ-The-Anchor.pub-structured-fields/app/api/table-bookings/route.ts|route|structure,docs
-2026-04-18T18:45:38Z|EDIT|/Users/peterpitcher/Cursor/OJ-The-Anchor.pub-structured-fields/app/api/table-bookings/route.ts|route|structure,docs
-2026-04-18T18:46:09Z|EDIT|/Users/peterpitcher/Cursor/OJ-The-Anchor.pub-structured-fields/app/api/table-bookings/route.ts|route|structure,docs
-2026-04-18T18:46:29Z|EDIT|/Users/peterpitcher/Cursor/OJ-The-Anchor.pub-structured-fields/app/api/table-bookings/route.ts|route|structure,docs
+2026-04-23T10:08:15Z|EDIT|supabase/migrations/20260418120300_pb_delete_gate_trigger.sql|migration|database
+2026-04-23T10:08:43Z|CREATE|supabase/migrations/20260623000000_allow_delete_cancelled_bookings.sql|migration|database
diff --git a/docs/architecture/README.md b/docs/architecture/README.md
index 48c4b05b..b710f218 100644
--- a/docs/architecture/README.md
+++ b/docs/architecture/README.md
@@ -1,6 +1,6 @@
 ---
 generated: true
-last_updated: 2026-04-20T00:00:00Z
+last_updated: 2026-04-23
 source: session-setup
 project: the-anchor-management-tools
 ---
diff --git a/docs/architecture/data-model.md b/docs/architecture/data-model.md
index 3e6bdb95..4f5d8537 100644
--- a/docs/architecture/data-model.md
+++ b/docs/architecture/data-model.md
@@ -1,6 +1,6 @@
 ---
 generated: true
-last_updated: 2026-04-20T00:00:00Z
+last_updated: 2026-04-23
 source: session-setup
 project: the-anchor-management-tools
 ---
diff --git a/docs/architecture/overview.md b/docs/architecture/overview.md
index 5977271c..8a359dbe 100644
--- a/docs/architecture/overview.md
+++ b/docs/architecture/overview.md
@@ -1,6 +1,6 @@
 ---
 generated: true
-last_updated: 2026-04-20T00:00:00Z
+last_updated: 2026-04-23
 source: session-setup
 project: the-anchor-management-tools
 ---
diff --git a/docs/architecture/relationships.md b/docs/architecture/relationships.md
index d04f4b15..e319afa4 100644
--- a/docs/architecture/relationships.md
+++ b/docs/architecture/relationships.md
@@ -1,6 +1,6 @@
 ---
 generated: true
-last_updated: 2026-04-20T00:00:00Z
+last_updated: 2026-04-23
 source: session-setup
 project: the-anchor-management-tools
 ---
diff --git a/docs/architecture/routes.md b/docs/architecture/routes.md
index e1cf5296..454814aa 100644
--- a/docs/architecture/routes.md
+++ b/docs/architecture/routes.md
@@ -1,6 +1,6 @@
 ---
 generated: true
-last_updated: 2026-04-20T00:00:00Z
+last_updated: 2026-04-23
 source: session-setup
 project: the-anchor-management-tools
 ---
diff --git a/docs/architecture/server-actions.md b/docs/architecture/server-actions.md
index e2e08cd4..82203cdf 100644
--- a/docs/architecture/server-actions.md
+++ b/docs/architecture/server-actions.md
@@ -1,6 +1,6 @@
 ---
 generated: true
-last_updated: 2026-04-20T00:00:00Z
+last_updated: 2026-04-23
 source: session-setup
 project: the-anchor-management-tools
 ---
diff --git a/src/app/actions/privateBookingActions.ts b/src/app/actions/privateBookingActions.ts
index 66974f84..289dcf0b 100644
--- a/src/app/actions/privateBookingActions.ts
+++ b/src/app/actions/privateBookingActions.ts
@@ -479,6 +479,33 @@ export async function getBookingDeleteEligibility(bookingId: string): Promise<{
   }
 
   const admin = createAdminClient()
+
+  // If the booking is already cancelled, the customer has been notified —
+  // the SMS gate should not block deletion.
+  const { data: booking, error: bookingError } = await admin
+    .from('private_bookings')
+    .select('status')
+    .eq('id', bookingId)
+    .single()
+
+  if (bookingError || !booking) {
+    return {
+      canDelete: false,
+      sentCount: 0,
+      scheduledCount: 0,
+      reason: 'Booking not found'
+    }
+  }
+
+  // Skip SMS gate for cancelled bookings — customer already notified
+  if (booking.status === 'cancelled') {
+    return {
+      canDelete: true,
+      sentCount: 0,
+      scheduledCount: 0
+    }
+  }
+
   const { data, error } = await admin
     .from('private_booking_sms_queue')
     .select('status, scheduled_for')
diff --git a/src/services/private-bookings/mutations.ts b/src/services/private-bookings/mutations.ts
index b6e965e5..04d83322 100644
--- a/src/services/private-bookings/mutations.ts
+++ b/src/services/private-bookings/mutations.ts
@@ -1358,32 +1358,43 @@ export async function deletePrivateBooking(id: string): Promise<{ deletedBooking
   const supabase = await createClient();
 
   // GATE: block if any SMS was sent, or is approved-and-scheduled for a future
-  // time. If the customer has been (or is about to be) contacted, Delete is
-  // the wrong verb — the admin should use Cancel so the customer gets a
-  // proper cancellation SMS. The DB trigger (installed in Wave 1 Task 1.4) is
-  // the last-line defence; this action-layer check surfaces a friendly error
-  // for the UI without a round trip to PostgreSQL.
-  const { data: blockingRows, error: blockingError } = await supabase
-    .from('private_booking_sms_queue')
-    .select('id, status, scheduled_for')
-    .eq('booking_id', id)
-    .or('status.eq.sent,and(status.eq.approved,scheduled_for.gt.now())');
-
-  if (blockingError) {
-    const blockingErr = blockingError as { message?: string } | null;
-    logger.error('deletePrivateBooking: failed to check SMS gate', {
-      error: blockingError instanceof Error
-        ? blockingError
-        : new Error(String(blockingErr?.message ?? blockingError)),
-      metadata: { bookingId: id },
-    });
-    throw new Error('Failed to verify delete eligibility; please try again.');
+  // time — UNLESS the booking is already cancelled (customer already notified).
+  // The DB trigger is the last-line defence; this action-layer check surfaces
+  // a friendly error for the UI.
+  const { data: bookingRow, error: bookingCheckError } = await supabase
+    .from('private_bookings')
+    .select('status')
+    .eq('id', id)
+    .single();
+
+  if (bookingCheckError) {
+    throw new Error('Booking not found or inaccessible.');
   }
 
-  if (blockingRows && blockingRows.length > 0) {
-    throw new Error(
-      `Cannot delete booking: customer has received ${blockingRows.length} SMS message(s). Use Cancel instead so they're notified.`,
-    );
+  // Skip SMS gate for cancelled bookings — customer already notified
+  if (bookingRow.status !== 'cancelled') {
+    const { data: blockingRows, error: blockingError } = await supabase
+      .from('private_booking_sms_queue')
+      .select('id, status, scheduled_for')
+      .eq('booking_id', id)
+      .or('status.eq.sent,and(status.eq.approved,scheduled_for.gt.now())');
+
+    if (blockingError) {
+      const blockingErr = blockingError as { message?: string } | null;
+      logger.error('deletePrivateBooking: failed to check SMS gate', {
+        error: blockingError instanceof Error
+          ? blockingError
+          : new Error(String(blockingErr?.message ?? blockingError)),
+        metadata: { bookingId: id },
+      });
+      throw new Error('Failed to verify delete eligibility; please try again.');
+    }
+
+    if (blockingRows && blockingRows.length > 0) {
+      throw new Error(
+        `Cannot delete booking: customer has received ${blockingRows.length} SMS message(s). Use Cancel instead so they're notified.`,
+      );
+    }
   }
 
   // Calendar Cleanup
diff --git a/supabase/.temp/gotrue-version b/supabase/.temp/gotrue-version
index e78dcd1b..5bbfd4d4 100644
--- a/supabase/.temp/gotrue-version
+++ b/supabase/.temp/gotrue-version
@@ -1 +1 @@
-v2.184.0
\ No newline at end of file
+v2.188.1
\ No newline at end of file
diff --git a/supabase/.temp/storage-version b/supabase/.temp/storage-version
index 89c19bef..b592d756 100644
--- a/supabase/.temp/storage-version
+++ b/supabase/.temp/storage-version
@@ -1 +1 @@
-v1.33.0
\ No newline at end of file
+v1.54.0
\ No newline at end of file
diff --git a/tasks/lessons.md b/tasks/lessons.md
index 33f3d6ea..727b5926 100644
--- a/tasks/lessons.md
+++ b/tasks/lessons.md
@@ -3,3 +3,9 @@
 <!-- After every correction, Claude adds a rule here to prevent repeating the mistake. -->
 <!-- Format: date, mistake pattern, rule to follow going forward. -->
 <!-- Review this file at the start of every session. -->
+
+## 2026-04-20: Always verify day-of-week before sending customer-facing messages
+
+**Mistake:** Sent 32 SMS saying "Music Bingo is this Thursday" when April 24 2026 is a Friday. Required a correction message to all recipients.
+
+**Rule:** When composing any customer-facing message that references a day of the week, ALWAYS compute and verify the day programmatically (e.g. `new Date('2026-04-24').toLocaleDateString('en-GB', { weekday: 'long' })`) before sending. Never assume or calculate mentally.
```

## Changed File Contents

### `.claude/changes-manifest.log`

```
# manifest-version: 1
2026-04-23T10:08:15Z|EDIT|supabase/migrations/20260418120300_pb_delete_gate_trigger.sql|migration|database
2026-04-23T10:08:43Z|CREATE|supabase/migrations/20260623000000_allow_delete_cancelled_bookings.sql|migration|database
```

### `docs/architecture/README.md`

```
---
generated: true
last_updated: 2026-04-23
source: session-setup
project: the-anchor-management-tools
---

# Architecture Documentation Index

> Auto-generated by session-setup. Manual edits will be overwritten on next refresh.

## Documents

| File | Status | Description |
|------|--------|-------------|
| [[overview]] | Complete | Project summary, tech stack, key counts, auth model, module list |
| [[routes]] | Complete | Full route table (98 authenticated + 14 public + 7 guest-token + 3 staff-portal pages, 105+ API routes, 28 cron jobs, 6 webhooks) |
| [[server-actions]] | Complete | 478+ exported actions across 95 files, grouped by 15+ domains |
| [[data-model]] | Partial | Table inventory extracted from action/route references; awaiting database agent for full schema |
| [[relationships]] | Complete | Integration map, domain-to-page mapping, cron domain mapping, webhook flows, auth flow diagram |

## Key Statistics

- **Authenticated Pages**: ~98
- **Public Pages**: 14
- **Guest Token Pages**: 7
- **Staff Portal Pages**: 3
- **API Routes**: 105+ (28 cron, 6 webhook, 16 FOH, 9 BOH, 8 menu-management, 30+ public/external, 28+ internal)
- **Server Action Files**: 95
- **Exported Server Actions**: 478+
- **External Integrations**: 7 (Supabase, Twilio, Microsoft Graph, Stripe, PayPal, OpenAI, QR Code)
- **Environment Variables**: 80+ declared in `.env.example`
- **Auth Patterns**: 6 (middleware, layout session+RBAC, session-only, CRON_SECRET, webhook signature, token-based)
- **Domains**: 15+ (Customers, Events, Private Bookings, Table Bookings, Rota, Timeclock, Leave, Payroll, Invoices, Quotes, Receipts/Expenses/Mileage/MGD, Parking, Messages/SMS, Short Links, OJ Projects, Cashing Up, Menu Management, Employees, Performers, Settings)

## Refresh

To regenerate these docs, run the session-setup enrichment scanner.
```

### `docs/architecture/data-model.md`

```
---
generated: true
last_updated: 2026-04-23
source: session-setup
project: the-anchor-management-tools
---

# Data Model

> Auto-generated by session-setup. Manual edits will be overwritten on next refresh.

See session-context.md for full schema. This file will be populated by the database agent.

Tables referenced across server actions and API routes (extracted from `.from('table')` calls):

- `customers`, `customer_labels`, `customer_label_assignments`, `customer_category_stats`
- `events`, `event_bookings`, `event_categories`, `event_checklists`, `event_images`, `event_marketing_links`, `event_waitlist`
- `private_bookings`, `private_booking_items`, `private_booking_notes`, `private_booking_payments`, `private_booking_sms_queue`
- `venue_spaces`, `catering_packages`, `private_booking_vendors`
- `table_bookings`, `table_booking_preorders`, `tables`, `table_join_groups`, `space_area_links`
- `rota_weeks`, `rota_shifts`, `shift_templates`, `rota_settings`
- `timeclock_sessions`
- `leave_requests`
- `payroll_periods`, `pay_age_bands`, `pay_band_rates`, `employee_pay_settings`, `employee_rate_overrides`
- `invoices`, `invoice_line_items`, `invoice_payments`, `invoice_email_logs`, `line_item_catalog`
- `recurring_invoices`, `recurring_invoice_line_items`
- `quotes`, `quote_line_items`
- `receipts`, `receipt_transactions`, `receipt_files`, `receipt_rules`
- `expenses`, `expense_files`
- `mileage_destinations`, `mileage_trips`, `mileage_distance_cache`
- `mgd_collections`, `mgd_returns`
- `employees`, `employee_notes`, `employee_attachments`, `employee_emergency_contacts`
- `employee_financial_details`, `employee_health_records`, `employee_right_to_work`
- `employee_invites`, `employee_versions`
- `parking_bookings`, `parking_notifications`, `parking_rate_config`
- `messages`, `message_templates`
- `sms_logs`, `sms_rate_limits`
- `short_links`, `short_link_clicks`
- `oj_projects`, `oj_project_entries`, `oj_work_types`, `oj_recurring_charges`
- `oj_vendor_billing_settings`, `oj_project_contacts`
- `cashup_sessions`, `cashup_daily_targets`, `cashup_weekly_targets`
- `departments`, `department_budgets`
- `business_hours`, `special_hours`, `service_statuses`, `service_status_overrides`
- `calendar_notes`
- `menu_ingredients`, `menu_ingredient_prices`, `menu_recipes`, `menu_recipe_ingredients`
- `menu_dishes`, `menu_dish_recipes`, `menus`, `menu_categories`
- `user_roles`, `roles`, `permissions`, `role_permissions`
- `audit_logs`, `webhook_logs`
- `attachment_categories`
- `background_jobs`
- `api_keys`
- `performer_submissions`

## Cross-References

- [[server-actions]] -- Actions that read/write these tables
- [[relationships]] -- Table-to-action and table-to-page mappings
```

### `docs/architecture/overview.md`

```
---
generated: true
last_updated: 2026-04-23
source: session-setup
project: the-anchor-management-tools
---

# Architecture Overview

> Auto-generated by session-setup. Manual edits will be overwritten on next refresh.

## Project Summary

The Anchor Management Tools is a comprehensive pub/venue management system built with Next.js 15 App Router, React 19, TypeScript, Tailwind CSS v4, and Supabase (PostgreSQL + Auth + RLS). It manages customers, events, bookings, rota/payroll, invoicing, parking, and internal operations for The Anchor pub.

## Key Counts

| Metric | Count |
|--------|-------|
| Authenticated Pages | ~98 |
| Public Pages | 14 |
| Guest Token Pages | 7 |
| Staff Portal Pages | 3 |
| API Routes | 105+ |
| Cron Jobs | 28 |
| Webhook Endpoints | 5 |
| Server Action Files | 95 |
| Exported Server Actions | 478+ |
| Environment Variables | 80+ declared in `.env.example` |
| External Integrations | 7 (Supabase, Twilio, Microsoft Graph, Stripe, PayPal, OpenAI, QR Code) |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| UI | React 19, Tailwind CSS v4 |
| Database | Supabase (PostgreSQL + RLS) |
| Auth | Supabase Auth (JWT + HTTP-only cookies) |
| SMS | Twilio (messaging service, rate limiting, safety guards) |
| Email | Microsoft Graph (OAuth2 client credentials) |
| Payments | Stripe (event deposits, card captures), PayPal (table bookings, parking, private bookings) |
| AI | OpenAI (receipt parsing, menu AI, calendar notes, event content generation) |
| QR Codes | qrcode library (event marketing links) |
| Bot Protection | Cloudflare Turnstile |
| Hosting | Vercel |

## Auth Model

| Pattern | Where Used | Mechanism |
|---------|-----------|-----------|
| Session + RBAC | `(authenticated)/` layout | `supabase.auth.getUser()` + `getUserPermissions()` in layout.tsx |
| Session only | `(staff-portal)/` layout | `supabase.auth.getUser()` redirect to login |
| Public (no auth) | `(timeclock)/`, `table-booking/`, `auth/`, `privacy/` | No auth check |
| Token-based | `g/[token]/`, `m/[token]/`, `r/[token]/` | Guest tokens validated per-route |
| CRON_SECRET | `api/cron/*` | `authorizeCronRequest()` via Bearer header |
| Webhook signature | `api/webhooks/*` | Twilio signature, PayPal/Stripe webhook verification |
| Middleware | Global (currently active) | `src/middleware.ts` with PUBLIC_PATH_PREFIXES allowlist |

**Note**: Middleware was previously disabled due to a Vercel incident (renamed `.disabled`). A new `middleware.ts` exists and is active, with public path prefixes: `/_next`, `/static`, `/api`, `/auth`, `/error`, `/privacy`, `/booking-confirmation`, `/booking-success`, `/table-booking`, `/parking/guest`, `/onboarding`, `/timeclock`, `/g`, `/r`.

## Route Groups

| Group | Purpose | Auth |
|-------|---------|------|
| `(authenticated)/` | Staff management UI | Session + RBAC |
| `(staff-portal)/portal/` | Employee self-service (shifts, leave) | Session |
| `(timeclock)/timeclock/` | Kiosk clock-in/out | Public |
| `(employee-onboarding)/` | New staff onboarding flows | Token-based |
| `booking-portal/` | Booking portal layout | Layout-level |
| `api/cron/` | Scheduled jobs (28 endpoints) | CRON_SECRET via `authorizeCronRequest` |
| `api/webhooks/` | Twilio, Stripe, PayPal callbacks | Signature verification |
| `api/foh/` | Front-of-house real-time ops | Session |
| `api/boh/` | Back-of-house kitchen ops | Session |
| `api/external/` | External integrations (performer interest, create-booking) | API key / public |
| `g/[token]/` | Guest-facing token pages (payments, pre-orders, feedback) | Token-based |
| `m/[token]/` | Mobile charge requests | Token-based |
| `r/[token]/` | Short link redirects | Token-based |
| `table-booking/` | Public table reservation | Public |
| `auth/` | Login, password reset, email confirm | Public |

## Key Modules

- **Customers** -- CRM, labels, engagement scoring, insights, bulk SMS, win-back campaigns
- **Events** -- Recurring/one-off events, bookings, waitlists, checklists, marketing links, event images, performer submissions
- **Private Bookings** -- Venue hire, contracts, deposits, SMS sequences, vendor management, catering packages, SMS queue approval
- **Table Bookings** -- Online reservations, FOH/BOH views, deposits (Stripe + PayPal), pre-orders, sunday lunch
- **Rota** -- Shift scheduling, templates, timeclock, payroll export, leave management, calendar feed (ICS)
- **Invoices/Quotes** -- Full invoicing with recurring, PDF generation, payment tracking, credit notes, vendor management
- **Receipts** -- AI-categorised receipt capture, P&L dashboard, expense tracking, mileage (HMRC rates), MGD returns
- **Parking** -- Guest parking management with PayPal payments, SMS notifications
- **Messages/SMS** -- Bulk and individual SMS, templates, rate limiting (hourly/daily), idempotency, safety guards
- **Short Links** -- Branded short URLs (`vip-club.uk`) with click tracking, UTM variants
- **OJ Projects** -- Client project time tracking, billing, recurring charges, statements
- **Cashing Up** -- Daily/weekly cash reconciliation, insights, targets
- **Employees** -- HR records, onboarding, birthdays, attachments, right-to-work, emergency contacts, financial details
- **Settings** -- Business hours, API keys, RBAC roles, audit logs, GDPR, budgets, calendar notes
- **Menu Management** -- Ingredients, recipes, dishes, AI parsing, allergen verification, GP tracking

## Cross-References

- [[routes]] -- Full route table with methods and auth types
- [[server-actions]] -- All 478+ server actions grouped by domain
- [[data-model]] -- Database schema
- [[relationships]] -- Module cross-reference map
```

### `docs/architecture/relationships.md`

```
---
generated: true
last_updated: 2026-04-23
source: session-setup
project: the-anchor-management-tools
---

# Relationships & Cross-References

> Auto-generated by session-setup. Manual edits will be overwritten on next refresh.

## External Integrations

| Service | Library | Files | Purpose |
|---------|---------|-------|---------|
| Supabase | `@supabase/supabase-js`, `@supabase/ssr` | `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`, `src/lib/supabase/client.ts`, `src/lib/supabase.ts` | Database, auth, storage, realtime |
| Twilio | `twilio` | `src/lib/twilio.ts`, `src/lib/sms/safety.ts`, `src/lib/sms/logging.ts`, `src/lib/sms/customers.ts`, `src/app/api/webhooks/twilio/route.ts`, `src/app/api/cron/reconcile-sms/route.ts` | SMS send/receive, delivery tracking, rate limiting |
| Microsoft Graph | `@microsoft/microsoft-graph-client` | `src/lib/email/emailService.ts`, `src/lib/microsoft-graph.ts` | Email sending (OAuth2 client credentials) |
| Stripe | `@/lib/payments/stripe` (internal wrapper) | `src/lib/table-bookings/charge-approvals.ts`, `src/lib/table-bookings/refunds.ts`, `src/lib/events/manage-booking.ts`, `src/app/api/stripe/webhook/route.ts`, `src/app/api/foh/bookings/[id]/cancel/route.ts`, `src/app/api/boh/table-bookings/[id]/route.ts` | Event deposits, card captures, refunds |
| PayPal | `@/lib/paypal` (internal wrapper), `@paypal/react-paypal-js` | `src/app/actions/privateBookingActions.ts`, `src/lib/parking/payments.ts`, `src/app/g/[token]/table-payment/`, `src/app/api/webhooks/paypal/`, `src/app/api/external/table-bookings/` | Table booking deposits, parking payments, private booking deposits |
| OpenAI | `@/lib/openai`, `@/lib/openai/config` | `src/lib/openai.ts`, `src/lib/openai/config.ts`, `src/lib/receipts/ai-classification.ts`, `src/app/actions/calendar-notes.ts`, `src/app/actions/event-content.ts`, `src/app/actions/ai-menu-parsing.ts` | Receipt classification, calendar note AI, event content generation, menu ingredient parsing |
| QR Code | `qrcode` | `src/services/event-marketing.ts` | Event marketing link QR codes |
| Cloudflare Turnstile | Server-side validation | Public booking endpoints | Bot protection on public forms |

## Shared Services

| Service | File | Used By |
|---------|------|---------|
| Cron Auth | `src/lib/cron-auth.ts` | All 28 cron routes via `authorizeCronRequest()` |
| SMS Safety Guards | `src/lib/sms/safety.ts` | SMS sending actions (hourly/daily rate limits, idempotency) |
| SMS Logging | `src/lib/sms/logging.ts` | All SMS operations |
| Rate Limiting | `src/lib/rate-limit-server.ts` | API route protection |
| Audit Logging | `src/lib/audit-helpers.ts`, `src/app/actions/audit.ts` | All mutation server actions |
| Date Utils | `src/lib/dateUtils.ts` | All date display (Europe/London timezone) |
| DB Error Handler | `src/lib/dbErrorHandler.ts` | Database operations |
| Supabase Retry | `src/lib/supabase-retry.ts` | Resilient database calls |
| Guest Tokens | `src/lib/guest/tokens.ts` | Token-based guest pages (`/g/`, `/m/`) |
| Guest Names | `src/lib/guest/names.ts` | Guest display names |
| Short Link Routing | `src/lib/short-links/routing.ts` | Middleware, redirect routes |
| API Idempotency | `src/lib/api/idempotency.ts` | Webhook and payment endpoints |
| Environment Validation | `src/lib/env.ts` | Startup validation of required env vars |
| OpenAI Config | `src/lib/openai/config.ts` | All AI features (model selection, base URL) |
| Invoice Recipients | `src/lib/invoice-recipients.ts` | Invoice email sending |
| Private Booking Tokens | `src/lib/private-bookings/booking-token.ts` | Signed tokens for PB guest flows |
| Private Booking Feedback | `src/lib/private-bookings/feedback.ts` | Post-event feedback collection |
| Engagement Scoring | `src/lib/analytics/engagement-scoring.ts` | Customer engagement cron |
| Event Analytics | `src/lib/analytics/events.ts` | Event reporting |

## Domain-to-Page Mapping

| Domain | Pages | Action Files | API Routes |
|--------|-------|-------------|-----------|
| Customers | `/customers`, `/customers/[id]`, `/customers/insights` | `customers.ts`, `customerSmsActions.ts`, `customer-labels.ts`, `customer-labels-bulk.ts` | `/api/customers/lookup`, `/api/foh/customers/search` |
| Events | `/events`, `/events/new`, `/events/todo` | `events.ts`, `event-categories.ts`, `event-checklist.ts`, `event-images.ts`, `event-marketing-links.ts`, `event-content.ts` | `/api/events/*`, `/api/event-bookings`, `/api/event-waitlist`, `/api/event-categories`, `/api/foh/events/*` |
| Private Bookings | `/private-bookings/*` (10 pages) | `privateBookingActions.ts`, `private-bookings-dashboard.ts` | `/api/private-bookings/*`, `/api/public/private-booking/*`, `/api/webhooks/paypal/private-bookings` |
| Table Bookings | `/table-bookings/*` (5 pages), `/table-booking/*` (public) | (inline in API routes) | `/api/foh/bookings/*`, `/api/boh/table-bookings/*`, `/api/table-bookings`, `/api/external/table-bookings/*` |
| Rota | `/rota/*` (6 pages) | `rota.ts`, `rota-templates.ts`, `rota-settings.ts`, `rota-day-info.ts` | `/api/rota/*` |
| Timeclock | `/timeclock` (public), `/rota/timeclock` | `timeclock.ts` | -- |
| Leave | `/rota/leave`, `/portal/leave/*` | `leave.ts` | -- |
| Payroll | `/rota/payroll` | `payroll.ts`, `pay-bands.ts` | -- |
| Invoices | `/invoices/*` (11 pages) | `invoices.ts`, `recurring-invoices.ts` | `/api/invoices/*` |
| Quotes | `/quotes/*` (5 pages) | `quotes.ts` | `/api/quotes/[id]/pdf` |
| Receipts | `/receipts/*` (6 pages) | `receipts.ts` | `/api/receipts/*` |
| Expenses | `/expenses`, `/expenses/insights` | `expenses.ts` | -- |
| Mileage | `/mileage` | `mileage.ts` | -- |
| MGD | `/mgd`, `/mgd/insights` | `mgd.ts` | -- |
| P&L | `/receipts/pnl` | `pnl.ts` | `/api/receipts/pnl/export` |
| Employees | `/employees/*` (5 pages) | `employeeActions.ts`, `employeeDetails.ts`, `employeeQueries.ts`, `employeeInvite.ts`, `employeeExport.ts`, `employee-birthdays.ts`, `employee-history.ts` | `/api/employees/*` |
| Parking | `/parking` | `parking.ts` | `/api/parking/*`, `/api/webhooks/paypal/parking` |
| Messages | `/messages` | `messagesActions.ts`, `messageActions.ts`, `messageTemplates.ts`, `bulk-messages.ts`, `sms.ts`, `sms-bulk-direct.ts` | `/api/messages/*` |
| Short Links | `/short-links`, `/short-links/insights` | `short-links.ts` | `/api/redirect/*` |
| OJ Projects | `/oj-projects/*` (4 pages) | `oj-projects/*.ts` (7 files) | `/api/oj-projects/*` |
| Cashing Up | `/cashing-up/*` (5 pages) | `cashing-up.ts`, `cashing-up-import.ts`, `missing-cashups.ts`, `daily-summary.ts` | `/api/cashup/*` |
| Menu Mgmt | (via settings) | `menu-management.ts`, `ai-menu-parsing.ts`, `menu-settings.ts` | `/api/menu-management/*`, `/api/menu/*` |
| Performers | `/performers`, `/performers/[id]` | `performer-submissions.ts` | `/api/external/performer-interest` |
| Settings | `/settings/*` (16 pages) | `business-hours.ts`, `calendar-notes.ts`, `budgets.ts`, `vendors.ts`, `vendor-contacts.ts`, `attachmentCategories.ts`, `backgroundJobs.ts`, `cronJobs.ts`, `auditLogs.ts`, `webhooks.ts` | `/api/settings/*` |
| Auth | `/auth/*` (4 pages) | `auth.ts`, `rbac.ts` | `/auth/callback`, `/auth/confirm` |
| Profile | `/profile`, `/profile/change-password` | `profile.ts`, `gdpr.ts` | -- |
| Users/Roles | `/users`, `/roles/*` | `rbac.ts` | -- |

## Cron Job Domain Mapping

| Domain | Cron Jobs |
|--------|-----------|
| Customers | `apply-customer-labels`, `engagement-scoring`, `birthday-reminders` |
| Events | `event-checklist-reminders`, `event-booking-holds`, `event-guest-engagement`, `event-waitlist-offers` |
| Private Bookings | `private-bookings-expire-holds`, `private-bookings-weekly-summary`, `private-booking-monitor` |
| Table Bookings | `table-booking-deposit-timeout`, `generate-slots`, `sunday-lunch-prep`, `sunday-preorder` |
| Rota | `rota-auto-close`, `rota-manager-alert`, `rota-staff-email` |
| Invoices | `invoice-reminders`, `auto-send-invoices`, `recurring-invoices` |
| Parking | `parking-notifications` |
| SMS | `reconcile-sms`, `cleanup-rate-limits` |
| Marketing | `backfill-marketing-links` |
| Employees | `employee-invite-chase` |
| OJ Projects | `oj-projects-billing`, `oj-projects-billing-reminders`, `oj-projects-retainer-projects` |

## Webhook Flow

| Source | Endpoint | Triggers |
|--------|----------|----------|
| Twilio | `/api/webhooks/twilio` | Inbound SMS received, delivery status updates |
| PayPal (general) | `/api/webhooks/paypal` | General PayPal payment events |
| PayPal (table bookings) | `/api/webhooks/paypal/table-bookings` | Table booking deposit captured/refunded |
| PayPal (private bookings) | `/api/webhooks/paypal/private-bookings` | Private booking deposit captured |
| PayPal (parking) | `/api/webhooks/paypal/parking` | Parking payment captured |
| Stripe | `/api/stripe/webhook` | Event payment checkout completed, card capture |

## Auth Flow

```
Request
  |
  v
middleware.ts (PUBLIC_PATH_PREFIXES check)
  |
  v (if not public)
(authenticated)/layout.tsx
  |-- supabase.auth.getUser() --> redirect to /auth/login if no session
  |-- getUserPermissions() --> redirect to /portal/shifts if no management permissions
  |
  v
Page renders with RBAC context
  |
  v (on mutation)
Server Action
  |-- getUser() re-check
  |-- checkUserPermission() for module/action
  |-- Business logic
  |-- logAuditEvent()
  |-- revalidatePath()
```
```

### `docs/architecture/routes.md`

```
---
generated: true
last_updated: 2026-04-23
source: session-setup
project: the-anchor-management-tools
---

# Routes

> Auto-generated by session-setup. Manual edits will be overwritten on next refresh.

## Authenticated Pages (~98 pages)

All pages under `(authenticated)/` require Supabase session + RBAC permissions via layout guard.

| URL Path | Source File |
|----------|-----------|
| `/customers` | `src/app/(authenticated)/customers/page.tsx` |
| `/customers/[id]` | `src/app/(authenticated)/customers/[id]/page.tsx` |
| `/customers/insights` | `src/app/(authenticated)/customers/insights/page.tsx` |
| `/events` | `src/app/(authenticated)/events/page.tsx` |
| `/events/new` | `src/app/(authenticated)/events/new/page.tsx` |
| `/events/todo` | `src/app/(authenticated)/events/todo/page.tsx` |
| `/private-bookings` | `src/app/(authenticated)/private-bookings/page.tsx` |
| `/private-bookings/new` | `src/app/(authenticated)/private-bookings/new/page.tsx` |
| `/private-bookings/calendar` | `src/app/(authenticated)/private-bookings/calendar/page.tsx` |
| `/private-bookings/sms-queue` | `src/app/(authenticated)/private-bookings/sms-queue/page.tsx` |
| `/private-bookings/[id]` | `src/app/(authenticated)/private-bookings/[id]/page.tsx` |
| `/private-bookings/[id]/edit` | `src/app/(authenticated)/private-bookings/[id]/edit/page.tsx` |
| `/private-bookings/[id]/contract` | `src/app/(authenticated)/private-bookings/[id]/contract/page.tsx` |
| `/private-bookings/[id]/messages` | `src/app/(authenticated)/private-bookings/[id]/messages/page.tsx` |
| `/private-bookings/settings` | `src/app/(authenticated)/private-bookings/settings/page.tsx` |
| `/private-bookings/settings/spaces` | `src/app/(authenticated)/private-bookings/settings/spaces/page.tsx` |
| `/private-bookings/settings/catering` | `src/app/(authenticated)/private-bookings/settings/catering/page.tsx` |
| `/private-bookings/settings/vendors` | `src/app/(authenticated)/private-bookings/settings/vendors/page.tsx` |
| `/table-bookings` | `src/app/(authenticated)/table-bookings/page.tsx` |
| `/table-bookings/foh` | `src/app/(authenticated)/table-bookings/foh/page.tsx` |
| `/table-bookings/boh` | `src/app/(authenticated)/table-bookings/boh/page.tsx` |
| `/table-bookings/[id]` | `src/app/(authenticated)/table-bookings/[id]/page.tsx` |
| `/table-bookings/reports` | `src/app/(authenticated)/table-bookings/reports/page.tsx` |
| `/rota/dashboard` | `src/app/(authenticated)/rota/dashboard/page.tsx` |
| `/rota/print` | `src/app/(authenticated)/rota/print/page.tsx` |
| `/rota/timeclock` | `src/app/(authenticated)/rota/timeclock/page.tsx` |
| `/rota/templates` | `src/app/(authenticated)/rota/templates/page.tsx` |
| `/rota/payroll` | `src/app/(authenticated)/rota/payroll/page.tsx` |
| `/rota/leave` | `src/app/(authenticated)/rota/leave/page.tsx` |
| `/invoices` | `src/app/(authenticated)/invoices/page.tsx` |
| `/invoices/new` | `src/app/(authenticated)/invoices/new/page.tsx` |
| `/invoices/[id]` | `src/app/(authenticated)/invoices/[id]/page.tsx` |
| `/invoices/[id]/edit` | `src/app/(authenticated)/invoices/[id]/edit/page.tsx` |
| `/invoices/[id]/payment` | `src/app/(authenticated)/invoices/[id]/payment/page.tsx` |
| `/invoices/export` | `src/app/(authenticated)/invoices/export/page.tsx` |
| `/invoices/catalog` | `src/app/(authenticated)/invoices/catalog/page.tsx` |
| `/invoices/vendors` | `src/app/(authenticated)/invoices/vendors/page.tsx` |
| `/invoices/recurring` | `src/app/(authenticated)/invoices/recurring/page.tsx` |
| `/invoices/recurring/new` | `src/app/(authenticated)/invoices/recurring/new/page.tsx` |
| `/invoices/recurring/[id]` | `src/app/(authenticated)/invoices/recurring/[id]/page.tsx` |
| `/invoices/recurring/[id]/edit` | `src/app/(authenticated)/invoices/recurring/[id]/edit/page.tsx` |
| `/quotes` | `src/app/(authenticated)/quotes/page.tsx` |
| `/quotes/new` | `src/app/(authenticated)/quotes/new/page.tsx` |
| `/quotes/[id]` | `src/app/(authenticated)/quotes/[id]/page.tsx` |
| `/quotes/[id]/edit` | `src/app/(authenticated)/quotes/[id]/edit/page.tsx` |
| `/quotes/[id]/convert` | `src/app/(authenticated)/quotes/[id]/convert/page.tsx` |
| `/receipts` | `src/app/(authenticated)/receipts/page.tsx` |
| `/receipts/bulk` | `src/app/(authenticated)/receipts/bulk/page.tsx` |
| `/receipts/monthly` | `src/app/(authenticated)/receipts/monthly/page.tsx` |
| `/receipts/vendors` | `src/app/(authenticated)/receipts/vendors/page.tsx` |
| `/receipts/missing-expense` | `src/app/(authenticated)/receipts/missing-expense/page.tsx` |
| `/receipts/pnl` | `src/app/(authenticated)/receipts/pnl/page.tsx` |
| `/employees` | `src/app/(authenticated)/employees/page.tsx` |
| `/employees/new` | `src/app/(authenticated)/employees/new/page.tsx` |
| `/employees/birthdays` | `src/app/(authenticated)/employees/birthdays/page.tsx` |
| `/employees/[employee_id]` | `src/app/(authenticated)/employees/[employee_id]/page.tsx` |
| `/employees/[employee_id]/edit` | `src/app/(authenticated)/employees/[employee_id]/edit/page.tsx` |
| `/parking` | `src/app/(authenticated)/parking/page.tsx` |
| `/performers` | `src/app/(authenticated)/performers/page.tsx` |
| `/performers/[id]` | `src/app/(authenticated)/performers/[id]/page.tsx` |
| `/messages` | `src/app/(authenticated)/messages/page.tsx` |
| `/short-links` | `src/app/(authenticated)/short-links/page.tsx` |
| `/short-links/insights` | `src/app/(authenticated)/short-links/insights/page.tsx` |
| `/cashing-up/daily` | `src/app/(authenticated)/cashing-up/daily/page.tsx` |
| `/cashing-up/weekly` | `src/app/(authenticated)/cashing-up/weekly/page.tsx` |
| `/cashing-up/dashboard` | `src/app/(authenticated)/cashing-up/dashboard/page.tsx` |
| `/cashing-up/insights` | `src/app/(authenticated)/cashing-up/insights/page.tsx` |
| `/cashing-up/import` | `src/app/(authenticated)/cashing-up/import/page.tsx` |
| `/oj-projects` | `src/app/(authenticated)/oj-projects/page.tsx` |
| `/oj-projects/projects` | `src/app/(authenticated)/oj-projects/projects/page.tsx` |
| `/oj-projects/work-types` | `src/app/(authenticated)/oj-projects/work-types/page.tsx` |
| `/oj-projects/entries` | `src/app/(authenticated)/oj-projects/entries/page.tsx` |
| `/mileage` | `src/app/(authenticated)/mileage/page.tsx` |
| `/expenses` | `src/app/(authenticated)/expenses/page.tsx` |
| `/expenses/insights` | `src/app/(authenticated)/expenses/insights/page.tsx` |
| `/mgd` | `src/app/(authenticated)/mgd/page.tsx` |
| `/mgd/insights` | `src/app/(authenticated)/mgd/insights/page.tsx` |
| `/users` | `src/app/(authenticated)/users/page.tsx` |
| `/roles` | `src/app/(authenticated)/roles/page.tsx` |
| `/roles/new` | `src/app/(authenticated)/roles/new/page.tsx` |
| `/profile` | `src/app/(authenticated)/profile/page.tsx` |
| `/profile/change-password` | `src/app/(authenticated)/profile/change-password/page.tsx` |
| `/unauthorized` | `src/app/(authenticated)/unauthorized/page.tsx` |
| `/settings` | `src/app/(authenticated)/settings/page.tsx` |
| `/settings/audit-logs` | `src/app/(authenticated)/settings/audit-logs/page.tsx` |
| `/settings/table-bookings` | `src/app/(authenticated)/settings/table-bookings/page.tsx` |
| `/settings/calendar-notes` | `src/app/(authenticated)/settings/calendar-notes/page.tsx` |
| `/settings/pay-bands` | `src/app/(authenticated)/settings/pay-bands/page.tsx` |
| `/settings/menu-target` | `src/app/(authenticated)/settings/menu-target/page.tsx` |
| `/settings/business-hours` | `src/app/(authenticated)/settings/business-hours/page.tsx` |
| `/settings/background-jobs` | `src/app/(authenticated)/settings/background-jobs/page.tsx` |
| `/settings/api-keys` | `src/app/(authenticated)/settings/api-keys/page.tsx` |
| `/settings/gdpr` | `src/app/(authenticated)/settings/gdpr/page.tsx` |
| `/settings/message-templates` | `src/app/(authenticated)/settings/message-templates/page.tsx` |
| `/settings/customer-labels` | `src/app/(authenticated)/settings/customer-labels/page.tsx` |
| `/settings/rota` | `src/app/(authenticated)/settings/rota/page.tsx` |
| `/settings/budgets` | `src/app/(authenticated)/settings/budgets/page.tsx` |
| `/settings/event-categories` | `src/app/(authenticated)/settings/event-categories/page.tsx` |
| `/settings/categories` | `src/app/(authenticated)/settings/categories/page.tsx` |
| `/settings/import-messages` | `src/app/(authenticated)/settings/import-messages/page.tsx` |

## Public Pages

| URL Path | Auth | Source File |
|----------|------|-----------|
| `/auth/login` | Public | `src/app/auth/login/page.tsx` |
| `/auth/recover` | Public | `src/app/auth/recover/page.tsx` |
| `/auth/reset` | Public | `src/app/auth/reset/page.tsx` |
| `/auth/reset-password` | Public | `src/app/auth/reset-password/page.tsx` |
| `/privacy` | Public | `src/app/privacy/page.tsx` |
| `/table-booking` | Public | `src/app/table-booking/page.tsx` |
| `/table-booking/[reference]` | Public | `src/app/table-booking/[reference]/page.tsx` |
| `/table-booking/[reference]/payment` | Public | `src/app/table-booking/[reference]/payment/page.tsx` |
| `/table-booking/success` | Public | `src/app/table-booking/success/page.tsx` |
| `/booking-success/[id]` | Public | `src/app/booking-success/[id]/page.tsx` |
| `/timeclock` | Public (kiosk) | `src/app/(timeclock)/timeclock/page.tsx` |

## Staff Portal Pages

| URL Path | Auth | Source File |
|----------|------|-----------|
| `/portal/shifts` | Session | `src/app/(staff-portal)/portal/shifts/page.tsx` |
| `/portal/leave` | Session | `src/app/(staff-portal)/portal/leave/page.tsx` |
| `/portal/leave/new` | Session | `src/app/(staff-portal)/portal/leave/new/page.tsx` |

## Guest Token Pages

| URL Path | Auth | Source File |
|----------|------|-----------|
| `/g/[token]/event-payment` | Token | `src/app/g/[token]/event-payment/page.tsx` |
| `/g/[token]/manage-booking` | Token | `src/app/g/[token]/manage-booking/page.tsx` |
| `/g/[token]/table-manage` | Token | `src/app/g/[token]/table-manage/page.tsx` |
| `/g/[token]/sunday-preorder` | Token | `src/app/g/[token]/sunday-preorder/page.tsx` |
| `/g/[token]/waitlist-offer` | Token | `src/app/g/[token]/waitlist-offer/page.tsx` |
| `/g/[token]/card-capture` | Token | `src/app/g/[token]/card-capture/page.tsx` |
| `/g/[token]/private-feedback` | Token | `src/app/g/[token]/private-feedback/page.tsx` |

## Guest Token API Routes

| URL Path | Method | Source File |
|----------|--------|-----------|
| `/g/[token]/event-payment/checkout` | POST | `src/app/g/[token]/event-payment/checkout/route.ts` |
| `/g/[token]/manage-booking/action` | POST | `src/app/g/[token]/manage-booking/action/route.ts` |
| `/g/[token]/table-manage/action` | POST | `src/app/g/[token]/table-manage/action/route.ts` |
| `/g/[token]/sunday-preorder/action` | POST | `src/app/g/[token]/sunday-preorder/action/route.ts` |
| `/g/[token]/waitlist-offer/confirm` | POST | `src/app/g/[token]/waitlist-offer/confirm/route.ts` |
| `/g/[token]/card-capture/checkout` | GET | `src/app/g/[token]/card-capture/checkout/route.ts` |
| `/g/[token]/private-feedback/action` | POST | `src/app/g/[token]/private-feedback/action/route.ts` |
| `/m/[token]/charge-request/action` | POST | `src/app/m/[token]/charge-request/action/route.ts` |
| `/r/[token]` | GET | `src/app/r/[token]/route.ts` |

## Auth Routes

| URL Path | Method | Source File |
|----------|--------|-----------|
| `/auth/callback` | GET | `src/app/auth/callback/route.ts` |
| `/auth/confirm` | GET, POST | `src/app/auth/confirm/route.ts` |

## API Routes -- Internal/Authenticated

| URL Path | Methods | Source File |
|----------|---------|-----------|
| `/api/customers/lookup` | GET | `src/app/api/customers/lookup/route.ts` |
| `/api/search` | GET | `src/app/api/search/route.ts` |
| `/api/messages/unread-count` | GET | `src/app/api/messages/unread-count/route.ts` |
| `/api/outstanding-counts` | GET | `src/app/api/outstanding-counts/route.ts` |
| `/api/bug-report` | POST | `src/app/api/bug-report/route.ts` |
| `/api/receipts/upload` | POST | `src/app/api/receipts/upload/route.ts` |
| `/api/receipts/pnl/export` | GET | `src/app/api/receipts/pnl/export/route.ts` |
| `/api/receipts/export` | GET | `src/app/api/receipts/export/route.ts` |
| `/api/invoices/export` | GET | `src/app/api/invoices/export/route.ts` |
| `/api/invoices/[id]/pdf` | GET | `src/app/api/invoices/[id]/pdf/route.ts` |
| `/api/quotes/[id]/pdf` | GET | `src/app/api/quotes/[id]/pdf/route.ts` |
| `/api/private-bookings/contract` | GET | `src/app/api/private-bookings/contract/route.ts` |
| `/api/private-bookings/outcome/[outcome]/[token]` | GET, POST | `src/app/api/private-bookings/outcome/[outcome]/[token]/route.ts` |
| `/api/private-booking-enquiry` | POST | `src/app/api/private-booking-enquiry/route.ts` |
| `/api/rota/pdf` | GET | `src/app/api/rota/pdf/route.ts` |
| `/api/rota/export` | GET | `src/app/api/rota/export/route.ts` |
| `/api/rota/feed` | GET | `src/app/api/rota/feed/route.ts` |
| `/api/rota/resync-calendar` | POST | `src/app/api/rota/resync-calendar/route.ts` |
| `/api/portal/calendar-feed` | GET | `src/app/api/portal/calendar-feed/route.ts` |
| `/api/cashup/weekly/print` | GET | `src/app/api/cashup/weekly/print/route.ts` |
| `/api/employees/[employee_id]/employment-contract` | GET | `src/app/api/employees/[employee_id]/employment-contract/route.ts` |

[truncated at line 200 — original has 356 lines]
```

### `docs/architecture/server-actions.md`

```
---
generated: true
last_updated: 2026-04-23
source: session-setup
project: the-anchor-management-tools
---

# Server Actions

> Auto-generated by session-setup. Manual edits will be overwritten on next refresh.

95 server action files containing 478+ exported async functions across 15+ domains.

## Auth & RBAC

| Action | Source File |
|--------|-----------|
| `signIn`, `signUp`, `signOut` | `src/app/actions/auth.ts` |
| `getUserPermissions`, `checkUserPermission`, `getCurrentUserModuleActions` | `src/app/actions/rbac.ts` |
| `getUserRoles`, `getAllRoles`, `getAllPermissions`, `getRolePermissions` | `src/app/actions/rbac.ts` |
| `createRole`, `updateRole`, `deleteRole` | `src/app/actions/rbac.ts` |
| `assignPermissionsToRole`, `assignRolesToUser`, `getAllUsers` | `src/app/actions/rbac.ts` |

## Customers

| Action | Source File |
|--------|-----------|
| `getCustomerList`, `createCustomer`, `updateCustomer`, `deleteCustomer` | `src/app/actions/customers.ts` |
| `importCustomers`, `updateCustomerNotes`, `sendWinBackCampaign`, `deleteTestCustomers` | `src/app/actions/customers.ts` |
| `toggleCustomerSmsOptIn`, `getCustomerSmsStats`, `getCustomerMessages` | `src/app/actions/customerSmsActions.ts` |
| `getDeliveryFailureReport`, `getSmsDeliveryStats` | `src/app/actions/customerSmsActions.ts` |
| `getCustomerLabels`, `createCustomerLabel`, `updateCustomerLabel`, `deleteCustomerLabel` | `src/app/actions/customer-labels.ts` |
| `assignLabelToCustomer`, `removeLabelFromCustomer`, `getCustomerLabelAssignments` | `src/app/actions/customer-labels.ts` |
| `applyLabelsRetroactively`, `bulkAssignLabel` | `src/app/actions/customer-labels.ts` |
| `getBulkCustomerLabels` | `src/app/actions/customer-labels-bulk.ts` |

## Events

| Action | Source File |
|--------|-----------|
| `createEvent`, `updateEvent`, `deleteEvent`, `getEventById`, `getEvents` | `src/app/actions/events.ts` |
| `getEventFAQs` | `src/app/actions/events.ts` |
| `createEventManualBooking`, `updateEventManualBookingSeats`, `cancelEventManualBooking` | `src/app/actions/events.ts` |
| `getEventCategories`, `getActiveEventCategories`, `createEventCategory`, `updateEventCategory`, `deleteEventCategory` | `src/app/actions/event-categories.ts` |
| `getCategoryRegulars`, `getCrossCategorySuggestions`, `categorizeHistoricalEvents` | `src/app/actions/event-categories.ts` |
| `rebuildCustomerCategoryStats`, `getCustomerCategoryPreferences` | `src/app/actions/event-categories.ts` |
| `createEventCategoryFromFormData`, `updateEventCategoryFromFormData` | `src/app/actions/event-categories.ts` |
| `getEventChecklist`, `toggleEventChecklistTask`, `getEventChecklistProgress`, `getChecklistTodos` | `src/app/actions/event-checklist.ts` |
| `uploadEventImage`, `deleteEventImage`, `getEventImages`, `updateImageMetadata` | `src/app/actions/event-images.ts` |
| `generateEventMarketingLinks`, `getEventMarketingLinks`, `regenerateEventMarketingLinks`, `generateSingleMarketingLink` | `src/app/actions/event-marketing-links.ts` |
| `generateEventSeoContent`, `generateEventPromotionContent` | `src/app/actions/event-content.ts` |

## Private Bookings

| Action | Source File |
|--------|-----------|
| `getPrivateBookings`, `getPrivateBooking`, `createPrivateBooking`, `updatePrivateBooking` | `src/app/actions/privateBookingActions.ts` |
| `updateBookingStatus`, `addPrivateBookingNote`, `deletePrivateBooking` | `src/app/actions/privateBookingActions.ts` |
| `getBookingDeleteEligibility`, `getCancellationPreview`, `getCompletionPreview` | `src/app/actions/privateBookingActions.ts` |
| `recordDepositPayment`, `recordFinalPayment`, `cancelPrivateBooking` | `src/app/actions/privateBookingActions.ts` |
| `extendBookingHold`, `applyBookingDiscount` | `src/app/actions/privateBookingActions.ts` |
| `getPrivateBookingSmsQueue`, `approveSms`, `rejectSms`, `sendApprovedSms` | `src/app/actions/privateBookingActions.ts` |
| `createVenueSpace`, `updateVenueSpace`, `deleteVenueSpace` | `src/app/actions/privateBookingActions.ts` |
| `createCateringPackage`, `updateCateringPackage`, `deleteCateringPackage` | `src/app/actions/privateBookingActions.ts` |
| `getBookingItems`, `addBookingItem`, `updateBookingItem`, `deleteBookingItem`, `reorderBookingItems` | `src/app/actions/privateBookingActions.ts` |
| `createVendor` (PB), `updateVendor` (PB), `deleteVendor` (PB), `getVendors`, `getVendorRate` | `src/app/actions/privateBookingActions.ts` |
| `createDepositPaymentOrder`, `captureDepositPayment` | `src/app/actions/privateBookingActions.ts` |
| `resendCalendarInvite`, `getBookingPortalLink`, `sendDepositPaymentLink` | `src/app/actions/privateBookingActions.ts` |
| `editPrivateBookingPayment`, `deletePrivateBookingPayment` | `src/app/actions/privateBookingActions.ts` |
| `fetchPrivateBookings`, `fetchPrivateBookingsForCalendar` | `src/app/actions/private-bookings-dashboard.ts` |

## Rota & Timeclock

| Action | Source File |
|--------|-----------|
| `getOrCreateRotaWeek`, `getWeekShifts`, `createShift`, `updateShift`, `deleteShift` | `src/app/actions/rota.ts` |
| `markShiftSick`, `reassignShift`, `moveShift` | `src/app/actions/rota.ts` |
| `getEmployeeShifts`, `getOpenShiftsForPortal` | `src/app/actions/rota.ts` |
| `autoPopulateWeekFromTemplates`, `addShiftsFromTemplates` | `src/app/actions/rota.ts` |
| `getActiveEmployeesForRota`, `getLeaveDaysForWeek` | `src/app/actions/rota.ts` |
| `publishRotaWeek`, `resyncRotaCalendar` | `src/app/actions/rota.ts` |
| `getShiftTemplates`, `createShiftTemplate`, `updateShiftTemplate`, `deactivateShiftTemplate` | `src/app/actions/rota-templates.ts` |
| `getRotaSettings`, `updateRotaSettings` | `src/app/actions/rota-settings.ts` |
| `getRotaWeekDayInfo` | `src/app/actions/rota-day-info.ts` |
| `clockIn`, `clockOut`, `getOpenSessions` | `src/app/actions/timeclock.ts` |
| `getTimeclockSessionsForWeek`, `createTimeclockSession`, `updateTimeclockSession` | `src/app/actions/timeclock.ts` |
| `approveTimeclockSession`, `deleteTimeclockSession` | `src/app/actions/timeclock.ts` |

## Leave

| Action | Source File |
|--------|-----------|
| `submitLeaveRequest`, `reviewLeaveRequest`, `bookApprovedHoliday` | `src/app/actions/leave.ts` |
| `getLeaveRequests`, `getHolidayUsage`, `getLeaveRequestById` | `src/app/actions/leave.ts` |
| `deleteLeaveRequest`, `updateLeaveRequestDates` | `src/app/actions/leave.ts` |

## Payroll

| Action | Source File |
|--------|-----------|
| `getOrCreatePayrollPeriod`, `updatePayrollPeriod`, `getPayrollMonthData` | `src/app/actions/payroll.ts` |
| `approvePayrollMonth`, `sendPayrollEmail` | `src/app/actions/payroll.ts` |
| `upsertShiftNote`, `updatePayrollRowTimes`, `deletePayrollRow` | `src/app/actions/payroll.ts` |
| `getPayAgeBands`, `createPayAgeBand`, `getPayBandRates`, `addPayBandRate` | `src/app/actions/pay-bands.ts` |
| `getEmployeePaySettings`, `upsertEmployeePaySettings` | `src/app/actions/pay-bands.ts` |
| `getEmployeeRateOverrides`, `addEmployeeRateOverride` | `src/app/actions/pay-bands.ts` |

## Invoices & Quotes

| Action | Source File |
|--------|-----------|
| `getInvoices`, `getInvoice`, `createInvoice`, `updateInvoice` | `src/app/actions/invoices.ts` |
| `updateInvoiceStatus`, `deleteInvoice`, `getInvoiceSummary` | `src/app/actions/invoices.ts` |
| `getLineItemCatalog`, `createCatalogItem`, `updateCatalogItem`, `deleteCatalogItem` | `src/app/actions/invoices.ts` |
| `recordPayment`, `voidInvoice`, `createCreditNote` | `src/app/actions/invoices.ts` |
| `getRecurringInvoices`, `getRecurringInvoice`, `createRecurringInvoice`, `updateRecurringInvoice` | `src/app/actions/recurring-invoices.ts` |
| `deleteRecurringInvoice`, `generateInvoiceFromRecurring`, `toggleRecurringInvoiceStatus` | `src/app/actions/recurring-invoices.ts` |
| `getQuoteSummary`, `getQuotes`, `getQuote`, `createQuote`, `updateQuote` | `src/app/actions/quotes.ts` |
| `updateQuoteStatus`, `deleteQuote`, `convertQuoteToInvoice` | `src/app/actions/quotes.ts` |

## Employees

| Action | Source File |
|--------|-----------|
| `addEmployee`, `updateEmployee`, `deleteEmployee`, `getEmployeeList` | `src/app/actions/employeeActions.ts` |
| `addEmployeeNote`, `createRightToWorkDocumentUploadUrl`, `addEmployeeAttachment` | `src/app/actions/employeeActions.ts` |
| `getAttachmentSignedUrl`, `deleteEmployeeAttachment` | `src/app/actions/employeeActions.ts` |
| `addEmergencyContact`, `updateEmergencyContact`, `deleteEmergencyContact` | `src/app/actions/employeeActions.ts` |
| `upsertFinancialDetails`, `upsertHealthRecord`, `upsertRightToWork` | `src/app/actions/employeeActions.ts` |
| `getRightToWorkPhotoUrl`, `deleteRightToWorkPhoto` | `src/app/actions/employeeActions.ts` |
| `updateOnboardingChecklist`, `getOnboardingProgress` | `src/app/actions/employeeActions.ts` |
| `getEmployeeDetailData`, `getEmployeeEditData` | `src/app/actions/employeeDetails.ts` |
| `getEmployeesRoster` | `src/app/actions/employeeQueries.ts` |
| `inviteEmployee`, `sendPortalInvite`, `resendInvite` | `src/app/actions/employeeInvite.ts` |
| `validateInviteToken`, `createEmployeeAccount`, `saveOnboardingSection` | `src/app/actions/employeeInvite.ts` |
| `submitOnboardingProfile`, `beginSeparation`, `revokeEmployeeAccess` | `src/app/actions/employeeInvite.ts` |
| `exportEmployees` | `src/app/actions/employeeExport.ts` |
| `sendBirthdayReminders`, `getUpcomingBirthdays`, `getAllBirthdays` | `src/app/actions/employee-birthdays.ts` |
| `getEmployeeChangesSummary`, `restoreEmployeeVersion`, `compareEmployeeVersions` | `src/app/actions/employee-history.ts` |

## Receipts, Expenses, Mileage & MGD

| Action | Source File |
|--------|-----------|
| `getReceiptWorkspaceData`, `getReceiptBulkReviewData`, `getReceiptSignedUrl` | `src/app/actions/receipts.ts` |
| `getMonthlyReceiptSummary`, `getMonthlyReceiptInsights`, `getReceiptVendorSummary` | `src/app/actions/receipts.ts` |
| `getReceiptVendorMonthTransactions`, `getReceiptMissingExpenseSummary`, `getAIUsageBreakdown` | `src/app/actions/receipts.ts` |
| `importReceiptStatement`, `markReceiptTransaction`, `updateReceiptClassification` | `src/app/actions/receipts.ts` |
| `uploadReceiptForTransaction`, `deleteReceiptFile` | `src/app/actions/receipts.ts` |
| `createReceiptRule`, `updateReceiptRule`, `toggleReceiptRule`, `deleteReceiptRule` | `src/app/actions/receipts.ts` |
| `previewReceiptRule`, `applyReceiptGroupClassification`, `createReceiptRuleFromGroup` | `src/app/actions/receipts.ts` |
| `requeueUnclassifiedTransactions`, `runReceiptRuleRetroactivelyStep`, `finalizeReceiptRuleRetroRun`, `runReceiptRuleRetroactively` | `src/app/actions/receipts.ts` |
| `getExpenses`, `getExpenseStats`, `createExpense`, `updateExpense`, `deleteExpense` | `src/app/actions/expenses.ts` |
| `uploadExpenseFile`, `deleteExpenseFile`, `getExpenseFiles`, `getExpenseInsights` | `src/app/actions/expenses.ts` |
| `getDestinations`, `getTrips`, `getTripStats`, `getDistanceCache` | `src/app/actions/mileage.ts` |
| `createDestination`, `updateDestination`, `deleteDestination` | `src/app/actions/mileage.ts` |
| `createTrip`, `updateTrip`, `deleteTrip`, `getMileageInsights` | `src/app/actions/mileage.ts` |
| `getCollections`, `getReturns`, `getCurrentReturn` | `src/app/actions/mgd.ts` |
| `createCollection`, `updateCollection`, `deleteCollection` | `src/app/actions/mgd.ts` |
| `updateReturnStatus`, `getMgdInsights` | `src/app/actions/mgd.ts` |
| `getPlDashboardData`, `savePlTargetsAction`, `savePlManualActualsAction` | `src/app/actions/pnl.ts` |

## SMS & Messages

| Action | Source File |
|--------|-----------|
| `sendOTPMessage`, `sendSms`, `sendBulkSMSAsync` | `src/app/actions/sms.ts` |
| `sendBulkSMSDirect` | `src/app/actions/sms-bulk-direct.ts` |
| `fetchBulkRecipients`, `sendBulkMessages` | `src/app/actions/bulk-messages.ts` |
| `getMessages`, `getUnreadMessageCount`, `getConversationMessages` | `src/app/actions/messagesActions.ts` |
| `markMessageAsRead`, `markAllMessagesAsRead`, `markConversationAsRead`, `markConversationAsUnread` | `src/app/actions/messagesActions.ts` |
| `getUnreadMessageCounts`, `getTotalUnreadCount`, `markMessagesAsRead`, `sendSmsReply` | `src/app/actions/messageActions.ts` |
| `listMessageTemplates`, `createMessageTemplate`, `updateMessageTemplate`, `deleteMessageTemplate`, `toggleMessageTemplate` | `src/app/actions/messageTemplates.ts` |
| `diagnoseMessages` | `src/app/actions/diagnose-messages.ts` |
| `importMissedMessages` | `src/app/actions/import-messages.ts` |

## Parking

| Action | Source File |
|--------|-----------|
| `createParkingBooking`, `listParkingBookings`, `getParkingBookingNotifications` | `src/app/actions/parking.ts` |
| `getParkingRateConfig`, `getParkingBookingById`, `updateParkingBookingStatus` | `src/app/actions/parking.ts` |
| `generateParkingPaymentLink`, `markParkingBookingPaid` | `src/app/actions/parking.ts` |

## Cashing Up

| Action | Source File |
|--------|-----------|
| `getSessionByIdAction`, `upsertSessionAction`, `submitSessionAction` | `src/app/actions/cashing-up.ts` |
| `approveSessionAction`, `lockSessionAction`, `unlockSessionAction` | `src/app/actions/cashing-up.ts` |
| `getWeeklyDataAction`, `getDashboardDataAction`, `getInsightsDataAction` | `src/app/actions/cashing-up.ts` |
| `getDailyTargetAction`, `setDailyTargetAction`, `updateWeeklyTargetsAction`, `getWeeklyProgressAction` | `src/app/actions/cashing-up.ts` |
| `importCashupHistoryAction` | `src/app/actions/cashing-up-import.ts` |
| `getMissingCashupDatesAction` | `src/app/actions/missing-cashups.ts` |
| `getDailySummaryAction` | `src/app/actions/daily-summary.ts` |

## OJ Projects

| Action | Source File |
|--------|-----------|

[truncated at line 200 — original has 289 lines]
```

### `scripts/one-off/correction-send.ts`

```
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
const FROM = process.env.TWILIO_PHONE_NUMBER!

const recipients = [
  { name: 'Adam', phone: '+447434961614' },
  { name: 'Aimee', phone: '+447860640494' },
  { name: 'Alison', phone: '+447538720758' },
  { name: 'Alison', phone: '+447956953289' },
  { name: 'Amber', phone: '+447508715297' },
  { name: 'Andy', phone: '+447834905435' },
  { name: 'Beata', phone: '+447526572087' },
  { name: 'Brooke', phone: '+447510715341' },
  { name: 'Cheena', phone: '+447392997030' },
  { name: 'Donna', phone: '+447947248805' },
  { name: 'Emily', phone: '+447765338138' },
  { name: 'Jacqui', phone: '+447914398101' },
  { name: 'Jordan', phone: '+447891505037' },
  { name: 'Josie', phone: '+447861774496' },
  { name: 'Kylie', phone: '+447827813640' },
  { name: 'Lara', phone: '+447359148716' },
  { name: 'Lauren', phone: '+447305866052' },
  { name: 'Lisa', phone: '+447540301040' },
  { name: 'Louise', phone: '+447464029798' },
  { name: 'Mark', phone: '+447561329418' },
  { name: 'Mary', phone: '+447719989051' },
  { name: 'Mary', phone: '+447957252906' },
  { name: 'Moureen', phone: '+447586282882' },
  { name: 'Myrtle', phone: '+447805988710' },
  { name: 'Paul', phone: '+447787815721' },
  { name: 'Ronnie', phone: '+447863230107' },
  { name: 'Rosie', phone: '+447979507926' },
  { name: 'Sarah', phone: '+447988517062' },
  { name: 'Sian', phone: '+447951172396' },
  { name: 'Stacey', phone: '+447872983493' },
  { name: 'Stacey', phone: '+447895200732' },
  { name: 'Sylvia', phone: '+447895504024' },
]

const BODY = 'Oops — Music Bingo is Friday! Reply with how many seats.'

async function main() {
  console.log(`Sending correction to ${recipients.length} recipients...`)
  let sent = 0, errors = 0

  for (const r of recipients) {
    try {
      const msg = await twilioClient.messages.create({ to: r.phone, from: FROM, body: BODY })

      // Log in messages table
      const { data: cust } = await db.from('customers').select('id').eq('mobile_e164', r.phone).limit(1).maybeSingle()
      if (cust) {
        await db.from('messages').insert({
          customer_id: cust.id,
          direction: 'outbound',
          message_sid: msg.sid,
          body: BODY,
          status: 'sent',
          twilio_status: 'sent',
          from_number: '+447700106752',
          to_number: r.phone,
          message_type: 'sms',
          template_key: 'event_manual_promo_correction',
          sent_at: new Date().toISOString(),
          segments: 1,
        })
      }

      console.log(`  SENT ${r.name} — ${msg.sid}`)
      sent++
    } catch (err: any) {
      console.log(`  ERROR ${r.name} — ${err.message}`)
      errors++
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  console.log(`\nDone. Sent: ${sent}, Errors: ${errors}`)
}

main().catch(console.error)
```

### `scripts/one-off/send-music-bingo-promo-2026-04-20.ts`

```
/**
 * One-off: Send Music Bingo 24 Apr promo to manual list.
 * Run: npx tsx scripts/one-off/send-music-bingo-promo-2026-04-20.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID!
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN!
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER!

const EVENT_ID = '89f35974-94f7-4faa-810a-14cc6daa4ef2'
const TEMPLATE_KEY = 'event_manual_promo_3d'

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN)

// Recipients after dedup (excluded: Rob Trowbridge, Gabriel Lacatus, Lorraine,
// Luke Phillips, Mandy Jones, Penny Gibbons, Rani)
const recipients = [
  { name: 'Adam', phone: '+447434961614' },
  { name: 'Aimee', phone: '+447860640494' },
  { name: 'Alison', phone: '+447538720758' },
  { name: 'Alison', phone: '+447956953289' },
  { name: 'Amber', phone: '+447508715297' },
  { name: 'Andy', phone: '+447834905435' },
  { name: 'Beata', phone: '+447526572087' },
  { name: 'Brooke', phone: '+447510715341' },
  { name: 'Cheena', phone: '+447392997030' },
  { name: 'Donna', phone: '+447947248805' },
  { name: 'Emily', phone: '+447765338138' },
  { name: 'Jacqui', phone: '+447914398101' },
  { name: 'Jordan', phone: '+447891505037' },
  { name: 'Josie', phone: '+447861774496' },
  { name: 'Kylie', phone: '+447827813640' },
  { name: 'Lara', phone: '+447359148716' },
  { name: 'Lauren', phone: '+447305866052' },
  { name: 'Lisa', phone: '+447540301040' },
  { name: 'Louise', phone: '+447464029798' },
  { name: 'Mark', phone: '+447561329418' },
  { name: 'Mary', phone: '+447719989051' },
  { name: 'Mary', phone: '+447957252906' },
  { name: 'Moureen', phone: '+447586282882' },
  { name: 'Myrtle', phone: '+447805988710' },
  { name: 'Paul', phone: '+447787815721' },
  { name: 'Ronnie', phone: '+447863230107' },
  { name: 'Rosie', phone: '+447979507926' },
  { name: 'Sarah', phone: '+447988517062' },
  { name: 'Sian', phone: '+447951172396' },
  { name: 'Stacey', phone: '+447872983493' },
  { name: 'Stacey', phone: '+447895200732' },
  { name: 'Sylvia', phone: '+447895504024' },
]

function buildMessage(firstName: string): string {
  return `The Anchor: ${firstName}! Music Bingo is this Thursday! Still got seats — reply with how many and you're in! Offer open 48hrs.`
}

async function findCustomerByPhone(phone: string): Promise<string | null> {
  const { data } = await db
    .from('customers')
    .select('id')
    .eq('mobile_e164', phone)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

async function main() {
  console.log(`Sending Music Bingo promo to ${recipients.length} recipients...`)
  let sent = 0
  let skipped = 0
  let errors = 0

  for (const r of recipients) {
    const customerId = await findCustomerByPhone(r.phone)
    if (!customerId) {
      console.log(`  SKIP ${r.name} (${r.phone}) — not found in customers table`)
      skipped++
      continue
    }

    const body = buildMessage(r.name)

    try {
      const msg = await twilioClient.messages.create({
        to: r.phone,
        from: TWILIO_FROM,
        body,
      })

      // Record in sms_promo_context for reply-to-book + dedup tracking
      await db.from('sms_promo_context').insert({
        customer_id: customerId,
        phone_number: r.phone,
        event_id: EVENT_ID,
        template_key: TEMPLATE_KEY,
        message_id: null,
        reply_window_expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        booking_created: false,
      })

      console.log(`  SENT ${r.name} (${r.phone}) — SID: ${msg.sid}`)
      sent++
    } catch (err: any) {
      console.log(`  ERROR ${r.name} (${r.phone}) — ${err.message}`)
      errors++
    }

    // Small delay between sends (100ms)
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  console.log(`\nDone. Sent: ${sent}, Skipped: ${skipped}, Errors: ${errors}`)
}

main().catch(console.error)
```

### `src/app/actions/privateBookingActions.ts`

```
'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSimplePayPalOrder, capturePayPalPayment, getPayPalOrder } from '@/lib/paypal'
import { logger } from '@/lib/logger'
import { checkUserPermission } from '@/app/actions/rbac'
import { generateBookingToken } from '@/lib/private-bookings/booking-token'
import { revalidatePath, revalidateTag } from 'next/cache'
import { z } from 'zod'
import { getErrorMessage } from '@/lib/errors'
import type {
  PrivateBookingWithDetails,
  BookingStatus,
} from '@/types/private-bookings'
import type { User as SupabaseUser } from '@supabase/supabase-js'

import { toLocalIsoDate } from '@/lib/dateUtils'
import { sanitizeMoneyString } from '@/lib/utils'
import { logAuditEvent } from './audit'
import {
  PrivateBookingService,
  privateBookingSchema,
  bookingNoteSchema,
  formatTimeToHHMM,
  ALLOWED_VENDOR_TYPES,
  CreatePrivateBookingInput,
  UpdatePrivateBookingInput,
  updateBalancePayment,
  deleteBalancePayment,
  updateDeposit,
  updateDepositAmount,
  deleteDeposit,
} from '@/services/private-bookings'
import { SmsQueueService } from '@/services/sms-queue' // Still needed for SMS actions
import { sendBookingCalendarInvite, sendDepositPaymentLinkEmail } from '@/lib/email/private-booking-emails'

// Helper function to extract string values from FormData
const getString = (formData: FormData, key: string): string | undefined => {
  const value = formData.get(key)
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim()
  }
  return undefined
}

function normalizeActionError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function logPrivateBookingActionError(
  message: string,
  error: unknown,
  metadata?: Record<string, unknown>
): void {
  logger.error(message, {
    error: normalizeActionError(error),
    metadata
  })
}

// Helper function that preserves empty strings (used to allow clearing optional fields)
const getStringAllowEmpty = (formData: FormData, key: string): string | undefined => {
  const value = formData.get(key)
  if (typeof value !== 'string') {
    return undefined
  }
  return value.trim()
}

const editBalancePaymentSchema = z.object({
  paymentId: z.string().uuid(),
  bookingId: z.string().uuid(),
  type: z.literal('balance'),
  amount: z.string().refine(v => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
    message: 'Amount must be greater than £0',
  }),
  method: z.enum(['cash', 'card', 'invoice']),
  notes: z.string().max(500).optional(),
})

const editDepositSchema = z.object({
  bookingId: z.string().uuid(),
  type: z.literal('deposit'),
  amount: z.string().refine(v => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
    message: 'Amount must be greater than £0',
  }),
  method: z.enum(['cash', 'card', 'invoice']),
})

const deletePaymentSchema = z.object({
  // DELIBERATE: paymentId can be 'deposit' (not a UUID) so z.string() not z.string().uuid()
  paymentId: z.string(),
  type: z.enum(['deposit', 'balance']),
  bookingId: z.string().uuid(),
})

type PrivateBookingsManageAction =
  | 'manage_catering'
  | 'manage_spaces'
  | 'manage_vendors'

type PrivateBookingsPermissionResult =
  | { error: string }
  | { user: SupabaseUser; admin: ReturnType<typeof createAdminClient> }

// This helper remains in the action, managing permission checks and user context
async function requirePrivateBookingsPermission(
  action: PrivateBookingsManageAction
): Promise<PrivateBookingsPermissionResult> {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Use PermissionService here if it were available
  const canManage = await checkUserPermission('private_bookings', action); // Using existing checkUserPermission
  if (!canManage) {
    return { error: 'Insufficient permissions' };
  }
  const admin = createAdminClient();
  return { user, admin };
}


// Get all private bookings with optional filtering (this should use PrivateBookingService.getBookings)
export async function getPrivateBookings(filters?: {
  status?: BookingStatus
  fromDate?: string
  toDate?: string
  customerId?: string
}) {
  try {
    const hasPermission = await checkUserPermission('private_bookings', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view private bookings' };
    }
    const { data } = await PrivateBookingService.getBookings(filters);
    return { data };
  } catch (error: unknown) {
    logPrivateBookingActionError('Error fetching private bookings:', error);
    return { error: getErrorMessage(error) };
  }
}

// Get single private booking by ID
export async function getPrivateBooking(
  id: string,
  variant: 'detail' | 'edit' | 'items' | 'messages' = 'detail'
) {
  const canView = await checkUserPermission('private_bookings', 'view')
  if (!canView) {
    return { error: 'You do not have permission to view private bookings' }
  }

  try {
    const data =
      variant === 'edit'
        ? await PrivateBookingService.getBookingByIdForEdit(id)
        : variant === 'items'
          ? await PrivateBookingService.getBookingByIdForItems(id)
          : variant === 'messages'
            ? await PrivateBookingService.getBookingByIdForMessages(id)
            : await PrivateBookingService.getBookingById(id)
    return { data };
  } catch (error: unknown) {
    logPrivateBookingActionError('Error fetching private booking:', error);
    return { error: getErrorMessage(error) };
  }
}

// Create a new private booking
export async function createPrivateBooking(formData: FormData) {
  try {
    const supabase = await createClient()
    const isDateTbd = formData.get('date_tbd') === 'true'

    const rawData = {
      customer_first_name: (getString(formData, 'customer_first_name') || '').trim(),
      customer_last_name: getString(formData, 'customer_last_name'),
      customer_id: getString(formData, 'customer_id'),
      default_country_code: getString(formData, 'default_country_code'),
      contact_phone: getString(formData, 'contact_phone'),
      contact_email: getString(formData, 'contact_email'),
      event_date: getString(formData, 'event_date'),
      start_time: getString(formData, 'start_time') ? formatTimeToHHMM(getString(formData, 'start_time')) : undefined,
      setup_date: getString(formData, 'setup_date'),
      setup_time: getString(formData, 'setup_time') ? formatTimeToHHMM(getString(formData, 'setup_time')) : undefined,
      end_time: getString(formData, 'end_time') ? formatTimeToHHMM(getString(formData, 'end_time')) : undefined,
      guest_count: (() => {
        const value = getString(formData, 'guest_count')
        return value ? parseInt(value, 10) : undefined
      })(),
      event_type: getString(formData, 'event_type'),
      internal_notes: getString(formData, 'internal_notes'),
      contract_note: getString(formData, 'contract_note'),

[truncated at line 200 — original has 2195 lines]
```

### `src/services/private-bookings/mutations.ts`

```
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatPhoneForStorage } from '@/lib/utils';
import { toLocalIsoDate } from '@/lib/dateUtils';
import { SmsQueueService } from '@/services/sms-queue';
import { syncCalendarEvent, deleteCalendarEvent, isCalendarConfigured } from '@/lib/google-calendar';
import { recordAnalyticsEvent } from '@/lib/analytics/events';
import { logAuditEvent } from '@/app/actions/audit';
import { ensureCustomerForPhone } from '@/lib/sms/customers';
import { logger } from '@/lib/logger';
import {
  sendBookingConfirmationEmail,
  sendBookingCalendarInvite,
} from '@/lib/email/private-booking-emails';
import type {
  BookingStatus,
  PrivateBookingWithDetails,
} from '@/types/private-bookings';
import {
  type CreatePrivateBookingInput,
  type UpdatePrivateBookingInput,
  type PrivateBookingSmsSideEffectSummary,
  normalizeSmsSafetyMeta,
  toNumber,
  computeHoldExpiry,
  DATE_TBD_NOTE,
  DEFAULT_TBD_TIME,
} from './types';
import {
  privateBookingCreatedMessage,
  bookingConfirmedMessage,
  setupReminderMessage,
  dateChangedMessage,
  bookingCompletedThanksMessage,
  bookingExpiredMessage,
  holdExtendedMessage,
  bookingCancelledHoldMessage,
  bookingCancelledRefundableMessage,
  bookingCancelledNonRefundableMessage,
  bookingCancelledManualReviewMessage,
} from '@/lib/private-bookings/messages';
import {
  getPrivateBookingCancellationOutcome,
  type CancellationFinancialOutcome,
} from '@/services/private-bookings/financial';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

 
async function sendCreationSms(booking: any, phone?: string | null): Promise<void> {
  const eventDateReadable = new Date(booking.event_date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const depositAmount = toNumber(booking.deposit_amount);

  // Calculate hold expiry (14 days from creation)
  const holdExpiryDate = booking.hold_expiry ? new Date(booking.hold_expiry) : new Date();
  const expiryReadable = holdExpiryDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long'
  });

  const smsMessage = privateBookingCreatedMessage({
    customerFirstName: booking.customer_first_name,
    eventDate: eventDateReadable,
    depositAmount: depositAmount,
    holdExpiry: expiryReadable,
  });

  try {
    const result = await SmsQueueService.queueAndSend({
      booking_id: booking.id,
      trigger_type: 'booking_created',
      template_key: 'private_booking_created',
      message_body: smsMessage,
      customer_phone: phone ?? undefined,
      customer_name: booking.customer_name,
      customer_id: booking.customer_id,
      created_by: booking.created_by,
      priority: 2,
      metadata: {
        template: 'private_booking_created',
        first_name: booking.customer_first_name,
        event_date: eventDateReadable,
        deposit_amount: depositAmount
      }
    });

    const smsSafety = normalizeSmsSafetyMeta(result)
    if (smsSafety.logFailure) {
      logger.error('Private booking created SMS logging failed', {
        metadata: {
          bookingId: booking.id,
          triggerType: 'booking_created',
          templateKey: 'private_booking_created',
          code: smsSafety.code
        }
      })
    }

    if (typeof result?.error === 'string') {
      logger.error('Private booking created SMS queue/send failed', {
        metadata: {
          bookingId: booking.id,
          triggerType: 'booking_created',
          templateKey: 'private_booking_created',
          error: result.error
        }
      })
    }
  } catch (smsError) {
    logger.error('Failed to queue booking created SMS after booking creation:', { error: smsError instanceof Error ? smsError : new Error(String(smsError)) });
  }
}

type CancellationSmsVariant = {
  triggerType:
    | 'booking_cancelled_hold'
    | 'booking_cancelled_refundable'
    | 'booking_cancelled_non_refundable'
    | 'booking_cancelled_manual_review'
  templateKey:
    | 'private_booking_cancelled_hold'
    | 'private_booking_cancelled_refundable'
    | 'private_booking_cancelled_non_refundable'
    | 'private_booking_cancelled_manual_review'
  messageBody: string
  outcome: CancellationFinancialOutcome
  refundAmount: number
  retainedAmount: number
}

/**
 * Resolve the cancellation SMS variant for a booking from its financial
 * outcome. Returns the trigger/template keys and the rendered message body
 * so `cancelBooking()` and the status-change cancel path in `updateBooking()`
 * can queue a single variant-specific SMS instead of the generic
 * `booking_cancelled` placeholder that Wave 2 left in place.
 */
async function resolveCancellationSmsVariant(input: {
  bookingId: string
  customerFirstName: string | null | undefined
  eventDate: string
}): Promise<CancellationSmsVariant> {
  const outcome = await getPrivateBookingCancellationOutcome(input.bookingId)

  switch (outcome.outcome) {
    case 'no_money':
      return {
        triggerType: 'booking_cancelled_hold',
        templateKey: 'private_booking_cancelled_hold',
        messageBody: bookingCancelledHoldMessage({
          customerFirstName: input.customerFirstName,
          eventDate: input.eventDate,
        }),
        outcome: outcome.outcome,
        refundAmount: outcome.refund_amount,
        retainedAmount: outcome.retained_amount,
      }
    case 'refundable':
      return {
        triggerType: 'booking_cancelled_refundable',
        templateKey: 'private_booking_cancelled_refundable',
        messageBody: bookingCancelledRefundableMessage({
          customerFirstName: input.customerFirstName,
          eventDate: input.eventDate,
          refundAmount: outcome.refund_amount,
        }),
        outcome: outcome.outcome,
        refundAmount: outcome.refund_amount,
        retainedAmount: outcome.retained_amount,
      }
    case 'non_refundable_retained':
      return {
        triggerType: 'booking_cancelled_non_refundable',
        templateKey: 'private_booking_cancelled_non_refundable',
        messageBody: bookingCancelledNonRefundableMessage({
          customerFirstName: input.customerFirstName,
          eventDate: input.eventDate,
          retainedAmount: outcome.retained_amount,
        }),
        outcome: outcome.outcome,
        refundAmount: outcome.refund_amount,
        retainedAmount: outcome.retained_amount,
      }
    case 'manual_review':
    default:
      return {
        triggerType: 'booking_cancelled_manual_review',
        templateKey: 'private_booking_cancelled_manual_review',
        messageBody: bookingCancelledManualReviewMessage({
          customerFirstName: input.customerFirstName,
          eventDate: input.eventDate,
        }),
        outcome: 'manual_review',

[truncated at line 200 — original has 2343 lines]
```

### `supabase/.temp/gotrue-version`

```
v2.188.1```

### `supabase/.temp/storage-version`

```
v1.54.0```

### `supabase/migrations/20260623000000_allow_delete_cancelled_bookings.sql`

```
-- Allow hard-delete of cancelled private bookings.
--
-- The original prevent_hard_delete_when_sms_sent() trigger blocks deletion
-- when SMS has been sent, telling the admin to "cancel instead". But for
-- bookings that are already cancelled, the customer has been notified —
-- the SMS gate should not prevent cleanup.

BEGIN;

CREATE OR REPLACE FUNCTION prevent_hard_delete_when_sms_sent()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow deletion of cancelled bookings — customer already notified
  IF OLD.status = 'cancelled' THEN
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1 FROM private_booking_sms_queue
    WHERE booking_id = OLD.id
      AND (status = 'sent'
           OR (status = 'approved' AND scheduled_for IS NOT NULL AND scheduled_for > now()))
  ) THEN
    RAISE EXCEPTION 'Cannot hard-delete booking %: SMS already sent or scheduled. Use cancelBooking instead.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION prevent_hard_delete_when_sms_sent() IS
  'Blocks hard-delete of private_bookings that have sent or scheduled-future SMS. '
  'Rule: cancelled bookings are always deletable; status=sent blocks; '
  'status=approved AND scheduled_for>now() blocks. '
  'Other statuses (pending/cancelled/failed) do NOT block.';

COMMIT;
```

### `tasks/database-schema.md`

```
# Database Schema — OJ-AnchorManagementTools

> Generated 2026-04-23 from `supabase/migrations/`. Base: `20251123120000_squashed.sql` + all post-squash migrations.

---

## Enum Types

| Type | Values |
|------|--------|
| `table_booking_type` | `regular`, `sunday_lunch` |
| `table_booking_status` | `pending_payment`, `confirmed`, `cancelled`, `no_show`, `completed` |
| `payment_status` | `pending`, `completed`, `failed`, `refunded`, `partial_refund` |
| `booking_item_type` | `main`, `side`, `extra` |
| `parking_booking_status` | `pending_payment`, `confirmed`, `completed`, `cancelled`, `expired` |
| `parking_payment_status` | `pending`, `paid`, `refunded`, `failed`, `expired` |
| `parking_notification_channel` | `sms`, `email` |
| `parking_notification_event` | parking lifecycle events |
| `receipt_transaction_status` | `pending`, `completed`, `auto_completed`, `no_receipt_required` |
| `menu_unit` | weight/volume units |
| `menu_storage_type` | fridge/freezer/ambient etc. |

---

## Core Domain Tables

### `customers`
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| first_name | text | NO | — |
| last_name | text | NO | — |
| mobile_number | text | NO | — |
| sms_opt_in | boolean | YES | true |
| sms_delivery_failures | integer | YES | 0 |
| last_sms_failure_reason | text | YES | — |
| last_successful_sms_at | timestamptz | YES | — |
| sms_deactivated_at | timestamptz | YES | — |
| sms_deactivation_reason | text | YES | — |
| messaging_status | text | YES | 'active' |
| last_successful_delivery | timestamptz | YES | — |
| consecutive_failures | integer | YES | 0 |
| total_failures_30d | integer | YES | 0 |
| last_failure_type | text | YES | — |
| created_at | timestamptz | NO | now() |

- **messaging_status** CHECK: `active`, `suspended`, `invalid_number`, `opted_out`
- RLS: enabled. Policies: authenticated read/write.

---

### `employees`
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| employee_id | uuid | NO | gen_random_uuid() |
| first_name | text | NO | — |
| last_name | text | NO | — |
| date_of_birth | date | YES | — |
| address | text | YES | — |
| phone_number | text | YES | — |
| email_address | text | NO | — |
| job_title | text | NO | — |
| employment_start_date | date | NO | — |
| employment_end_date | date | YES | — |
| status | text | NO | 'Active' |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

- **status** CHECK: `Active`, `Former`
- Child tables (all CASCADE on delete): `employee_attachments`, `employee_emergency_contacts`, `employee_financial_details`, `employee_health_records`, `employee_notes`
- Post-squash addition: `secondary_emails text[]` (hiring module)

---

### `events`
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO | — |
| date | date | NO | — |
| time | time | YES | — |
| end_time | time | YES | — |
| capacity | integer | YES | — |
| price | numeric | YES | — |
| description | text | YES | — |
| status | text | YES | — |
| is_published | boolean | YES | false |
| category_id | uuid | YES | — |
| parent_event_id | uuid | YES | — |
| short_link | text | YES | — |
| brief | text | YES | — |
| promotion_copy | text | YES | — |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

- FK: `category_id` → `event_categories(id)` ON DELETE SET NULL
- FK: `parent_event_id` → `events(id)` (self-referential)
- Child tables: `bookings`, `event_faqs`, `event_images`, `event_message_templates`, `event_checklist_statuses`, `event_check_ins`

---

### `bookings`
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | NO | — |
| event_id | uuid | NO | — |
| seats | integer | YES | — |
| notes | text | YES | — |
| created_at | timestamptz | NO | now() |

- FK: `customer_id` → `customers(id)` CASCADE; `event_id` → `events(id)` CASCADE
- CHECK: `seats >= 0`
- Related: `booking_audit`, `booking_reminders`, `booking_time_slots`, `idempotency_keys`

---

### `private_bookings`
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | NO | — |
| event_date | date | NO | — |
| start_time | time | YES | — |
| end_time | time | YES | — |
| guest_count | integer | YES | — |
| status | text | YES | — |
| deposit_amount | numeric | YES | — |
| deposit_paid_date | date | YES | — |
| final_payment_date | date | YES | — |
| balance_due_date | date | YES | — |
| space_id | uuid | YES | — |
| notes | text | YES | — |
| contract_sent_at | timestamptz | YES | — |
| created_by | uuid | YES | — |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| hold_expiry | timestamptz | YES | — |
| cancellation_reason | text | YES | — |
| cancelled_at | timestamptz | YES | — |

- FK: `customer_id` → `customers(id)` RESTRICT; `created_by` → `auth.users(id)`
- Child tables: `private_booking_items`, `private_booking_documents`, `private_booking_audit`, `private_booking_sms_queue`

---

## Messaging

### `messages`
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | NO | — |
| direction | text | NO | — |
| message_sid | text | NO | — |
| body | text | NO | — |
| status | text | NO | — |
| message_type | text | YES | 'sms' |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

- CHECK direction: `inbound`, `outbound`; message_type: `sms`, `mms`, `whatsapp`
- Related: `message_delivery_status`, `message_templates`, `message_template_history`, `event_message_templates`, `reminder_processing_logs`, `booking_reminders`

---

## Table Bookings (Restaurant)

### `table_bookings`
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| booking_type | table_booking_type | NO | 'regular' |
| status | table_booking_status | NO | 'pending_payment' |
| customer_id | uuid | YES | — |
| party_size | integer | NO | — |
| booking_date | date | NO | — |
| booking_time | time | NO | — |
| notes | text | YES | — |
| deposit_amount | numeric | YES | — |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

- Related: `table_booking_items`, `table_booking_payments`, `table_booking_reminder_history`, `table_booking_modifications`, `booking_policies`, `booking_time_slots`, `tables`, `table_combinations`, `table_combination_tables`, `table_areas`, `table_join_groups`, `service_slots`, `service_slot_config`, `service_slot_overrides`

---

## Parking

### `parking_bookings`
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| reference | text | NO | — |
| customer_id | uuid | YES | — |
| customer_first_name | text | NO | — |
| customer_mobile | text | NO | — |
| vehicle_registration | text | NO | — |
| vehicle_make | text | YES | — |
| vehicle_model | text | YES | — |

[truncated at line 200 — original has 439 lines]
```

### `tasks/event-promo-sms-fix-spec.md`

```
# Spec: Fix Event Promotional SMS Pipeline

**Date:** 2026-04-20
**Priority:** HIGH — Music Bingo 24 Apr (4 days out), 9/38 seats booked, no promo SMS since Apr 15.
**Complexity:** M (4 files + 1 migration, moderate logic, schema change)

---

## Problem Statement

The multi-touch event promo SMS pipeline (14d intro → 7d follow-up → 3d follow-up) is broken at two levels:

1. The 14d cross-promo stage stopped producing sends after April 15 due to a PostgREST overload ambiguity error (PGRST203).
2. The 7d and 3d follow-up stages have **never** produced a send due to a type mismatch in the RPC call.
3. The `promo_sequence` tracking table (which connects 14d sends to follow-up eligibility) is empty because it was created after all existing sends occurred, and no new sends have succeeded since.

**Net effect:** Customers receive zero promotional SMS for upcoming events. The system appears healthy (cron runs every 15 min, completes in ~2s, no crashes) because errors are caught and logged as warnings.

---

## Success Criteria

- [ ] 14d cross-promo sends resume for eligible events (both category-match and general-recent pools)
- [ ] 7d follow-up sends fire for customers who received a 14d intro 6–8 days prior
- [ ] 3d follow-up sends fire for customers who received a 14d intro 2–4 days prior
- [ ] Existing safety guards preserved (hourly limit, daily promo limit, frequency cap, dedup)
- [ ] No duplicate sends to customers who already received 14d intros
- [ ] Music Bingo 24 Apr receives 3d follow-up on next cron run after deploy

---

## Scope

### In scope

- Fix `get_cross_promo_audience` overload ambiguity (migration + caller update)
- Fix `get_follow_up_recipients` type mismatch (caller fix)
- Backfill `promo_sequence` from `sms_promo_context` (migration)
- Verification that the pipeline sends correctly post-deploy

### Out of scope

- Manual bulk send for Music Bingo (separate operational action)
- Restoring the removed "interest marketing" system (deliberately removed, red herring)
- Adding dry-run/preview admin tooling (nice-to-have, separate PR)
- Changing the 14-day cleanup window (acceptable as-is)

---

## Technical Design

### Change 1: Migration — Drop stale 5-param overload

**File:** `supabase/migrations/YYYYMMDDHHMMSS_fix_cross_promo_audience_overload.sql`

```sql
-- Drop the original 5-param overload that conflicts with the 6-param version.
-- The 6-param version (from 20260612000000) is the canonical implementation.
-- PostgREST cannot disambiguate when caller passes only 2 named params with defaults.

DROP FUNCTION IF EXISTS public.get_cross_promo_audience(UUID, UUID, INT, INT, INT);

-- Re-grant privileges on the remaining 6-param version (defensive)
REVOKE ALL ON FUNCTION public.get_cross_promo_audience(UUID, UUID, INT, INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cross_promo_audience(UUID, UUID, INT, INT, INT, INT) TO service_role;
```

**Verification:** After applying, confirm only one signature exists:
```sql
SELECT pg_get_function_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname = 'get_cross_promo_audience';
```

### Change 2: Update cross-promo caller to pass all 6 params explicitly

**File:** `src/lib/sms/cross-promo.ts` — line 242

**Before:**
```typescript
const { data: audience, error: audienceError } = await db.rpc('get_cross_promo_audience', {
  p_event_id: event.id,
  p_category_id: event.category_id,
})
```

**After:**
```typescript
const { data: audience, error: audienceError } = await db.rpc('get_cross_promo_audience', {
  p_event_id: event.id,
  p_category_id: event.category_id,
  p_recency_months: 6,
  p_general_recency_months: 3,
  p_frequency_cap_days: 7,
  p_max_recipients: 200,
})
```

**Rationale:** Even after dropping the 5-param version, passing all params explicitly makes the call self-documenting and immune to future overload issues.

### Change 3: Fix follow-up recipients type mismatch

**File:** `src/app/api/cron/event-guest-engagement/route.ts` — line 1647

**Before:**
```typescript
const minGapIso = `${minGapDays} days`
```

**After:**
```typescript
const minGapIso = new Date(Date.now() - minGapDays * 86_400_000).toISOString()
```

**Explanation:** The RPC function `get_follow_up_recipients` declares `p_min_gap_iso TIMESTAMPTZ` and uses it in a comparison: `ps.touch_14d_sent_at <= p_min_gap_iso`. The intent is "only include customers whose 14d touch was sent at least N days ago." Passing a timestamp N days in the past achieves this correctly.

For `minGapDays = 7` (the 7d stage): only customers whose 14d touch was ≥7 days ago.
For `minGapDays = 3` (the 3d stage): only customers whose 14d touch was ≥3 days ago.

Wait — re-reading the call sites:
- `processFollowUps(supabase, '3d', 2, 4, **7**, ...)` — minGapDays=7 for 3d stage
- `processFollowUps(supabase, '7d', 6, 8, **3**, ...)` — minGapDays=3 for 7d stage

This means:
- 7d follow-up: gap of 3 days since 14d touch (customer got 14d touch ≥3 days ago)
- 3d follow-up: gap of 7 days since 14d touch (customer got 14d touch ≥7 days ago)

This makes sense: a customer who got the 14d intro 7+ days ago is now in the 3d window.

### Change 4: Migration — Backfill promo_sequence from sms_promo_context

**File:** `supabase/migrations/YYYYMMDDHHMMSS_backfill_promo_sequence_from_context.sql`

```sql
-- Backfill promo_sequence for events still in the follow-up window.
-- Only creates rows for 14d sends where the event date is still in the future
-- and no promo_sequence row exists yet.

INSERT INTO promo_sequence (customer_id, event_id, audience_type, touch_14d_sent_at)
SELECT
  spc.customer_id,
  spc.event_id,
  'category_match',  -- all historical sends were category-match (general pool didn't exist yet)
  spc.created_at
FROM sms_promo_context spc
JOIN events e ON e.id = spc.event_id
WHERE spc.template_key = 'event_cross_promo_14d'
  AND e.date >= CURRENT_DATE  -- only future events worth following up
  AND NOT EXISTS (
    SELECT 1 FROM promo_sequence ps
    WHERE ps.customer_id = spc.customer_id AND ps.event_id = spc.event_id
  )
ON CONFLICT (customer_id, event_id) DO NOTHING;
```

**Expected result:** Populates promo_sequence for:
- Music Bingo 24 Apr: 7 rows (from Apr 10 sends → touch_14d_sent_at ~10 days ago → eligible for 3d follow-up)
- Bingo 29 Apr: 12 rows (from Apr 15 sends → touch_14d_sent_at ~5 days ago → eligible for 7d follow-up soon)

---

## Blast Radius Analysis

### What fires on first cron run after deploy

| Event | Date | Days out | Stage | Expected recipients |
|-------|------|----------|-------|---------------------|
| Music Bingo | 24 Apr | 4 | 3d follow-up | ~7 (from backfill) |
| Music Bingo | 24 Apr | 4 | 14d cross-promo | 0 (outside 14d window, already sent) |
| Open Mic | 25 Apr | 5 | None | Outside both windows (2–4 and 6–8) |
| Bingo | 29 Apr | 9 | 14d cross-promo | New recipients from general pool (~33) |

**Total estimated outbound:** ≤50 SMS on first run. All dedup-protected.

### Safety guards (unchanged)

- `EVENT_PROMO_HOURLY_SEND_GUARD_LIMIT` — caps hourly sends
- `SMS_SAFETY_GLOBAL_HOURLY_LIMIT` — global Twilio rate limit
- `hasReachedDailyPromoLimit` — per-customer daily cap
- `sms_promo_context` frequency check (7-day cap per customer)
- `promo_sequence` dedup (one row per customer+event)
- Budget counter `MAX_EVENT_PROMOS_PER_RUN` — per-cron-run cap
- Time budget (240s) — prevents Vercel timeout

---

## Migration Risk

**Risk: LOW**

- Drop function is safe — grep confirms single caller at `cross-promo.ts:242`
- Backfill is additive (INSERT with ON CONFLICT DO NOTHING)
- No column changes, no table drops
- Rollback: re-create the 5-param function if needed (SQL saved in migration history)

---

## Verification Plan

### Pre-deploy (local)

[truncated at line 200 — original has 235 lines]
```

### `tasks/event-promo-sms-handoff.md`

```
# Event Promotional SMS — Investigation Handoff

**Date:** 2026-04-20
**Status:** Investigation in progress; partial findings — fix work not started.
**Urgency:** HIGH. Music Bingo runs Fri 24 Apr 2026 (4 days out). Only 9 bookings / 38 seats; no promotional SMS has gone out for it, and the 3-day reminder stage is due today/tomorrow.

---

## Business problem

User asked why no booking-driver SMS has been sent for the 24 Apr 2026 Music Bingo event. Expected behaviour: the system auto-sends promo SMS at 14d / 7d / 3d before eligible events. Observed behaviour: only the 14d stage is firing for *some* events; 7d and 3d stages have never produced sends. For Music Bingo 24 Apr, a 14d intro SMS did go out to ~7 customers on ~10 Apr, but nothing since.

---

## Key entities / IDs

| Thing | Value |
|---|---|
| Supabase URL | `https://tfcasgxopxegwrabvwat.supabase.co` |
| Music Bingo (24 Apr) event id | `89f35974-94f7-4faa-810a-14cc6daa4ef2` |
| Music Bingo category id | `8493fffe-b218-484c-8646-4e28cfd6c2f8` |
| `payment_mode` | `cash_only` (treated as paid for promo paths) |
| Other upcoming events w/ `promo_sms_enabled=true` inside 14d | Open Mic 25 Apr (`31932ac9-…`), Bingo 29 Apr (`bb1fe4c4-…`) |

---

## What the code says it does

Source: [src/app/api/cron/event-guest-engagement/route.ts](src/app/api/cron/event-guest-engagement/route.ts) — runs every 15 min via [vercel.json](vercel.json). Relevant stages (lines 1899–1905):

```ts
const followUp3d = await processFollowUps(supabase, '3d', 2, 4, 7, runStartMs, promoBudget)
const followUp7d = await processFollowUps(supabase, '7d', 6, 8, 3, runStartMs, promoBudget)
const crossPromo = await processCrossPromo(supabase, runStartMs)
```

Cross-promo selection window: `loadUpcomingEventsForPromo` — events with `booking_open=true AND promo_sms_enabled=true AND category_id IS NOT NULL AND date IN (today…today+14d)` ([route.ts:1567–1591](src/app/api/cron/event-guest-engagement/route.ts:1567)).

Follow-up selection window: `loadFollowUpEvents(daysAheadMin, daysAheadMax)` — e.g. 3d stage looks for events 2–4 days away ([route.ts:1593–1623](src/app/api/cron/event-guest-engagement/route.ts:1593)).

Implementation of per-event send lives in [src/lib/sms/cross-promo.ts](src/lib/sms/cross-promo.ts). Uses templates:

- `event_cross_promo_14d` / `event_cross_promo_14d_paid` — 14d intro (past attendees of same category)
- `event_general_promo_14d` / `event_general_promo_14d_paid` — 14d intro (general recent-customer pool)
- `event_reminder_promo_7d` / `event_reminder_promo_7d_paid` — 7d follow-up
- `event_reminder_promo_3d` / `event_reminder_promo_3d_paid` — 3d follow-up

Send path: calls `sendSMS()` direct (not via job queue). Records send in `sms_promo_context` and `promo_sequence` tables.

---

## What is NOT wired up (the commit-0d3ddb0a red herring)

There was a SEPARATE "event interest" (customer opt-in) system that was removed on 2026-02-17 in commit `0d3ddb0a` ("Apply local updates and remove event interest automation"):

- Deleted [src/app/actions/event-interest-audience.ts](src/app/actions/event-interest-audience.ts) (631 lines)
- Gutted 710 lines from the cron
- Left behind a stub at [route.ts:1885–1891](src/app/api/cron/event-guest-engagement/route.ts:1885):

```ts
const marketing = {
  sent: 0, skipped: 0, eventsProcessed: 0,
  disabled: true as const,
  reason: 'interest_marketing_removed' as const,
}
```

**This stub is unrelated to the cross-promo / follow-up system we're trying to fix.** The cross-promo code at lines 1899–1905 runs *after* the stub and is the live marketing pipeline. Do NOT confuse the two. The "interest" system was an earlier opt-in mechanism; cross-promo is audience-based and still active.

---

## Evidence of partial function (Supabase queries)

### `sms_promo_context` shows 14d stage IS firing (last 90 days)
```
Total rows: 41, events: 3
  bb1fe4c4-... (Bingo 29 Apr):          {event_cross_promo_14d: 12}
  89f35974-... (Music Bingo 24 Apr):    {event_cross_promo_14d: 7}
  8ee9a933-...:                          {event_cross_promo_14d: 22}
```

- Only template `event_cross_promo_14d` ever appears — **no 7d, no 3d, no _paid variant, no general_promo variant.**
- Most recent send: `2026-04-15T00:00:43Z`.
- Music Bingo 24 Apr *did* get 7 cross-promo sends (around 10 Apr, the 14d window). User's original framing — "no promos sent" — is slightly wrong; but the 7d (due 17 Apr) and 3d (due 21/22 Apr) stages never fired, which is the bigger problem.

### Direct RPC probing reveals DEFECTS

**Defect 1 — `get_cross_promo_audience` has overloaded signatures that conflict.**
```
PGRST203: Could not choose the best candidate function between:
  public.get_cross_promo_audience(p_event_id, p_category_id, p_recency_months, p_frequency_cap_days, p_max_recipients)
  public.get_cross_promo_audience(p_event_id, p_category_id, p_recency_months, p_general_recency_months, p_frequency_cap_days, p_max_recipients)
```
Current caller at [cross-promo.ts:242](src/lib/sms/cross-promo.ts:242) passes only `{p_event_id, p_category_id}` — matches both overloads, fails at runtime.

Relevant migrations:
- `supabase/migrations/20260404000002_cross_promo_infrastructure.sql` (original 5-param)
- `supabase/migrations/20260404192124_fix_cross_promo_rpc_phone_type.sql` (patch)
- `supabase/migrations/20260612000000_cross_promo_general_audience.sql` (added 6-param variant — DID NOT drop the 5-param)

The 6-param version works fine when called with all params (returned 33 rows for Music Bingo test). The bug is that both versions coexist. Hypothesis: Apr 10 14d sends pre-date the 20260612 migration being applied; after migration landed, ALL calls to this RPC now fail silently — hence the "no sends after 15 Apr" pattern.

**Defect 2 — `get_follow_up_recipients` type mismatch.**
```
22007: invalid input syntax for type timestamp with time zone: "7 days"
```
Caller at [route.ts:1669](src/app/api/cron/event-guest-engagement/route.ts:1669):
```ts
const minGapIso = `${minGapDays} days`      // "7 days"
await supabase.rpc('get_follow_up_recipients',
  { p_event_id, p_touch_type, p_min_gap_iso: minGapIso })
```
Function (in `supabase/migrations/20260613000001_follow_up_recipients_rpc.sql` per grep) declares `p_min_gap_iso timestamptz`, but caller passes an `interval`-style string. Either the caller should pass a timestamp (e.g. `new Date(now - 7*24h).toISOString()`) or the function signature should be changed to `interval`. **This explains why 7d and 3d stages have never produced a send.**

**Other items found:**
- Column `events.max_capacity` does not exist (my test query was wrong — not a real defect).
- `promo_sequence` table exists but I guessed its schema; needs inspection.
- `message_templates` has no `template_key` column — templates for cross-promo must live in the code (verified — cross-promo.ts hard-codes message builders; it doesn't read from a template table).

---

## Eligibility confirmation for Music Bingo 24 Apr

```json
{
  "id": "89f35974-94f7-4faa-810a-14cc6daa4ef2",
  "name": "Music Bingo",
  "date": "2026-04-24",
  "event_status": "scheduled",
  "booking_open": true,
  "bookings_enabled": true,
  "promo_sms_enabled": true,
  "category_id": "8493fffe-b218-484c-8646-4e28cfd6c2f8",
  "payment_mode": "cash_only",
  "capacity": null
}
```

Passes every eligibility filter. `capacity: null` treated as unlimited by code.

---

## Cron health

`cron_job_runs` query for `job_name=event-guest-engagement` returned **zero recent rows**. This is concerning — either results aren't being persisted, or the cron is silently not running. Needs verification by checking Vercel cron logs directly. A fix that depends on "cron runs every 15 min" needs this confirmed first.

---

## Blast radius if all three stages are fixed today

Upcoming events that would be picked up on next cron run (events with `promo_sms_enabled=true`, `booking_open=true`, inside 14d window):

| Event | Date | Days out | Stages that would fire | Audience RPC test |
|---|---|---|---|---|
| Music Bingo | 24 Apr | 4 | 3d follow-up + maybe 14d (gated by `sms_promo_context`) | 33 rows in general-recent pool |
| Open Mic Night | 25 Apr | 5 | 7d+3d boundary (logic says 6-8d for 7d, 2-4d for 3d — Apr 25 fits neither. So actually no follow-up) | untested |
| Bingo | 29 Apr | 9 | 7d follow-up (fits 6-8d) — but wait, 9 days is outside 6-8 too | untested |

Careful: the 3d and 7d windows are narrow — `2≤d≤4` and `6≤d≤8`. Events just outside these ranges will miss their window on the first run after a fix. A one-off backfill script might be needed to cover events that *would* have qualified but didn't due to the bug.

Additionally, the **daily-promo-limit guard** at [cross-promo.ts: hasReachedDailyPromoLimit](src/lib/sms/cross-promo.ts) blocks anyone who got any promo SMS that day. Combined with `sms_promo_context` dedupe, re-running will NOT duplicate existing 14d sends.

---

## Recommended next steps (for the next agent)

### Immediate (today) — unblock Music Bingo 24 Apr

Don't wait for the code fix. Manually send a promo SMS via the bulk-messages UI at `/messages/bulk`. Suggested copy, modelled on the Quiz Night template that converted:
```
Hi {{first_name}}! Music Bingo's back at The Anchor this Friday 24 Apr, 8pm.
Free to join, great tunes, daft prizes. Reply to book your spot.
```
Target audience: customers who attended a past Music Bingo (category match) + recent regulars. Use the bulk-messages RPC-filtered audience.

### Fix path (2–3 PRs)

1. **Fix `get_follow_up_recipients` call** — compute a timestamptz client-side:
   ```ts
   const minGapTs = new Date(Date.now() - minGapDays * 86400_000).toISOString()
   ```
   OR change the function signature to `interval`. Former is lower-risk.

2. **Resolve `get_cross_promo_audience` overload** — drop the 5-param version in a new migration, OR rename the 6-param one and update the caller. Drop is simpler; confirm no other caller depends on the 5-param via grep:
   ```
   grep -rn 'get_cross_promo_audience' src/ supabase/
   ```
   Also update the caller at [cross-promo.ts:242](src/lib/sms/cross-promo.ts:242) to pass all 6 params explicitly so behaviour is deterministic.

3. **Confirm cron is actually running** via Vercel dashboard logs. If not, raise a separate defect.

4. **Backfill / smoke test** — add a tiny admin action (or one-off script) that lets an operator dry-run `processFollowUps` and `processCrossPromo` for a specific event. Produces the planned audience + template preview without sending. Useful to validate post-fix.

5. **Verification** — after deploy, run the cron manually via its HTTP endpoint with `Authorization: Bearer $CRON_SECRET`, confirm non-empty `followUp3d.sent` and no RPC errors in Vercel logs.

### Safety rails before flipping the switch

- Re-enabling sends to **~33 general-recent + N category-match customers** *per eligible event*. At this moment ~3 events queue up. Estimate total outbound: ≤ 200 SMS, all dedup-protected. Acceptable.
- Existing guards already in place: `EVENT_PROMO_HOURLY_SEND_GUARD_LIMIT`, `SMS_SAFETY_GLOBAL_HOURLY_LIMIT`, `hasReachedDailyPromoLimit`. Don't remove.


[truncated at line 200 — original has 244 lines]
```

### `tasks/expenses-backup-2026-04-20T14-45-58-645Z.json`

_(binary or >200KB —   237213 bytes — not embedded)_

### `tasks/lessons.md`

```
# Lessons Learned

<!-- After every correction, Claude adds a rule here to prevent repeating the mistake. -->
<!-- Format: date, mistake pattern, rule to follow going forward. -->
<!-- Review this file at the start of every session. -->

## 2026-04-20: Always verify day-of-week before sending customer-facing messages

**Mistake:** Sent 32 SMS saying "Music Bingo is this Thursday" when April 24 2026 is a Friday. Required a correction message to all recipients.

**Rule:** When composing any customer-facing message that references a day of the week, ALWAYS compute and verify the day programmatically (e.g. `new Date('2026-04-24').toLocaleDateString('en-GB', { weekday: 'long' })`) before sending. Never assume or calculate mentally.
```

## Related Files (grep hints)

These files reference the basenames of changed files. They are hints for verification — not included inline. Read them only if a specific finding requires it.

```
.claude/agents/ui-standards-enforcer.md
.claude/skills/bug-fix.md
.claude/skills/code-review.md
.claude/skills/fix-function/SKILL.md
.claude/skills/techdebt.md
.github/ISSUE_TEMPLATE/audit-critical-validation.md
.review/cashing-up/phase-1/consolidated-defect-log.md
.review/private-bookings/brief.md
.review/private-bookings/phase-1/consolidated-defect-log.md
.review/private-bookings/phase-1/remediation-plan.md
```

## Workspace Conventions (`Cursor/CLAUDE.md`)

```markdown
# CLAUDE.md — Workspace Standards

Shared guidance for Claude Code across all projects. Project-level `CLAUDE.md` files take precedence over this one — always read them first.

## Default Stack

Next.js 15 App Router, React 19, TypeScript (strict), Tailwind CSS, Supabase (PostgreSQL + Auth + RLS), deployed on Vercel.

## Workspace Architecture

21 projects across three brands, plus shared tooling:

| Prefix | Brand | Examples |
|--------|-------|----------|
| `OJ-` | Orange Jelly | AnchorManagementTools, CheersAI2.0, Planner2.0, MusicBingo, CashBingo, QuizNight, The-Anchor.pub, DukesHeadLeatherhead.com, OrangeJelly.co.uk, WhatsAppVideoCreator |
| `GMI-` | GMI | MixerAI2.0 (canonical auth reference), TheCookbook, ThePantry |
| `BARONS-` | Barons | CareerHub, EventHub, BrunchLaunchAtTheStar, StPatricksDay, DigitalExperienceMockUp, WebsiteContent |
| (none) | Shared / test | Test, oj-planner-app |

## Core Principles

**How to think:**
- **Simplicity First** — make every change as simple as possible; minimal code impact
- **No Laziness** — find root causes; no temporary fixes; senior developer standards
- **Minimal Impact** — only touch what's necessary; avoid introducing bugs

**How to act:**
1. **Do ONLY what is asked** — no unsolicited improvements
2. **Ask ONE clarifying question maximum** — if unclear, proceed with safest minimal implementation
3. **Record EVERY assumption** — document in PR/commit messages
4. **One concern per changeset** — if a second concern emerges, park it
5. **Fail safely** — when in doubt, stop and request human approval

### Source of Truth Hierarchy

1. Project-level CLAUDE.md
2. Explicit task instructions
3. Existing code patterns in the project
4. This workspace CLAUDE.md
5. Industry best practices / framework defaults

## Ethics & Safety

AI MUST stop and request explicit approval before:
- Any operation that could DELETE user data or drop DB columns/tables
- Disabling authentication/authorisation or removing encryption
- Logging, sending, or storing PII in new locations
- Changes that could cause >1 minute downtime
- Using GPL/AGPL code in proprietary projects

## Communication

- When the user asks to "remove" or "clean up" something, clarify whether they mean a code change or a database/data cleanup before proceeding
- Ask ONE clarifying question maximum — if still unclear, proceed with the safest interpretation

## Debugging & Bug Fixes

- When fixing bugs, check the ENTIRE application for related issues, not just the reported area — ask: "Are there other places this same pattern exists?"
- When given a bug report: just fix it — don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user

## Code Changes

- Before suggesting new environment variables or database columns, check existing ones first — use `grep` to find existing env vars and inspect the current schema before proposing additions
- One logical change per commit; one concern per changeset

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- One task per subagent for focused execution

### 3. Task Tracking
- Write plan to `tasks/todo.md` with checkable items before starting
- Mark items complete as you go; document results when done

### 4. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules that prevent the same mistake; review lessons at session start

### 5. Verification Before Done
- Never mark a task complete without proving it works
- Run tests, check logs, demonstrate correctness
- Ask yourself: "Would a staff engineer approve this?"
- For non-trivial changes: pause and ask "is there a more elegant way?"

### 6. Codex Integration Hook
Uses OpenAI Codex CLI to audit, test and simulate — catches what Claude misses.

```
when: "running tests OR auditing OR simulating"
do:
  - run_skill(codex-review, target=current_task)
  - compare_outputs(claude_result, codex_result)
  - flag_discrepancies(threshold=medium)
  - merge_best_solution()
```

The full multi-specialist QA review skill lives in `~/.claude/skills/codex-qa-review/`. Trigger with "QA review", "codex review", "second opinion", or "check my work". Deploys four specialist agents (Bug Hunter, Security Auditor, Performance Analyst, Standards Enforcer) into a single prioritised report.

## Common Commands

```bash
npm run dev       # Start development server
npm run build     # Production build
npm run lint      # ESLint (zero warnings enforced)
npm test          # Run tests (Vitest unless noted otherwise)
npm run typecheck # TypeScript type checking (npx tsc --noEmit)
npx supabase db push   # Apply pending migrations (Supabase projects)
```

## Coding Standards

### TypeScript
- No `any` types unless absolutely justified with a comment
- Explicit return types on all exported functions
- Props interfaces must be named (not inline anonymous objects for complex props)
- Use `Promise<{ success?: boolean; error?: string }>` for server action return types

### Frontend / Styling
- Use design tokens only — no hardcoded hex colours in components
- Always consider responsive breakpoints (`sm:`, `md:`, `lg:`)
- No conflicting or redundant class combinations
- Design tokens should live in `globals.css` via `@theme inline` (Tailwind v4) or `tailwind.config.ts`
- **Never use dynamic Tailwind class construction** (e.g., `bg-${color}-500`) — always use static, complete class names due to Tailwind's purge behaviour

### Date Handling
- Always use the project's `dateUtils` (typically `src/lib/dateUtils.ts`) for display
- Never use raw `new Date()` or `.toISOString()` for user-facing dates
- Default timezone: Europe/London
- Key utilities: `getTodayIsoDate()`, `toLocalIsoDate()`, `formatDateInLondon()`

### Phone Numbers
- Always normalise to E.164 format (`+44...`) using `libphonenumber-js`

## Server Actions Pattern

All mutations use `'use server'` functions (typically in `src/app/actions/` or `src/actions/`):

```typescript
'use server';
export async function doSomething(params): Promise<{ success?: boolean; error?: string }> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };
  // ... permission check, business logic, audit log ...
  revalidatePath('/path');
  return { success: true };
}
```

## Database / Supabase

See `.claude/rules/supabase.md` for detailed patterns. Key rules:
- DB columns are `snake_case`; TypeScript types are `camelCase`
- Always wrap DB results with a conversion helper (e.g. `fromDb<T>()`)
- RLS is always on — use service role client only for system/cron operations
- Two client patterns: cookie-based auth client and service-role admin client

### Before Any Database Work
Before making changes to queries, migrations, server actions, or any code that touches the database, query the live schema for all tables involved:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name IN ('relevant_table') ORDER BY ordinal_position;
```
Also check for views referencing those tables — they will break silently if columns change:
```sql
SELECT table_name FROM information_schema.view_table_usage
WHERE table_name IN ('relevant_table');
```

### Migrations
- Always verify migrations don't conflict with existing timestamps
- Test the connection string works before pushing
- PostgreSQL views freeze their column lists — if underlying tables change, views must be recreated
- Never run destructive migrations (DROP COLUMN/TABLE) without explicit approval

## Git Conventions

See `.claude/rules/pr-and-git-standards.md` for full PR templates, branch naming, and reviewer checklists. Key rules:
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Never force-push to `main`
- One logical change per commit
- Meaningful commit messages explaining "why" not just "what"

## Rules Reference

Core rules (always loaded from `.claude/rules/`):

| File | Read when… |
|------|-----------|
| `ui-patterns.md` | Building or modifying UI components, forms, buttons, navigation, or accessibility |
| `testing.md` | Adding, modifying, or debugging tests; setting up test infrastructure |
| `definition-of-ready.md` | Starting any new feature — check requirements are clear before coding |
| `definition-of-done.md` | Finishing any feature — verify all quality gates pass |
| `complexity-and-incremental-dev.md` | Scoping a task that touches 4+ files or involves schema changes |
| `pr-and-git-standards.md` | Creating branches, writing commit messages, or opening PRs |
| `verification-pipeline.md` | Before pushing — run the full lint → typecheck → test → build pipeline |
| `supabase.md` | Any database query, migration, RLS policy, or client usage |

Domain rules (auto-injected from `.claude/docs/` when you edit relevant files):

| File | Domain |
|------|--------|
| `auth-standard.md` | Auth, sessions, middleware, RBAC, CSRF, password reset, invites |
| `background-jobs.md` | Async job queues, Vercel Cron, retry logic |
| `api-key-auth.md` | External API key generation, validation, rotation |
| `file-export.md` | PDF, DOCX, CSV generation and download |
| `rate-limiting.md` | Upstash rate limiting, 429 responses |
| `qr-codes.md` | QR code generation (client + server) |
| `toast-notifications.md` | Sonner toast patterns |
| `email-notifications.md` | Resend email, templates, audit logging |
| `ai-llm.md` | LLM client, prompts, token tracking, vision |
| `payment-processing.md` | Stripe/PayPal two-phase payment flows |
| `data-tables.md` | TanStack React Table v8 patterns |

## Quality Gates

A feature is only complete when it passes the full Definition of Done checklist (`.claude/rules/definition-of-done.md`). At minimum: builds, lints, type-checks, tests pass, no hardcoded secrets, auth checks in place, code commented where complex.
```

## Project Conventions (`CLAUDE.md`)

```markdown
# CLAUDE.md — Anchor Management Tools

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions (stack, TypeScript rules, Supabase patterns, etc.).

## Quick Profile

```yaml
framework: Next.js 15 App Router + React 19
test_runner: Vitest (config: vitest.config.ts)
database: Supabase (PostgreSQL + Auth + RLS)
integrations: Twilio (SMS), Microsoft Graph (email), Stripe, PayPal
styling: Tailwind CSS v4
hosting: Vercel
size: ~600 files, large multi-module management system
```

---

## Workflow Orchestration

### Plan Mode Default
Enter plan mode for any non-trivial task (3+ steps or architectural decisions). If something goes sideways, STOP and re-plan immediately — don't keep pushing. Use plan mode for verification steps, not just building. Write detailed specs upfront to reduce ambiguity.

### Subagent Strategy
Use subagents liberally to keep the main context window clean. Offload research, exploration, and parallel analysis to subagents. For complex problems, throw more compute at it via subagents. One task per subagent for focused execution. When exploring the codebase, use subagents to read multiple sections in parallel.

### Self-Improvement Loop
After ANY correction from the user, update `tasks/lessons.md` with the pattern. Write rules for yourself that prevent the same mistake. Review `tasks/lessons.md` at session start.

### Verification Before Done
Never mark a task complete without proving it works. Diff behaviour between main and your changes when relevant. Ask yourself: "Would a staff engineer approve this?" Run tests, check logs, demonstrate correctness.

### Demand Elegance (Balanced)
For non-trivial changes, pause and ask "is there a more elegant way?" Skip this for simple, obvious fixes — don't over-engineer. Challenge your own work before presenting it.

### Autonomous Bug Fixing
When given a bug report, just fix it. Don't ask for hand-holding. Check Supabase logs, Vercel deployment logs, and browser console. Point at errors, then resolve them. Zero context switching from the user.

---

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

---

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Minimal code impact.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
- **Test Against Reality**: Don't assume code is correct because it exists. Trace the actual logic.

---

## Domain Rules

- £10 deposit per person for groups of 7 or more (NOT credit card holds — that was old functionality)
- Events hosted by the venue itself are exceptions to deposit rules
- Contracts must be generated for private bookings
- Booking amendments, cancellations, and deletions must track payment state correctly
- All customer-facing language must reflect current policies, not legacy ones
- Legacy "credit card hold" language anywhere in code or templates is always a bug

---

## Prompting Conventions

- **Challenge as reviewer**: "Grill me on these changes and don't make a PR until I pass your test."
- **Demand proof**: "Prove to me this works" — diff behaviour between main and feature branch.
- **Force elegance**: "Knowing everything you know now, scrap this and implement the elegant solution."
- **Section review**: "Do a full review of the /[section-name] section" triggers the fix-function skill.
- **Autonomous mode**: Point at logs, Slack threads, or failing CI and just say "fix."

---

## Commands

```bash
npm run dev      # Start development server
npm run build    # Production build
npm run lint     # ESLint (zero warnings enforced)
npm test         # Run Vitest tests
npx supabase db push   # Apply pending migrations
```

**Node version:** Use Node 20 LTS (as pinned in `.nvmrc`). Run `nvm use` before development. The `engines` field in `package.json` enforces `>=20 <23`.

## Architecture

**Additional integrations**: Twilio (SMS), Microsoft Graph (email), Stripe, PayPal.

**Route groups**:
- `(authenticated)/` — all staff-facing pages, auth enforced at layout level
- `(staff-portal)/portal/` — employee-only views (shifts, pay)
- `(timeclock)/timeclock/` — public kiosk access (no auth)
- `(employee-onboarding)/` — onboarding flows
- `api/cron/` — Vercel cron endpoints (require `Authorization: Bearer CRON_SECRET`)
- `api/webhooks/` — Twilio, Stripe, PayPal webhooks

**Auth**: Supabase Auth with JWT + HTTP-only cookies. `src/middleware.ts` is currently **disabled** (renamed `.disabled` after a Vercel incident); auth is enforced in `(authenticated)/layout.tsx` via `supabase.auth.getUser()`. Public path prefixes: `/timeclock`, `/parking/guest`, `/table-booking`, `/g/`, `/m/`, `/r/`.

## Supabase Clients

- **`src/lib/supabase/server.ts`** — cookie-based auth, use in server actions and API routes
- **`src/lib/supabase/admin.ts`** — service role key, bypasses RLS; use for system/cron operations
- ESLint rule prevents importing the admin singleton in client components

## Permissions (RBAC)

```typescript
await checkUserPermission('module', 'action', userId)
```

Modules: `calendar`, `customers`, `employees`, `events`, `invoices`, `messages`, `parking`, `private-bookings`, `receipts`, `rota`, `leave`, `timeclock`, `payroll`, `settings`, `roles`, etc.
Actions: `view`, `create`, `edit`, `delete`, `publish`, `request`, `clock`, `manage`.
Roles: `super_admin`, `manager`, `staff`. Defined in `src/types/rbac.ts`.

## Key Libraries & Utilities

- **`src/lib/dateUtils.ts`** — `getTodayIsoDate()`, `toLocalIsoDate()`, `formatDateInLondon()` etc. London timezone hardcoded.
- **`src/lib/email/emailService.ts`** — `sendEmail(to, subject, html, cc?, attachments?)` via Microsoft Graph
- **`src/lib/sms/`** — Twilio wrapper with safety guards (hourly/daily rate limits, idempotency)
- **`src/services/`** — business logic services (CustomerService, EmployeeService, PermissionService, etc.)

## UI Components

Migrating from legacy `PageWrapper`/`Page` pattern to `PageLayout` + `HeaderNav` from `src/components/ui-v2/`. New pages must use the `ui-v2` pattern. Navigation defined in `src/components/ui-v2/navigation/AppNavigation.tsx`.

## Data Conventions

- Server actions body size limit: 20 MB (for file uploads)
- Dashboard data cached via `loadDashboardSnapshot()` in `src/app/(authenticated)/dashboard/`
- Date/holiday pre-computation: `buildConfirmedUKDates()` in calendar-notes actions

## Scheduled Jobs (vercel.json crons)

| Route | Schedule |
|---|---|
| `/api/cron/parking-notifications` | 0 5 * * * |
| `/api/cron/rota-auto-close` | 0 5 * * * |
| `/api/cron/rota-manager-alert` | 0 18 * * 0 |
| `/api/cron/rota-staff-email` | 0 21 * * 0 |
| `/api/cron/private-bookings-weekly-summary` | 0 * * * * |

## Key Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_APP_URL
TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER
MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_TENANT_ID / MICROSOFT_USER_EMAIL
PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_WEBHOOK_ID / PAYPAL_ENVIRONMENT
STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
OPENAI_API_KEY
CRON_SECRET
PAYROLL_ACCOUNTANT_EMAIL
```

See `.env.example` for the full list.
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/definition-of-done.md`

```markdown
# Definition of Done (DoD)

A feature is ONLY complete when ALL applicable items pass. This extends the Quality Gates in the root CLAUDE.md.

## Code Quality

- [ ] Builds successfully — `npm run build` with zero errors
- [ ] Linting passes — `npm run lint` with zero warnings
- [ ] Type checks pass — `npx tsc --noEmit` clean (or project equivalent)
- [ ] No `any` types unless justified with a comment
- [ ] No hardcoded secrets or API keys
- [ ] No hardcoded hex colours — use design tokens
- [ ] Server action return types explicitly typed

## Testing

- [ ] All existing tests pass
- [ ] New tests written for business logic (happy path + at least 1 error case)
- [ ] Coverage meets project minimum (default: 80% on business logic)
- [ ] External services mocked — never hit real APIs in tests
- [ ] If no test suite exists yet, note this in the PR as tech debt

## Security

- [ ] Auth checks in place — server actions re-verify server-side
- [ ] Permission checks present — RBAC enforced on both UI and server
- [ ] Input validation complete — all user inputs sanitised (Zod or equivalent)
- [ ] No new PII logging, sending, or storing without approval
- [ ] RLS verified (Supabase projects) — queries respect row-level security

## Accessibility

- [ ] Interactive elements have visible focus styles
- [ ] Colour is not the sole indicator of state
- [ ] Modal dialogs trap focus and close on Escape
- [ ] Tables have proper `<thead>`, `<th scope>` markup
- [ ] Images have meaningful `alt` text
- [ ] Keyboard navigation works for all interactive elements

## Documentation

- [ ] Complex logic commented — future developers can understand "why"
- [ ] README updated if new setup, config, or env vars are needed
- [ ] Environment variables documented in `.env.example`
- [ ] Breaking changes noted in PR description

## Deployment

- [ ] Database migrations tested locally before pushing
- [ ] Rollback plan documented for schema changes
- [ ] No console.log or debug statements left in production code
- [ ] Verification pipeline passes (see `verification-pipeline.md`)
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/supabase.md`

```markdown
# Supabase Conventions

## Client Patterns

Two Supabase client patterns — always use the correct one:

```typescript
// Server-side auth (anon key + cookie session) — use for auth checks:
const supabase = await getSupabaseServerClient();
const { data: { user } } = await supabase.auth.getUser();

// Server-side data (service-role, bypasses RLS) — use for system/cron operations:
const db = await getDb(); // or createClient() with service role
const { data } = await db.from("table").select("*").eq("id", id).single();

// Browser-only (client components):
const supabase = getSupabaseBrowserClient();
```

ESLint rules should prevent importing the admin/service-role client in client components.

## snake_case ↔ camelCase Conversion

DB columns are always `snake_case`; TypeScript types are `camelCase` with Date objects. Always wrap DB results:

```typescript
import { fromDb } from "@/lib/utils";
const record = fromDb<MyType>(dbRow); // converts snake_case keys + ISO strings → Date
```

All type definitions should live in a central types file (e.g. `src/types/database.ts`).

## Row Level Security (RLS)

- RLS is always enabled on all tables
- Use the anon-key client for user-scoped operations (respects RLS)
- Use the service-role client only for system operations, crons, and webhooks
- Never disable RLS "temporarily" — create a proper service-role path instead

## Migrations

```bash
npx supabase db push          # Apply pending migrations
npx supabase migration new    # Create a new migration file
```

- Migrations live in `supabase/migrations/`
- Full schema reference in `supabase/schema.sql` (paste into SQL Editor for fresh setup)
- Never run destructive migrations (DROP COLUMN/TABLE) without explicit approval
- Test migrations locally with `npx supabase db push --dry-run` before pushing (see `verification-pipeline.md`)

### Dropping columns or tables — mandatory function audit

When a migration drops a column or table, you MUST search for every function and trigger that references it and update them in the same migration. Failing to do so leaves silent breakage: PL/pgSQL functions that reference a dropped column/table throw an exception at runtime, and if any of those functions have an `EXCEPTION WHEN OTHERS THEN` handler, the error is swallowed and returned as a generic blocked/failure state — making the bug invisible until someone notices the feature is broken.

**Before writing any `DROP COLUMN` or `DROP TABLE`:**

```sql
-- Find all functions that reference the column or table
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_definition ILIKE '%column_or_table_name%'
  AND routine_type = 'FUNCTION';
```

Or search the migrations directory:
```bash
grep -r "column_or_table_name" supabase/migrations/ --include="*.sql" -l
```

For each function found: update it in the same migration to remove or replace the reference. Never leave a function referencing infrastructure that no longer exists.

This also applies to **triggers** — check trigger functions separately:
```bash
grep -r "column_or_table_name" supabase/migrations/ --include="*.sql" -n
```

## Auth

- Supabase Auth with JWT + HTTP-only cookies
- Auth checks happen in layout files or middleware
- Server actions must always re-verify auth server-side (never rely on UI hiding)
- Public routes must be explicitly allowlisted

## Audit Logging

All mutations (create, update, delete) in server actions must call `logAuditEvent()`:

```typescript
await logAuditEvent({
  user_id: user.id,
  operation_type: 'update',
  resource_type: 'thing',
  operation_status: 'success'
});
```
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/ui-patterns.md`

```markdown
# UI Patterns & Component Standards

## Server vs Client Components

- Default to **Server Components** — only add `'use client'` when you need interactivity, hooks, or browser APIs
- Server Components can fetch data directly (no useEffect/useState for data loading)
- Client Components should receive data as props from server parents where possible

## Data Fetching & Display

Every data-driven UI must handle all three states:
1. **Loading** — skeleton loaders or spinners (not blank screens)
2. **Error** — user-facing error message or error boundary
3. **Empty** — meaningful empty state component (not just no content)

## Forms

- Use React Hook Form + Zod for validation where configured
- Validation errors displayed inline, not just console logs
- Required field indicators visible
- Loading/disabled state during submission (prevent double-submit)
- Server action errors surfaced to user via toast or inline message
- Form reset after successful submission where appropriate

## Buttons

Check every button for:
- Consistent variant usage (primary, secondary, destructive, ghost) — no ad-hoc Tailwind-only buttons
- Loading states on async actions (spinner/disabled during server action calls)
- Disabled states when form is invalid or submission in progress
- `type="button"` to prevent accidental form submission (use `type="submit"` only on submit buttons)
- Confirmation dialogs on destructive actions (delete, archive, bulk operations)
- `aria-label` on icon-only buttons

## Navigation

- Breadcrumbs on nested pages
- Active state on current nav item
- Back/cancel navigation returns to correct parent page
- New sections added to project navigation with correct permission gating
- Mobile responsiveness of all nav elements

## Permissions (RBAC)

- Every authenticated page must check permissions via the project's permission helper
- UI elements (edit, delete, create buttons) conditionally rendered based on permissions
- Server actions must re-check permissions server-side (never rely on UI hiding alone)

## Accessibility Baseline

These items are also enforced in the Definition of Done (`definition-of-done.md`):

- Interactive elements have visible focus styles
- Colour is not the only indicator of state
- Modal dialogs trap focus and close on Escape
- Tables use proper `<thead>`, `<th scope>` markup
- Images have meaningful `alt` text
- Keyboard navigation works for all interactive elements
```

---

_End of pack._
