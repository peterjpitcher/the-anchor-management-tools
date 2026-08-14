-- Records which link was clicked, every time, for every link in an email.
--
-- Two things were missing and this fixes both.
--
-- 1. email_messages carries a single clicked_at timestamp, so only the FIRST click on an
--    email was ever visible. A recipient clicking three different calls to action produced
--    one timestamp and no way to tell which one they wanted.
--
-- 2. Our own short links only cover links to the venue's site. The phone number, the
--    WhatsApp link and the social links are deliberately not rewritten through the
--    redirector, so clicks on them were invisible even though the provider reported them.
--
-- The provider's click event already carries the exact URL. It was being discarded. Keeping
-- it gives complete per-link coverage without shortening a `tel:` link, which would put a
-- browser hop in front of tapping to call and would break it on some clients.
--
-- This is one row per click event, so repeat clicks are preserved rather than collapsed.

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_link_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_message_id uuid REFERENCES public.email_messages(id) ON DELETE CASCADE,
  -- Kept even when the email row cannot be matched, so a click is never silently lost.
  provider_message_id text,
  link_url text NOT NULL,
  clicked_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_link_clicks_url_len CHECK (char_length(link_url) BETWEEN 1 AND 2048)
);

CREATE INDEX IF NOT EXISTS email_link_clicks_message_idx
  ON public.email_link_clicks (email_message_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS email_link_clicks_url_idx
  ON public.email_link_clicks (link_url);
CREATE INDEX IF NOT EXISTS email_link_clicks_provider_idx
  ON public.email_link_clicks (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

COMMENT ON TABLE public.email_link_clicks IS
  'One row per click event reported by the email provider, including the exact URL. Covers '
  'every link in an email, including tel: and third-party links that are deliberately not '
  'routed through the short-link redirector.';

ALTER TABLE public.email_link_clicks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_link_clicks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.email_link_clicks TO service_role;

COMMIT;
