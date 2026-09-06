# Christmas course policy implementation and migration review

Status: exact migration applied to production on 5 September 2026 as version `20260905124506`, after owner approval. The review below records the pre-apply state. See `release-result.md` for activation, deployment and post-apply evidence. No customer bookings, payments or communications were created for testing.

## Verified current contract

The repository's `.env.local` resolves to `tfcasgxopxegwrabvwat.supabase.co`. Read-only catalogue queries on 5 September 2026 matched that project.

The live `christmas-2026` period is active from 10 November to 20 December 2026. Its configuration is 6 to 20 guests, 24 hours' booking notice, a 10-pound deposit per guest, required pre-orders, seven-day pre-order cutoff and seven-day refund cutoff. The existing code closes pre-orders at noon London seven calendar days before the booking, not 168 hours before the sitting. This boundary is preserved.

The live booking table has no course-tier column, and the public v06 create RPC accepts no tier argument. Existing per-seat food selections permit mixed course counts at one table. New course state therefore records an integer array in seat order; a booking-wide scalar would discard that supported behaviour.

Existing refund code includes the whole London calendar day exactly seven days before the booking. The SQL refund snapshot says "Full refund up to 7 days". The Christmas page now states this inclusive boundary. Existing financial logic and recorded promises are unchanged.

Live metadata at review: 793 booking rows, approximately 880 kB including indexes; latest applied migration `20260905052727`. Dependent views are `customer_communications` and `table_bookings_awaiting_confirmation`. Their existing columns and behaviour remain unchanged; this additive field is not exposed through them.

## Exact migration draft

File: `supabase/migrations/20260905100155_christmas_course_snapshot.sql`

Migration name: `christmas_course_snapshot`

SHA-256 at this review: `92af6c81488e03aafd15286d82aa570a91273c55c1f21b4aa4f357d813079b21`

The SQL file is the complete application payload. Recalculate the checksum after any review edit before approval.

The draft adds nullable `table_bookings.christmas_course_counts`, four service-only functions and two triggers. The new create wrapper validates every seat's tier and dishes, delegates to unchanged public v06 allocation and deposit logic, then stores the snapshot and resolved pre-order requirement in that same transaction. Blocked results never update an existing booking. The old public RPC remains unchanged.

The capability RPC returns no supported policy until `christmas_course_policy_enabled` is explicitly enabled. Its default is false. This migration does not enable it. Deploy the compatible management and website consumers, verify them with fixtures, then separately enable the setting.

The snapshot guard preserves null legacy records. New records cannot lose their snapshot or change party size without matching course choices. Date and tier changes preserve the cutoff. Explicit tier amendments clear only that changed seat's old dishes, in the same transaction, and selections cannot subsequently be inserted for a one-course seat. Other seats and all deposits remain untouched.

## Risk and rollout

`ALTER TABLE ADD COLUMN` needs a brief exclusive metadata lock, with no default, rewrite or backfill. Trigger creation also takes a short table lock. Functions use SECURITY INVOKER and fixed search paths. All new executable functions revoke PUBLIC, anon and authenticated access and grant only service_role. No existing grant, RLS policy, refund promise or historical booking is changed.

The conditional DELETE in the amendment trigger is a high-risk statement requiring review: it runs only after an explicit course-count change on a booking carrying the new snapshot and clears dishes for the changed seats. A failed update rolls it back. It prevents the kitchen receiving dishes the amended tier no longer includes. The isolated SQL fixture covers this behaviour.

Management and website code must be deployed before activation. Missing schema or a disabled setting never advertises course support. Existing clients continue the legacy path; supplied new course fields cannot silently fall back if the wrapper is unavailable.

## Validation completed

- Isolated PostgreSQL 17 executes the complete migration inside a fixture transaction and rolls it back, using `tests/db/christmas-course-snapshot.sql`.
- SQL fixtures prove the default-off capability returns no policy before the test setting is enabled, using the same wrapped-value lookup as the live get_setting_bool helper. They cover six and twenty one-course guests and 60/200-pound deposits; five and twenty-one rejected; missing tiers and missing dishes rejected; mixed one/two/three-course snapshots; dates after the pre-order cutoff rejected; date and headcount amendments; blocked conflict with an existing ID; allocator failure; legacy null snapshots; changed-tier dish clearing; one-course dish rejection; service-only grants.
- The allocator in this isolated SQL harness is a fixture. It proves wrapper and trigger behaviour, not the full live allocation system. The production v06 allocator is unchanged and was inspected read-only.
- Management targeted tests: 75 baseline/course/party-edit tests, 84 deposit/Christmas/cutoff/fixture-rendered confirmation tests, and 19 create/error route tests passed in their recorded runs. These groups overlap.
- Website targeted tests: 51 course-picker and Christmas-page tests passed before final inclusive-refund copy adjustment. Parent integration checks must rerun after the final copy adjustment.
- Idempotency tests confirm omitted fields retain old hashes, identical arrays replay and changed tiers conflict.
- Existing GMT, BST and clock-change cutoff tests pass. No real SMS or email was sent: confirmation templates were rendered with mocked transports and checked for missing or invalid values.
- Parent owns final full-suite, lint, typecheck, production build and browser verification across both repositories. Do not interpret this file as proof of live deployment.

## Safe rollback and post-apply checks

Default rollback is to disable `christmas_course_policy_enabled`, leaving the additive schema, stored snapshots and historical choices intact. Do not drop the column after bookings use it. Existing snapshots remain readable and enforced. A forward fix is required if snapshot-aware amendments are affected.

Before application, re-read the exact file and recheck its checksum and project identity. After approved application, confirm migration history, column and trigger definitions, function grants and the anonymous-surface report. Keep the feature disabled until the paired deployments pass fixture booking, retry, amendment and payment-review checks. Activation is a separate production setting change and is not performed by this draft.

## Exact activation and rollback setting payloads

A read-only live query confirmed `christmas_course_policy_enabled` is absent on project `tfcasgxopxegwrabvwat`. Its original behaviour is disabled through the default false. No setting value has been changed.

The separate activation payload is `tasks/anchor-booking-growth/christmas-course-activate.sql`, SHA-256 `b3bacf187e3b25ce1ab474b8f78a4fa2791b24f9f53ec1dc223a7c65396e2085`. It refuses to run if the key already exists, so changed starting state requires fresh review. Apply only after the migration and paired deployments pass verification.

The exact disable rollback is `tasks/anchor-booking-growth/christmas-course-disable.sql`, SHA-256 `5dc3e2c507c09edb7ae2ed9a0e81af4a39ce75d9a014ad0aab06dc73d947a9fc`. It changes only the reviewed true value to false and refuses any unexpected state. It restores the original disabled behaviour while retaining the setting row and all booking snapshots.

Both complete SQL payloads executed in an isolated PostgreSQL transaction using `tests/db/christmas-course-activation.sql`: activation returned the true setting, rollback returned false, and the harness rolled all objects back. No production setting changed.

This rollback retains the new schema and recorded snapshots. It stops new course-aware bookings and also refuses multi-course/date amendments that need the disabled capability. Read-only staff views and existing financial records remain intact; repair and re-enable rather than dropping snapshots.

Final targeted follow-up: 19 create/error-route tests passed after their mocks were aligned; 116 website enquiry, page, course-picker and SSOT checks passed under UTC. Management gained explicit one/two/three-course completeness and exactly-noon cutoff assertions. Those Vitest runs used the repository configuration, which pins London; setting TZ=UTC in the shell alone was not an independent UTC verification. Parent owns the UTC override-configuration run. Parent integration logs remain the final authority for full-suite/build checks.

Public browser fixture verification completed: six one-course selectors without menu fields; incomplete mixed selections blocked progression; complete mixed choices enabled it; after-cutoff two/three-course choices disabled. Fixture matched the enabled two-screen live flag. No booking was submitted from this check; blocked telemetry produced expected fetch errors. Sanitised evidence and screenshots are under /tmp/anchor-growth/christmas/.
