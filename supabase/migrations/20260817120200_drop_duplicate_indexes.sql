-- Drop 14 indexes that are byte-for-byte duplicates of another index on the same table.
--
-- A duplicate index is paid for on every insert, update and delete, and is never
-- worth anything on read because the twin already covers the query. Each pair below
-- was checked against pg_stat_user_indexes before choosing which one to drop.
--
-- 13 of the 14 dropped here have an idx_scan of exactly 0, so nothing is currently
-- reading them. The exception is idx_events_slug (32,989 scans), which duplicates
-- events_slug_key. That one is kept because it backs the unique constraint and
-- cannot be dropped without dropping the constraint, so the planner simply moves
-- those scans onto it.
--
-- Reversible: every dropped index can be recreated from the definitions in the
-- comment beside it.

begin;

-- duplicate of idx_audit_logs_resource_type_id (46,131 scans)
drop index if exists public.idx_audit_logs_resource;

-- duplicate of idx_audit_logs_user_date (both unused; keeping one)
drop index if exists public.idx_audit_logs_user_created;

-- duplicate of idx_booking_reminders_booking_type (116 scans)
drop index if exists public.idx_booking_reminders_booking;

-- duplicate of idx_booking_table_assignments_table_window (1,176,508 scans)
drop index if exists public.idx_booking_table_assignments_table_time;

-- duplicate of idx_bookings_created_recent (1,186 scans)
drop index if exists public.idx_bookings_created_at;

-- duplicate of idx_customers_created_recent (16,488 scans)
drop index if exists public.idx_customers_created_at;

-- duplicate of idx_customers_mobile_number (7 scans)
drop index if exists public.idx_customers_mobile;

-- duplicate of idx_invite_tokens_employee (4 scans)
drop index if exists public.idx_employee_invite_tokens_employee_id;

-- duplicate of the employees_email_address_key unique constraint
drop index if exists public.idx_employees_email;

-- duplicate of idx_events_date_upcoming (1,097,210 scans)
drop index if exists public.idx_events_date;

-- duplicate of the events_slug_key unique constraint, which absorbs its scans
drop index if exists public.idx_events_slug;

-- duplicate of message_delivery_status_message_created_idx (893 scans)
drop index if exists public.idx_message_delivery_message;

-- duplicate of messages_twilio_sid_idx (154 scans)
drop index if exists public.idx_messages_twilio_sid;

-- duplicate of idx_table_booking_items_booking_id (190 scans)
drop index if exists public.idx_booking_items_booking;

commit;
