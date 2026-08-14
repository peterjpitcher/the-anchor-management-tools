-- Records utm_content on a short-link click.
--
-- The redirect handler already FORWARDS utm_content to the destination, so the brand site
-- captures it and it survives into a booking's analytics event. It just never stored it on
-- the click itself, which left a gap in the middle of the chain: we could see that a campaign
-- produced a booking, and that a link was clicked, but not that a particular recipient
-- clicked it.
--
-- Marketing email uses utm_content to carry the campaign-recipient id, so with this column a
-- click can be traced back to one contact, and the same value carries through to the booking.

BEGIN;

ALTER TABLE public.short_link_clicks
  ADD COLUMN IF NOT EXISTS utm_content varchar(100);

-- Per-recipient attribution reads clicks by this value, so it needs its own index.
CREATE INDEX IF NOT EXISTS short_link_clicks_utm_content_idx
  ON public.short_link_clicks (utm_content)
  WHERE utm_content IS NOT NULL;

COMMENT ON COLUMN public.short_link_clicks.utm_content IS
  'Campaign variant or, for marketing email, the marketing_campaign_recipients id, so a click can be traced to one contact.';

COMMIT;
