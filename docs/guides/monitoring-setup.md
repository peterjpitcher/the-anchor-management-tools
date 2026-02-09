# Monitoring Setup Guide

This guide documents the monitoring approach currently used by this project.

## Monitoring Stack

- Structured application logs from server and API code.
- Vercel runtime logs and deployment telemetry.
- Health checks and cron status endpoints.
- Audit and job status data stored in Supabase.

## Baseline Setup

1. Ensure production logs are enabled in Vercel.
2. Verify cron routes are protected and monitored.
3. Confirm failed jobs are surfaced through existing job/audit flows.
4. Review logs daily for repeated errors and webhook failures.

## Recommended Checks

- API error rate by endpoint.
- Cron run success/failure and duration.
- Webhook validation failures.
- Background job retry volume.
- SMS and payment failure patterns.

## Incident Workflow

1. Detect issue from logs, job failures, or user reports.
2. Correlate request IDs and timestamps across logs and audit entries.
3. Mitigate (rollback, feature flag, or targeted patch).
4. Add a regression test for the failed path.
5. Record the incident in your internal ops notes.
