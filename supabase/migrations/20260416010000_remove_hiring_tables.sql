-- Remove hiring tables and related job queue entries

begin;

-- Remove hiring-related jobs that are no longer supported.
delete from public.jobs
where type in ('parse_cv', 'screen_application');

-- Drop hiring tables (data removal is implicit).
drop table if exists public.hiring_application_messages cascade;
drop table if exists public.hiring_application_overrides cascade;
drop table if exists public.hiring_interview_attendees cascade;
drop table if exists public.hiring_interviews cascade;
drop table if exists public.hiring_outreach_messages cascade;
drop table if exists public.hiring_screening_runs cascade;
drop table if exists public.hiring_notes cascade;
drop table if exists public.hiring_candidate_events cascade;
drop table if exists public.hiring_candidate_profile_versions cascade;
drop table if exists public.hiring_candidate_documents cascade;
drop table if exists public.hiring_applications cascade;
drop table if exists public.hiring_candidates cascade;
drop table if exists public.hiring_jobs cascade;
drop table if exists public.hiring_job_templates cascade;

-- Drop hiring enums now that tables are gone.
drop type if exists public.hiring_candidate_source;
drop type if exists public.hiring_application_stage;
drop type if exists public.hiring_job_status;

commit;
