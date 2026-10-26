-- Rollback for supabase/migrations/20261026231744_event_door_takings.sql.
-- Production had no such table before it, so this drops it. Anything staff recorded in it is lost:
-- export the rows first if they are wanted.

DROP TABLE public.event_door_takings;
