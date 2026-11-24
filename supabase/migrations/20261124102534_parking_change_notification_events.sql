-- Parking: two notification event types for changing a booking's dates (spec
-- tasks/spec-2026-11-24-parking-change-time-and-settle.md, section 8.3).
--
-- booking_changed: the one text sent when staff change a booking's dates, and the
--   marker row that records each change (its change_id), which also tells the
--   reminder cron that a start or end reminder may be sent again for the new dates.
-- top_up_received: the receipt text when extra owed after a change is paid online.
--
-- Additive only. A new enum value cannot be used in the transaction that adds it,
-- so this migration does nothing else.
ALTER TYPE public.parking_notification_event ADD VALUE IF NOT EXISTS 'booking_changed';
ALTER TYPE public.parking_notification_event ADD VALUE IF NOT EXISTS 'top_up_received';
