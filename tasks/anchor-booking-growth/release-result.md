# Approved booking-growth production release

Owner approval received on 5 September 2026 for the exact migration, activation, menu and paired deployment packet. The owner also confirmed 60 places for all 15 reviewed dated events, except Halloween at 150 and Tasting Night at 25.

## Database and data changes

Verified target: `the-anchor-management-tools`, project `tfcasgxopxegwrabvwat`, host `tfcasgxopxegwrabvwat.supabase.co`.

| Approved file | SHA-256 | Applied production version |
|---|---|---|
| `20260905100155_christmas_course_snapshot.sql` | `92af6c81488e03aafd15286d82aa570a91273c55c1f21b4aa4f357d813079b21` | `20260905124506` |
| `20260905100521_event_booking_dining_requests.sql` | `7a2fb0cf3d419601d978cdac8d10c3ac3f754c4d1e9223a318ad92bbf0c3ab8f` | `20260905124510` |

Both exact files were applied through Supabase MCP. Production history uses apply-time versions; repository filenames are retained as approved. All changed functions, triggers and grants were re-read. All five new functions are security invoker, with the expected search path and service-role-only execution. Invalid course counts and dining enums were rejected before booking writes; anonymous and authenticated roles were denied. All nine anonymous-surface checks passed, including the twelve website tables and three existing website RPCs.

Eight menu descriptions were changed through the authenticated staff menu editor, only after checking each original description. All eight saved descriptions and eight menu audit entries were verified. No prices, names or ingredient facts were edited. The original replacement packet retains the before-text for rollback.

All 15 capacities were updated using `capacity-apply.sql`, a guarded transaction with one audit entry per event. The staff editor only exposes split seated/standing fields, so it could not represent the approved total-only edit. The transaction rejected any change to other event fields. Production booking snapshots and all 15 public website event API responses match the approved totals.

## Verification and limits

The integrated tests and browser evidence are in `verification.md`. The browser confirmed synthetic private-hire, event-request and table bookings in isolated fixtures, including both table-form variants. Production checks are read-only except for the explicitly approved release data and settings. No test customer booking, message, payment, refund or campaign was created.

The changed-file list and deliberately retained counterparts are in `changed-files.md`. Original working copies and unrelated changes remain untouched. Promotion is still a prepared brief; no advertising spend or outbound campaign was authorised.

## Production deployments and activation

| Application | Released commit | Ready deployment | Verified production domain |
|---|---|---|---|
| Management | `d936a1257c363e090991680baebf6ea6149e62bd` | `dpl_6fh8AzXMGpTVHQcs1H6LRMot5pXM` | `management.orangejelly.co.uk` |
| Website | `443959e552029a30ba391f46ccf28eb58491a86f` | `dpl_G6x2MEyHZ7rx88zSp8bDyqJ8CR7y` | `www.the-anchor.pub` |

Both production-domain inspections returned the exact Ready deployment IDs above. Vercel metadata matched the full commits. Management was verified first, then website PR #135 was merged. The final website commit also preserves the latest approved terrestrial rugby update from PR #136; its integrated main-branch CI passed.

The exact approved activation file, SHA-256 `b3bacf187e3b25ce1ab474b8f78a4fa2791b24f9f53ec1dc223a7c65396e2085`, was applied only after both domains matched. The setting was still absent immediately before activation. The production function then returned policy version 1, with multiple courses available and the noon London seven-calendar-day cutoff. The public website period API confirmed the same capability and the existing GBP 60 deposit for six guests. The separately reviewed disable SQL remains ready; it was not needed or applied.

Live browser checks confirmed the short private-hire form and its enquiry wording, the optional event food/early-arrival request controls and their unconfirmed acknowledgement, and Christmas course selection. On 19 December 2026, all six guests could select one course with no dish pre-order and proceed to the real details step for 18:00. No mobile number or other customer details were submitted. The refreshed public food menu contains the approved bacon/hash-brown descriptions and no generated placeholder phrase. Eight edited descriptions were separately verified in production.

Bounded error-log reads for both released deployments returned no runtime errors. No unapplied release migration remains. Advertising and outbound promotion remain outside this approved release.
