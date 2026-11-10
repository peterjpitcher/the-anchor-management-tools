-- Unfinished Christmas dinner bookings (Christmas funnel spec, owner decisions 5 to 8 of
-- 10 November 2026; tasks/christmas-funnel/spec.md in the release 1 change).
--
-- Somebody who starts a Christmas booking on the website and presses Continue on the details step
-- is saved here as a "lead" (POST /api/table-bookings/leads). Nothing is held. If they do not
-- finish, ONE follow-up email goes at 10:00 London the next morning with a link that picks up
-- where they left off (api/cron/christmas-follow-ups), at most one per email address per season.
-- A Christmas booking whose unpaid deposit hold lapses is saved here too (source 'lapsed_hold'),
-- linked to the cancelled booking, so its cancellation email can carry the same link and staff
-- can see it. Staff see both on the "Christmas follow-ups" tab under table bookings.
--
-- Personal data stored somewhere new (owner approved, 10 November 2026): first and last name,
-- email address, mobile number, the date, time and party size they chose, and a staff call note.
-- The follow-up cron deletes a lead 30 days after its chosen date.
--
-- Schema:
--   * public.table_booking_leads, one row per lead:
--       - lead_ref: the website's id for one form session, the idempotent upsert key (unique);
--       - source: 'website' (the details step) or 'lapsed_hold' (a lapsed Christmas deposit hold);
--       - booking_period_id: the Christmas period the date falls in, the "season" of the
--         one-follow-up-per-email rule;
--       - customer_id: an existing customer with the same mobile or email, when there is one
--         (never created for a lead), used for the unsubscribe link;
--       - table_booking_id: the booking the lead turned into (website), or the booking whose hold
--         lapsed (lapsed_hold);
--       - email is stored lower-case (CHECK), so the plain index on email serves lower(email);
--       - follow_up_claimed_at is the claim, written before the email is sent and never released,
--         so a send that failed or may have gone is never retried automatically;
--       - resume_token_hash and opt_out_token_hash hold only the SHA-256 of a 32-byte random token;
--         the raw tokens exist only in the email.
--   * table_booking_leads_one_follow_up_per_email: unique (period, email) among claimed leads, so
--     two runs, or two leads for one address, can never send a second follow-up in a season.
--   * table_booking_leads_one_per_lapsed_hold: one lapsed_hold lead per booking.
--
-- Access: RLS on with no policies, every privilege revoked from PUBLIC, anon and authenticated.
-- Only the service role reads or writes it (API key routes, the cron and staff server actions,
-- each after its own check). No view or function is created.
--
-- Data: the messaging flag christmas_lead_follow_up is set true (owner approved the email wording
-- on 10 November 2026), merged into the existing messaging_flags object so no other flag changes.
-- Switching it off stops the follow-up emails with no deploy.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.table_booking_leads;
--   UPDATE public.system_settings SET value = value - 'christmas_lead_follow_up' WHERE key = 'messaging_flags';
--
-- Tested by scripts/testing/christmas-booking-leads-postgres.py.

CREATE TABLE public.table_booking_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_ref uuid NOT NULL,
  source text NOT NULL,
  booking_period_id uuid NOT NULL REFERENCES public.booking_periods(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  table_booking_id uuid REFERENCES public.table_bookings(id) ON DELETE SET NULL,
  first_name text NOT NULL,
  last_name text,
  email text,
  mobile_e164 text,
  booking_date date NOT NULL,
  booking_time time NOT NULL,
  party_size integer NOT NULL,
  follow_up_opt_out boolean NOT NULL DEFAULT false,
  follow_up_claimed_at timestamptz,
  follow_up_sent_at timestamptz,
  follow_up_outcome text,
  resume_token_hash text,
  resume_token_expires_at timestamptz,
  opt_out_token_hash text,
  called_at timestamptz,
  called_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  call_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_booking_leads_lead_ref_key UNIQUE (lead_ref),
  CONSTRAINT table_booking_leads_source_check CHECK (source IN ('website', 'lapsed_hold')),
  CONSTRAINT table_booking_leads_website_contact_check
    CHECK (source <> 'website' OR (email IS NOT NULL AND mobile_e164 IS NOT NULL)),
  CONSTRAINT table_booking_leads_email_check
    CHECK (email IS NULL OR (email = lower(email) AND length(email) BETWEEN 3 AND 320)),
  CONSTRAINT table_booking_leads_mobile_check
    CHECK (mobile_e164 IS NULL OR mobile_e164 ~ '^\+[0-9]{7,15}$'),
  CONSTRAINT table_booking_leads_name_check
    CHECK (length(first_name) <= 100 AND (last_name IS NULL OR length(last_name) <= 100)),
  CONSTRAINT table_booking_leads_party_size_check CHECK (party_size BETWEEN 1 AND 100),
  CONSTRAINT table_booking_leads_follow_up_outcome_check
    CHECK (follow_up_outcome IS NULL OR follow_up_outcome IN ('sent', 'refused', 'uncertain')),
  CONSTRAINT table_booking_leads_call_note_check CHECK (call_note IS NULL OR length(call_note) <= 500),
  CONSTRAINT table_booking_leads_resume_token_check
    CHECK ((resume_token_hash IS NULL) = (resume_token_expires_at IS NULL))
);

COMMENT ON TABLE public.table_booking_leads IS
  'Unfinished Christmas dinner bookings: website details steps and lapsed deposit holds. Deleted 30 days after the chosen date by api/cron/christmas-follow-ups. Service role only.';
COMMENT ON COLUMN public.table_booking_leads.lead_ref IS
  'The website''s id for one form session; posting the same lead_ref again updates the row.';
COMMENT ON COLUMN public.table_booking_leads.follow_up_claimed_at IS
  'Written before the follow-up email is sent and never cleared, so a send is never retried automatically.';
COMMENT ON COLUMN public.table_booking_leads.resume_token_hash IS
  'SHA-256 of the "finish my booking" token. The raw token is only ever in the email.';
COMMENT ON COLUMN public.table_booking_leads.opt_out_token_hash IS
  'SHA-256 of the follow-up email''s opt-out token, for a lead with no matching customer.';

CREATE UNIQUE INDEX table_booking_leads_one_follow_up_per_email
  ON public.table_booking_leads (booking_period_id, email)
  WHERE follow_up_claimed_at IS NOT NULL;

CREATE UNIQUE INDEX table_booking_leads_one_per_lapsed_hold
  ON public.table_booking_leads (table_booking_id)
  WHERE source = 'lapsed_hold';

CREATE UNIQUE INDEX table_booking_leads_resume_token_hash_key
  ON public.table_booking_leads (resume_token_hash)
  WHERE resume_token_hash IS NOT NULL;

CREATE UNIQUE INDEX table_booking_leads_opt_out_token_hash_key
  ON public.table_booking_leads (opt_out_token_hash)
  WHERE opt_out_token_hash IS NOT NULL;

-- email is lower-case by CHECK, so this is the lower(email) index.
CREATE INDEX idx_table_booking_leads_email ON public.table_booking_leads (email);
CREATE INDEX idx_table_booking_leads_booking_date ON public.table_booking_leads (booking_date);
CREATE INDEX idx_table_booking_leads_created_at ON public.table_booking_leads (created_at);
CREATE INDEX idx_table_booking_leads_table_booking_id ON public.table_booking_leads (table_booking_id)
  WHERE table_booking_id IS NOT NULL;
CREATE INDEX idx_table_booking_leads_customer_id ON public.table_booking_leads (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE TRIGGER table_booking_leads_updated_at
BEFORE UPDATE ON public.table_booking_leads
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.table_booking_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.table_booking_leads FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.table_booking_leads TO service_role;

INSERT INTO public.system_settings (key, value)
VALUES ('messaging_flags', '{"christmas_lead_follow_up": true}'::jsonb)
ON CONFLICT (key) DO UPDATE
  SET value = public.system_settings.value || EXCLUDED.value;
