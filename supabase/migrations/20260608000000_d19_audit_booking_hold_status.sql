-- Audit log booking_holds status transitions (D19/SEC-7)
-- Tracks when holds are released, expired, or consumed for
-- payment dispute investigation and operational transparency.

CREATE OR REPLACE FUNCTION public.audit_booking_hold_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only log when status actually changes
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.audit_logs (
      user_id,
      operation_type,
      operation_status,
      resource_type,
      resource_id,
      old_values,
      new_values,
      additional_info,
      created_at
    ) VALUES (
      NULL,  -- system-triggered, no user context
      'hold_status_change',
      'success',
      'booking_hold',
      NEW.id::text,
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status),
      jsonb_build_object(
        'hold_type', NEW.hold_type,
        'event_booking_id', NEW.event_booking_id,
        'table_booking_id', NEW.table_booking_id,
        'seats_or_covers_held', NEW.seats_or_covers_held,
        'expires_at', NEW.expires_at,
        'released_at', NEW.released_at,
        'consumed_at', NEW.consumed_at
      ),
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_booking_hold_status ON public.booking_holds;

CREATE TRIGGER trg_audit_booking_hold_status
  AFTER UPDATE ON public.booking_holds
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_booking_hold_status_change();
