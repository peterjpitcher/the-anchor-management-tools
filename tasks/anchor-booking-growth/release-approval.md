# Production release approval package

Approved by the owner on 5 September 2026. Production project: the-anchor-management-tools, tfcasgxopxegwrabvwat, tfcasgxopxegwrabvwat.supabase.co. Both migrations, eight menu corrections and 15 dated capacities have been applied. See release-result.md for deployment and activation evidence. This packet preserves the exact reviewed SQL and checksums.

## Changes requiring exact approval

1. Christmas migration: `20260905100155_christmas_course_snapshot.sql`, SHA-256 `92af6c81488e03aafd15286d82aa570a91273c55c1f21b4aa4f357d813079b21`. Full SQL: [Christmas migration](../../supabase/migrations/20260905100155_christmas_course_snapshot.sql). Risk, validation, preserved booking behaviour and rollback: [Christmas review](christmas-policy-verification.md).
2. Event-request migration: `20260905100521_event_booking_dining_requests.sql`, SHA-256 `7a2fb0cf3d419601d978cdac8d10c3ac3f754c4d1e9223a318ad92bbf0c3ab8f`. Full SQL and exact function-drop rollback: [event-request review](../event-dining-request-migration-2026-09-05.md).
3. After both compatible applications are deployed and checked, activate Christmas course support using the separately checksummed guarded setting SQL in christmas-policy-verification.md. Disable using its guarded rollback if necessary; retain customer snapshots.
4. Replace the eight generated menu descriptions below only while each still matches the captured old text. Names, prices, ingredients and dietary flags are not changed. Exact IDs, before-text template and guard are in menu-corrections.json.

| Dish | Replacement description |
|---|---|
| Mayonnaise | Mayonnaise. |
| Bisto Gravy | Bisto gravy. |
| Burger Sauce | Burger sauce. |
| Mint Sauce | Mint sauce. |
| Strawberry Sauce | Strawberry sauce. |
| Broccoli Cheese | Broccoli cheese. |
| Add crispy bacon | Add crispy bacon. |
| Add hash brown | Add hash brown. |

## Ordered release

Recheck project identity, migration history and checksums. Apply the exact approved migrations through the connected migration API. Re-read definitions, permissions, history and anonymous access. Release management before the website, then activate course support only after compatible consumers are verified. Apply guarded menu edits through the existing authorised menu path. Check production aliases, deployment IDs and read-only booking pages.

No real booking, message, payment or refund is part of this approval package. Mutating tests remain isolated. No campaign or spend is included.

## Outstanding operational data

Dated sellable event capacities remain unchanged until the venue provides exact numbers for capacity-review.md. The existing Halloween capacity remains 100 as recorded. Guidance capacities are not substituted for actual layouts. The live September karaoke record is retained despite the report's 2027 statement.

The promotion brief is prepared, but final service dates, capacity, assets, attribution and cost checks must be settled before a separate campaign approval. GA4 session/device reporting and measured first-human-response time remain unavailable in this review.
