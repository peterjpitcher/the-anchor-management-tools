BEGIN;

DROP FUNCTION IF EXISTS public.upsert_cashup_session_atomic(uuid, uuid, date, text, text, jsonb, jsonb, jsonb, uuid);

COMMIT;
