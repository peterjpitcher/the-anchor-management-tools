BEGIN;

DROP FUNCTION IF EXISTS public.apply_receipt_group_classification_atomic(
  text,
  public.receipt_transaction_status[],
  boolean,
  uuid,
  text,
  boolean,
  text,
  uuid,
  text
);

COMMIT;
