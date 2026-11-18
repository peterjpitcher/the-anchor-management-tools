-- Messages inbox: read only the newest rows instead of every message ever sent.
--
-- getInbox used to read the view customer_communications twice (newest 250
-- overall, and the newest 500 unread). The view is a UNION ALL of messages,
-- email_messages and feedback, with the SMS branch joined to an aggregate over
-- all of message_delivery_status, so Postgres could not push the ORDER BY and
-- LIMIT into the branches: every run read and sorted all 16,000-odd rows
-- (measured 2.7 s for one run, worst 6.3 s in pg_stat_statements).
--
-- This function takes the newest N rows from each base table with its own
-- ORDER BY ... LIMIT (index-backed), unions them, and re-sorts and truncates
-- to exactly the newest N overall. The newest N rows of a union are always
-- inside the union of each branch's newest N, so the result is the same set
-- the view returned. Ties on created_at are broken by id descending, both
-- inside each branch and overall, so the boundary is deterministic.
--
-- Column expressions are copied from the live view definition
-- (pg_get_viewdef on 18 November 2026). Only the ten columns the inbox list
-- renders are returned. The view's delivery_history aggregate is not one of
-- them, so it is not computed at all.
--
-- Unread rule, copied from getInbox's filter: inbound SMS or WhatsApp with
-- read_at null, or inbound email with staff_read_at null. Feedback rows are
-- never unread under that rule (channel 'feedback'), so there is no feedback
-- unread branch.
--
-- is_unread_row marks which list a row belongs to: false for the recent list,
-- true for the unread list. A row can appear in both, exactly as it did when
-- the two view reads were separate; getInbox de-duplicates by id.
--
-- The view itself is left alone: the timeline and search still read it with a
-- customer_id filter, which is fast enough.
--
-- Additive only: two indexes and one function. No data changes.

create index if not exists idx_email_messages_inbox_order
  on public.email_messages ((coalesce(received_at, sent_at, created_at)) desc)
  where customer_id is not null;

create index if not exists idx_email_messages_unread_inbound
  on public.email_messages ((coalesce(received_at, sent_at, created_at)) desc)
  where direction = 'inbound' and staff_read_at is null and customer_id is not null;

create or replace function public.get_inbox_communications(
  p_recent_limit integer,
  p_unread_limit integer
)
returns table (
  id text,
  customer_id uuid,
  channel text,
  direction text,
  created_at timestamp with time zone,
  read_at timestamp with time zone,
  staff_read_at timestamp with time zone,
  has_attachments boolean,
  subject text,
  body_text text,
  is_unread_row boolean
)
language sql
stable
security invoker
set search_path = public
as $function$
  with limits as (
    -- A null or negative limit returns nothing rather than everything.
    select
      greatest(coalesce(p_recent_limit, 0), 0) as recent_limit,
      greatest(coalesce(p_unread_limit, 0), 0) as unread_limit
  ),
  sms_recent as (
    select
      ((coalesce(nullif(m.message_type, ''::text), 'sms'::text) || ':'::text) || m.id::text)::text as id,
      m.customer_id::uuid as customer_id,
      coalesce(nullif(m.message_type, ''::text), 'sms'::text)::text as channel,
      m.direction::text as direction,
      m.created_at::timestamp with time zone as created_at,
      m.read_at::timestamp with time zone as read_at,
      (case when m.direction = 'inbound'::text then m.read_at else null::timestamp with time zone end)::timestamp with time zone as staff_read_at,
      coalesce(m.has_attachments, false)::boolean as has_attachments,
      null::text as subject,
      m.body::text as body_text
    from public.messages m
    where m.customer_id is not null
    order by m.created_at desc,
      ((coalesce(nullif(m.message_type, ''::text), 'sms'::text) || ':'::text) || m.id::text) desc
    limit (select recent_limit from limits)
  ),
  email_recent as (
    select
      ('email:'::text || em.id::text)::text as id,
      em.customer_id::uuid as customer_id,
      'email'::text as channel,
      em.direction::text as direction,
      coalesce(em.received_at, em.sent_at, em.created_at)::timestamp with time zone as created_at,
      null::timestamp with time zone as read_at,
      em.staff_read_at::timestamp with time zone as staff_read_at,
      coalesce(em.has_attachments, false)::boolean as has_attachments,
      em.subject::text as subject,
      em.body_text::text as body_text
    from public.email_messages em
    where em.customer_id is not null
    order by coalesce(em.received_at, em.sent_at, em.created_at) desc,
      ('email:'::text || em.id::text) desc
    limit (select recent_limit from limits)
  ),
  feedback_recent as (
    select
      ('feedback:'::text || fr.id::text)::text as id,
      fr.customer_id::uuid as customer_id,
      'feedback'::text as channel,
      'inbound'::text as direction,
      fr.created_at::timestamp with time zone as created_at,
      null::timestamp with time zone as read_at,
      null::timestamp with time zone as staff_read_at,
      false as has_attachments,
      'Feedback'::text as subject,
      fr.comments::text as body_text
    from (
      select
        f.id,
        coalesce(b.customer_id, tb.customer_id, pb.customer_id) as customer_id,
        f.comments,
        f.created_at
      from public.feedback f
        left join public.bookings b on b.id = f.event_booking_id
        left join public.table_bookings tb on tb.id = f.table_booking_id
        left join public.private_bookings pb on pb.id = f.private_booking_id
    ) fr
    where fr.customer_id is not null
    order by fr.created_at desc, ('feedback:'::text || fr.id::text) desc
    limit (select recent_limit from limits)
  ),
  recent as (
    select u.*
    from (
      select * from sms_recent
      union all
      select * from email_recent
      union all
      select * from feedback_recent
    ) u
    order by u.created_at desc, u.id desc
    limit (select recent_limit from limits)
  ),
  sms_unread as (
    select
      ((coalesce(nullif(m.message_type, ''::text), 'sms'::text) || ':'::text) || m.id::text)::text as id,
      m.customer_id::uuid as customer_id,
      coalesce(nullif(m.message_type, ''::text), 'sms'::text)::text as channel,
      m.direction::text as direction,
      m.created_at::timestamp with time zone as created_at,
      m.read_at::timestamp with time zone as read_at,
      (case when m.direction = 'inbound'::text then m.read_at else null::timestamp with time zone end)::timestamp with time zone as staff_read_at,
      coalesce(m.has_attachments, false)::boolean as has_attachments,
      null::text as subject,
      m.body::text as body_text
    from public.messages m
    where m.customer_id is not null
      and m.direction = 'inbound'::text
      and m.read_at is null
      and coalesce(nullif(m.message_type, ''::text), 'sms'::text) in ('sms'::text, 'whatsapp'::text)
    order by m.created_at desc,
      ((coalesce(nullif(m.message_type, ''::text), 'sms'::text) || ':'::text) || m.id::text) desc
    limit (select unread_limit from limits)
  ),
  email_unread as (
    select
      ('email:'::text || em.id::text)::text as id,
      em.customer_id::uuid as customer_id,
      'email'::text as channel,
      em.direction::text as direction,
      coalesce(em.received_at, em.sent_at, em.created_at)::timestamp with time zone as created_at,
      null::timestamp with time zone as read_at,
      em.staff_read_at::timestamp with time zone as staff_read_at,
      coalesce(em.has_attachments, false)::boolean as has_attachments,
      em.subject::text as subject,
      em.body_text::text as body_text
    from public.email_messages em
    where em.customer_id is not null
      and em.direction = 'inbound'::text
      and em.staff_read_at is null
    order by coalesce(em.received_at, em.sent_at, em.created_at) desc,
      ('email:'::text || em.id::text) desc
    limit (select unread_limit from limits)
  ),
  unread as (
    select u.*
    from (
      select * from sms_unread
      union all
      select * from email_unread
    ) u
    order by u.created_at desc, u.id desc
    limit (select unread_limit from limits)
  )
  select
    r.id, r.customer_id, r.channel, r.direction, r.created_at, r.read_at,
    r.staff_read_at, r.has_attachments, r.subject, r.body_text,
    false as is_unread_row
  from recent r
  union all
  select
    un.id, un.customer_id, un.channel, un.direction, un.created_at, un.read_at,
    un.staff_read_at, un.has_attachments, un.subject, un.body_text,
    true as is_unread_row
  from unread un
  order by is_unread_row desc, created_at desc, id desc
$function$;

comment on function public.get_inbox_communications(integer, integer) is
  'Messages inbox: the newest p_recent_limit rows of customer_communications (is_unread_row false) '
  'and the newest p_unread_limit unread rows (is_unread_row true), read from the base tables with '
  'per-table limits. Ten inbox columns only. Read-only. Called by CommunicationsService.getInbox '
  'through the service role.';

revoke execute on function public.get_inbox_communications(integer, integer) from public, anon, authenticated;
grant execute on function public.get_inbox_communications(integer, integer) to service_role;
