-- Allow private bookings to extend past midnight by tracking whether the end time is on the next day

ALTER TABLE public.private_bookings
ADD COLUMN IF NOT EXISTS end_time_next_day boolean DEFAULT false;

ALTER TABLE public.private_bookings
DROP CONSTRAINT IF EXISTS chk_booking_times;

ALTER TABLE public.private_bookings
ADD CONSTRAINT chk_booking_times CHECK (
  end_time IS NULL
  OR end_time > start_time
  OR end_time_next_day = true
);

DROP VIEW IF EXISTS public.private_bookings_with_details;

CREATE VIEW public.private_bookings_with_details AS
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
  (
    SELECT COALESCE(sum(pbi.line_total), (0)::numeric)
    FROM public.private_booking_items pbi
    WHERE pbi.booking_id = pb.id
  ) AS calculated_total,
  CASE
    WHEN pb.deposit_paid_date IS NOT NULL THEN 'Paid'::text
    WHEN pb.status = 'confirmed'::text THEN 'Required'::text
    ELSE 'Not Required'::text
  END AS deposit_status,
  (pb.event_date - CURRENT_DATE) AS days_until_event
 FROM public.private_bookings pb
 LEFT JOIN public.customers c ON pb.customer_id = c.id;
