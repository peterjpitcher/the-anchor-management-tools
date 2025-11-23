create or replace function update_invoice_with_line_items(
  p_invoice_id uuid,
  p_invoice_data jsonb,
  p_line_items jsonb
)
returns invoices
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  existing_invoice invoices%rowtype;
  updated_invoice invoices%rowtype;
begin
  if p_invoice_id is null then
    raise exception 'invoice_id is required';
  end if;

  if p_line_items is null
     or jsonb_typeof(p_line_items) <> 'array'
     or jsonb_array_length(p_line_items) = 0 then
    raise exception 'line_items must be a non-empty array';
  end if;

  select *
  into existing_invoice
  from invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice % not found', p_invoice_id;
  end if;

  if existing_invoice.status <> 'draft' then
    raise exception 'Only draft invoices can be edited';
  end if;

  update invoices
  set
    vendor_id = coalesce((p_invoice_data->>'vendor_id')::uuid, existing_invoice.vendor_id),
    invoice_date = coalesce((p_invoice_data->>'invoice_date')::date, existing_invoice.invoice_date),
    due_date = coalesce((p_invoice_data->>'due_date')::date, existing_invoice.due_date),
    reference = nullif(p_invoice_data->>'reference', ''),
    invoice_discount_percentage = coalesce(
      (p_invoice_data->>'invoice_discount_percentage')::numeric,
      existing_invoice.invoice_discount_percentage
    ),
    subtotal_amount = coalesce((p_invoice_data->>'subtotal_amount')::numeric, existing_invoice.subtotal_amount),
    discount_amount = coalesce((p_invoice_data->>'discount_amount')::numeric, existing_invoice.discount_amount),
    vat_amount = coalesce((p_invoice_data->>'vat_amount')::numeric, existing_invoice.vat_amount),
    total_amount = coalesce((p_invoice_data->>'total_amount')::numeric, existing_invoice.total_amount),
    notes = case
      when p_invoice_data ? 'notes' then nullif(p_invoice_data->>'notes', '')
      else existing_invoice.notes
    end,
    internal_notes = case
      when p_invoice_data ? 'internal_notes' then nullif(p_invoice_data->>'internal_notes', '')
      else existing_invoice.internal_notes
    end,
    updated_at = timezone('utc', now())
  where id = p_invoice_id
  returning * into updated_invoice;

  delete from invoice_line_items
  where invoice_id = p_invoice_id;

  insert into invoice_line_items (
    invoice_id,
    catalog_item_id,
    description,
    quantity,
    unit_price,
    discount_percentage,
    vat_rate
  )
  select
    p_invoice_id,
    nullif(item->>'catalog_item_id', '')::uuid,
    coalesce(item->>'description', ''),
    coalesce((item->>'quantity')::numeric, 0),
    coalesce((item->>'unit_price')::numeric, 0),
    coalesce((item->>'discount_percentage')::numeric, 0),
    coalesce((item->>'vat_rate')::numeric, 0)
  from jsonb_array_elements(p_line_items) as item;

  return updated_invoice;
end;
$$;

grant execute on function update_invoice_with_line_items(uuid, jsonb, jsonb) to service_role;
