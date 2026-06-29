-- Rollback for 20260716000000_recruitment_staff_schedule_appointment_rpc.sql
-- Drops the atomic staff scheduling RPC. The staff scheduling code path depends
-- on this function, so only roll back together with the corresponding service code.

DROP FUNCTION IF EXISTS public.recruitment_staff_schedule_appointment(uuid, uuid, text, timestamptz, uuid, text);
