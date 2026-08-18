-- Employees section review, reproducible evidence queries
-- Baseline run: 2026-08-18. Re-run immediately before each release.
-- Contains no personal data. Identify people by employee_id, never by name.

-- E1. Headcount by status.
-- Baseline: Active 12, Onboarding 0, Started Separation 0, Former 46.
select status, count(*) from employees group by status order by 1;

-- E2. Active employees missing a right to work record. Baseline: 6.
select e.employee_id
from employees e
where e.status in ('Active','Started Separation')
  and not exists (select 1 from employee_right_to_work r where r.employee_id = e.employee_id);

-- E3. Right to work checked AFTER employment started. Baseline: 4.
select r.employee_id, e.employment_start_date, r.verification_date
from employee_right_to_work r join employees e using (employee_id)
where e.employment_start_date is not null and r.verification_date > e.employment_start_date;

-- E4. Active employees with no onboarding checklist row. Baseline: 5.
select e.employee_id from employees e
where e.status in ('Active','Started Separation')
  and not exists (select 1 from employee_onboarding_checklist k where k.employee_id = e.employee_id);

-- E5. Active employees with no pay settings row. Baseline: 2.
select e.employee_id from employees e
where e.status in ('Active','Started Separation')
  and not exists (select 1 from employee_pay_settings p where p.employee_id = e.employee_id);

-- E6. Active employees with no employment start date. Baseline: 1.
select employee_id from employees
where status in ('Active','Started Separation') and employment_start_date is null;

-- E7. THE DIVERGENCE. Roster list column vs Holidays tab, per employee, for 2026.
--     Baseline: 11 rows, of which 8 disagree. Largest gap 27 vs 4.
--     After PR 1 both columns must be equal for every row.
with tab as (
  select lr.employee_id,
         sum((select count(*) from generate_series(lr.start_date, lr.end_date, interval '1 day') d
              where extract(isodow from d) <= 5
                and not (extract(isodow from d)::int = any (coalesce(ps.non_working_weekdays,'{}')::int[]))))
         as tab_days
  from leave_requests lr
  left join employee_pay_settings ps on ps.employee_id = lr.employee_id
  where lr.status = 'approved' and lr.holiday_year = 2026
  group by lr.employee_id
),
roster as (
  select ld.employee_id, count(*) as roster_days
  from leave_days ld join leave_requests lr on lr.id = ld.request_id
  where lr.status = 'approved' and ld.leave_date between '2026-01-01' and '2026-12-31'
  group by ld.employee_id
)
select e.employee_id, coalesce(r.roster_days,0) as roster_list, coalesce(t.tab_days,0) as holidays_tab,
       coalesce(r.roster_days,0) <> coalesce(t.tab_days,0) as disagrees
from employees e
left join roster r using (employee_id) left join tab t using (employee_id)
where e.status in ('Active','Started Separation') and coalesce(r.roster_days,0) > 0
order by 2 desc;

-- E8. Pending leave requests and their age. Baseline: 8, oldest raised 2026-07-17.
select id, start_date, end_date, created_at::date as raised,
       (current_date - created_at::date) as days_waiting,
       (start_date - current_date) as days_until_start
from leave_requests where status = 'pending' order by start_date;

-- E9. Data integrity: orphan days, days left behind by declined requests, duplicates.
--     Baseline: 0, 0, 0.
select
 (select count(*) from leave_days ld left join leave_requests lr on lr.id = ld.request_id
    where lr.id is null) as orphan_days,
 (select count(*) from leave_days ld join leave_requests lr on lr.id = ld.request_id
    where lr.status = 'declined') as declined_leftovers,
 (select count(*) from (select employee_id, leave_date from leave_days
    group by 1,2 having count(*) > 1) x) as duplicate_days;

-- E10. Future leave days belonging to former employees. Baseline: 0.
select ld.employee_id, ld.leave_date from leave_days ld join employees e using (employee_id)
where e.status = 'Former' and ld.leave_date >= current_date;

-- E11. DOUBLE BOOKING. Leave days that already sit on a scheduled rota shift. Baseline: 7.
select ld.employee_id, ld.leave_date, rs.start_time, rs.end_time
from leave_days ld
join leave_requests lr on lr.id = ld.request_id and lr.status <> 'declined'
join rota_shifts rs on rs.employee_id = ld.employee_id and rs.shift_date = ld.leave_date
where rs.status = 'scheduled' order by ld.leave_date;

-- E12. ROLLOUT GATE for the new mandatory onboarding step.
--      Must be 0 at deploy time, otherwise ship the step optional for one week first.
select count(*) as live_incomplete_invites from employee_invite_tokens
where completed_at is null and expires_at > now();

-- E13. Requests longer than the 35 day holiday sanity limit. Baseline: 1 (the 63 day block).
--      This is the record that needs owner sign off to reclassify as 'unavailable'.
select id, employee_id, start_date, end_date, (end_date - start_date + 1) as days, status
from leave_requests where (end_date - start_date + 1) > 35 order by days desc;

-- E14. Employees with non_working_weekdays set. Baseline: 0.
--      Confirms the column is dead before PR 1 stops reading it.
select employee_id, non_working_weekdays from employee_pay_settings
where non_working_weekdays is not null and array_length(non_working_weekdays, 1) > 0;

-- E15. Access control: current policies on the tables PR 2 changes.
--      Baseline: leave_requests, leave_days and employee_pay_settings each carry a single
--      permissive FOR ALL policy with USING (auth.uid() IS NOT NULL).
select c.relname as tbl, pol.polname, pol.polcmd::text as cmd,
       pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
from pg_policy pol join pg_class c on c.oid = pol.polrelid
where c.relname in ('leave_requests','leave_days','employee_pay_settings',
                    'employee_financial_details','employee_health_records')
order by 1, 2;

-- E16. Confirms employees:export does not exist. Baseline: 0 rows.
select * from permissions where module_name = 'employees' and action = 'export';

-- E17. Post-migration reconciliation for PR 1. Every leave request must have a valid type
--      and the day count must not have changed. Run before and after; totals must match.
select (select count(*) from leave_requests) as requests,
       (select count(*) from leave_days) as days,
       (select count(*) from leave_requests where leave_type is null) as untyped;
