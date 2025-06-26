-- Check booking discount details
SELECT 
    id,
    customer_full_name,
    status,
    discount_type,
    discount_amount,
    discount_reason,
    total_amount
FROM private_bookings
WHERE id = '504f6dd0-3420-4ef4-aa9c-826b392f314c';

-- Check items for this booking
SELECT 
    description,
    item_type,
    quantity,
    unit_price,
    line_total
FROM private_booking_items
WHERE booking_id = '504f6dd0-3420-4ef4-aa9c-826b392f314c'
ORDER BY item_type, description;