-- Backfill messages.customer_id for private-booking SMS so they appear on the customer page
-- Dry-run preview
SELECT COUNT(*) AS candidates
FROM messages m
JOIN private_bookings pb ON (m.metadata->>'private_booking_id')::uuid = pb.id
WHERE m.direction = 'outbound'
  AND m.customer_id IS NULL
  AND (m.metadata->>'private_booking_id') IS NOT NULL
  AND pb.customer_id IS NOT NULL;

-- Apply update
DO $$
DECLARE n integer;
BEGIN
  UPDATE messages m
  SET customer_id = pb.customer_id
  FROM private_bookings pb
  WHERE m.direction = 'outbound'
    AND m.customer_id IS NULL
    AND (m.metadata->>'private_booking_id') IS NOT NULL
    AND (m.metadata->>'private_booking_id')::uuid = pb.id
    AND pb.customer_id IS NOT NULL;

  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Messages backfilled with customer_id: %', n;
END $$;

