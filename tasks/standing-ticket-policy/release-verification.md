# Event booking release verification

Owner approved the exact standing migration, rollback and both application releases on 6 September 2026. Garden blocking is a separate authorised draft, awaiting approval of its final SQL.

## Website

PR: https://github.com/peterjpitcher/the-anchor.pub/pull/145
Production commit: 891ea37fdd37041fa2b5f6e260b538a4f0951634
Production deployment: dpl_HrdAy4xe24sp5y6Ssz5XSz7KjMag
Canonical www.the-anchor.pub alias matched that Ready deployment.

Live browser at the Detention Disco event: picker changed to six; no Seats input or ticket-type radios; phone link for groups above six; About immediately after Highlights; mobile More event details expanded and had 24px top margin. Desktop order also checked. Turnstile reported Success; its own frame emitted opaque console entries, with no application error observed. No form was submitted.

Read-only website availability for six returned success:true, available:true. Live database snapshot was 43 seated and 11 standing remaining, explaining why standing was hidden.

Website lint, types, 191 suites (2089 passed, one skipped) and build passed. UTC rerun used Node 20 directly. GitHub checks passed. Deployment runtime error query returned no logs.

## Management and migration

PR: https://github.com/peterjpitcher/the-anchor-management-tools/pull/130
Production commit: 97d69bb58289c73c41eb804caabb7040615e78d2
Production deployment: dpl_HkA3gLRbgxBz1v5kw4fok34sctLY
Canonical management.orangejelly.co.uk matched that Ready deployment.
GitHub checks passed before merge. Live API invalid payload returned HTTP 400 VALIDATION_ERROR before any booking claim or customer write.

Applied through Supabase MCP on 6 September 2026 at 14:36:10 UTC. Repo migration 20260906134726_event_standing_after_seated_sold_out.sql maps to production history version 20260906143610, name event_standing_after_seated_sold_out. SQL checksum unchanged from approval.

Live function body MD5 ed0166fe809bfc2994eb0c0bf64ba077 matched the approved body. SECURITY DEFINER, public search_path and restricted ACL remained intact. Anon and authenticated EXECUTE false, service_role true. Live non-writing function calls returned blocked/invalid_seats and blocked/event_not_found. All nine anonymous-surface checks passed. Capacity remained 43 seated and 11 standing. Deployment error query returned no logs. Exact rollback remains available in rollback.sql.

The full standing booking and provider-call paths were tested in isolated fixtures, not by creating a live booking or sending a real message.

Approved migration SHA-256: fc98f0fd9cb61d202452c98ddd29eb12dbef209ac3000300c69e0c792e9c51c6.
Production project ref: tfcasgxopxegwrabvwat.
Pre-apply live function body matched captured rollback (MD5 177f299c225f40cb20d357ebf4a54893); restricted ACL unchanged.

Management final London and UTC suites each passed: 759 files, 6829 passed, two skipped. Production build completed with 155 static pages. One earlier parallel run hit an unrelated image-test timeout; both the focused retry and full London rerun passed. Final checks explicitly used Node 20.

## Scope

Changed website files are listed in the website discovery report; changed management files are listed in approval.md. Existing email wording, staff seating flexibility, unrelated payment/marketing work and other pending migrations were deliberately left unchanged. No production bookings, messages or payments were created.

## Garden draft

Final reviewed draft: supabase/migrations/20260906140724_outside_private_hire_blocking.sql. SHA-256 993d767e73c91a3511f574b277c00e4e793e5e7e6c6e5be3302908a252c00e73. Exact rollback and production approval packet are in tasks/garden-private-hire/. All 36 checks passed, including actual move, cash-deposit and payment-confirmation routines alongside competing edits. Independent review repeated the original deadlock reproduction successfully after correction. No application files need changing for garden enforcement. Not applied.
