-- Read-only baseline. Change only these two London boundaries for later cohorts.
-- Cohort: records created in this window, not bookings occurring in this window.
with bounds as (
  select timestamptz '2026-08-08 00:00 Europe/London' as starts,
         timestamptz '2026-09-05 00:00 Europe/London' as ends
), dining as (
  select source, status, count(*) as bookings, sum(party_size) as booked_covers,
    count(*) filter (where status::text not in ('cancelled','no_show')
      and (seated_at is not null or completed_at is not null)) as attendance_marked,
    count(*) filter (where status::text in ('cancelled','no_show')
      and (seated_at is not null or completed_at is not null)) as conflicting_attendance
  from table_bookings, bounds
  where created_at >= starts and created_at < ends
    and booking_purpose='food' and event_booking_id is null
  group by source,status
), hire as (
  select status,count(*) as enquiries,
    count(*) filter(where deposit_paid_date is not null) as deposit_recorded,
    count(*) filter(where total_amount > 0) as nonzero_header_values
  from private_bookings,bounds where created_at >= starts and created_at < ends
  group by status
), events as (
  select status,count(*) as reservations,sum(seats) as reserved_seats
  from bookings,bounds where created_at >= starts and created_at < ends
    and not coalesce(is_reminder_only,false) group by status
), analytics as (
  select event_type,count(*) as raw_events,
    count(distinct table_booking_id) as distinct_table_bookings,
    count(distinct event_booking_id) as distinct_event_bookings,
    count(distinct private_booking_id) as distinct_private_bookings
  from analytics_events,bounds where created_at >= starts and created_at < ends
    and event_type in ('table_booking_created','event_booking_created','private_booking_confirmed')
  group by event_type
)
select jsonb_build_object(
  'dining',(select jsonb_agg(dining) from dining),
  'private_hire',(select jsonb_agg(hire) from hire),
  'events',(select jsonb_agg(events) from events),
  'analytics',(select jsonb_agg(analytics) from analytics)
);

-- Supplement: effective private-hire charges, aggregated before the cohort join.
with cohort as (
 select id,status from private_bookings
 where created_at >= timestamptz '2026-08-08 00:00 Europe/London'
   and created_at < timestamptz '2026-09-05 00:00 Europe/London'
), values_by_booking as (
 select c.id,c.status,count(i.id) as items,coalesce(sum(i.line_total),0) as line_total
 from cohort c left join private_booking_items i on i.booking_id=c.id group by c.id,c.status
)
select status,count(*) as bookings,count(*) filter(where items>0) as with_items,
 count(*) filter(where line_total>0) as nonzero_item_totals,sum(line_total) as item_totals
from values_by_booking group by status;

-- Supplement: event analytics reconciliation at reservation-ID grain.
with c as (
 select id from bookings
 where created_at >= timestamptz '2026-08-08 00:00 Europe/London'
 and created_at < timestamptz '2026-09-05 00:00 Europe/London'
 and not coalesce(is_reminder_only,false)
), a as (
 select distinct event_booking_id as id from analytics_events
 where event_type='event_booking_created'
 and created_at >= timestamptz '2026-08-08 00:00 Europe/London'
 and created_at < timestamptz '2026-09-05 00:00 Europe/London'
)
select (select count(*) from c) as booking_records,(select count(*) from a) as distinct_analytics,
 (select count(*) from c join a using(id)) as matched,
 (select count(*) from c left join a using(id) where a.id is null) as without_analytics,
 (select count(*) from a left join c using(id) where c.id is null) as outside_cohort;

-- Supplement: repeat events are not automatically duplicate customer bookings.
select count(*) as event_rows,count(distinct metadata->>'source') as sources,
 count(distinct metadata->>'seats') as seat_values
from analytics_events where event_type='event_booking_created'
 and created_at >= timestamptz '2026-08-08 00:00 Europe/London'
 and created_at < timestamptz '2026-09-05 00:00 Europe/London'
group by event_booking_id having count(*)>1;

-- Supplement: check-in event-time count, deliberately separate from creation cohort.
select count(*) as checkin_rows from event_check_ins
where check_in_time >= timestamptz '2026-08-08 00:00 Europe/London'
 and check_in_time < timestamptz '2026-09-05 00:00 Europe/London';
