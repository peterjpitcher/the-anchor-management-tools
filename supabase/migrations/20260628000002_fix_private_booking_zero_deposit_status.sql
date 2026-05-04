-- Ensure remote databases get the zero-deposit status fix even when the
-- historical view migration has already been applied.
CREATE OR REPLACE VIEW public.private_bookings_with_details AS
 SELECT
  pb.id,
  pb.customer_id,
  pb.customer_name,
  pb.contact_phone,
  pb.contact_email,
  pb.event_date,
  pb.start_time,
  pb.setup_time,
  pb.end_time,
  pb.end_time_next_day,
  pb.guest_count,
  pb.event_type,
  pb.status,
  pb.deposit_amount,
  pb.deposit_paid_date,
  pb.deposit_payment_method,
  pb.total_amount,
  pb.balance_due_date,
  pb.final_payment_date,
  pb.final_payment_method,
  pb.calendar_event_id,
  pb.contract_version,
  pb.internal_notes,
  pb.customer_requests,
  pb.created_by,
  pb.created_at,
  pb.updated_at,
  pb.setup_date,
  pb.discount_type,
  pb.discount_amount,
  pb.discount_reason,
  pb.customer_first_name,
  pb.customer_last_name,
  pb.customer_full_name,
  c.mobile_number AS customer_mobile,
  public.get_booking_discounted_total(pb.id) AS calculated_total,
  CASE
    WHEN pb.deposit_paid_date IS NOT NULL THEN 'Paid'::text
    WHEN COALESCE(pb.deposit_amount, 0) <= 0 THEN 'Not Required'::text
    WHEN pb.status = 'confirmed'::text THEN 'Required'::text
    ELSE 'Not Required'::text
  END AS deposit_status,
  (pb.event_date - CURRENT_DATE) AS days_until_event,
  pb.contract_note,
  pb.hold_expiry,
  (
    SELECT COALESCE(SUM(pbp.amount), 0)
    FROM public.private_booking_payments pbp
    WHERE pbp.booking_id = pb.id
  ) AS total_balance_paid,
  public.calculate_private_booking_balance(pb.id) AS balance_remaining,
  CASE
    WHEN public.calculate_private_booking_balance(pb.id) <= 0 THEN 'Fully Paid'::text
    WHEN (
      SELECT COALESCE(SUM(pbp.amount), 0)
      FROM public.private_booking_payments pbp
      WHERE pbp.booking_id = pb.id
    ) > 0 THEN 'Partially Paid'::text
    ELSE 'Unpaid'::text
  END AS payment_status
 FROM public.private_bookings pb
 LEFT JOIN public.customers c ON pb.customer_id = c.id;

ALTER VIEW public.private_bookings_with_details SET (security_invoker = true);
REVOKE ALL ON public.private_bookings_with_details FROM anon;
GRANT SELECT ON public.private_bookings_with_details TO authenticated;
GRANT SELECT ON public.private_bookings_with_details TO service_role;
