-- Create a normalized contacts table for invoice vendors
create table if not exists public.invoice_vendor_contacts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.invoice_vendors(id) on delete cascade,
  name text,
  email text not null,
  is_primary boolean not null default false,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_invoice_vendor_contacts_vendor on public.invoice_vendor_contacts(vendor_id);
create index if not exists idx_invoice_vendor_contacts_email on public.invoice_vendor_contacts(email);

-- Ensure only one primary contact per vendor
create or replace function public.enforce_single_primary_vendor_contact()
returns trigger as $$
begin
  if new.is_primary then
    update public.invoice_vendor_contacts
      set is_primary = false
      where vendor_id = new.vendor_id and id <> new.id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_single_primary_vendor_contact on public.invoice_vendor_contacts;
create trigger trg_single_primary_vendor_contact
before insert or update on public.invoice_vendor_contacts
for each row execute procedure public.enforce_single_primary_vendor_contact();

