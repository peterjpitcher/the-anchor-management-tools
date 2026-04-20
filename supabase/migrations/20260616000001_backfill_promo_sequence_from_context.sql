-- Backfill promo_sequence from sms_promo_context.
--
-- The promo_sequence table (created in 20260613000000) was empty because it was
-- created AFTER all historical 14d cross-promo sends. Without this data, the
-- get_follow_up_recipients RPC finds zero rows and 7d/3d follow-ups never fire.
--
-- This backfill populates rows for events still in the future so follow-ups
-- can begin firing on the next cron run.

INSERT INTO promo_sequence (customer_id, event_id, audience_type, touch_14d_sent_at)
SELECT
  spc.customer_id,
  spc.event_id,
  'category_match',  -- all pre-migration sends were category-match only
  spc.created_at
FROM sms_promo_context spc
JOIN events e ON e.id = spc.event_id
WHERE spc.template_key = 'event_cross_promo_14d'
  AND e.date >= CURRENT_DATE
  AND NOT EXISTS (
    SELECT 1 FROM promo_sequence ps
    WHERE ps.customer_id = spc.customer_id AND ps.event_id = spc.event_id
  )
ON CONFLICT (customer_id, event_id) DO NOTHING;
