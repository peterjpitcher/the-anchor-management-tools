# Maintenance tracker: approved owner decisions

Date: 2026-09-05

Status: owner decisions recorded, local documentation only. No feature implementation, migration, deployment or email send performed.

This addendum records the owner's numbered response to the developer review. It takes precedence over conflicting proposals in the original specification and review. Both original documents are retained; the developer review links here to avoid treating its historical recommendations as current requirements.

## Agreed decisions

| Decision | Agreed requirement |
|---|---|
| D1: photo ordering | Save the item first, then add photos. A failed attachment must not discard the saved item. |
| D2: cancellation and retention | Cancel mistaken items rather than ordinarily deleting them. Exceptional removal is controlled and attributed. D3 means the authorised operator must be a super-admin, even where the earlier review used the word manager. |
| D3: access | Super-admins only for all interactive actions, including viewing, reporting, editing, notes, photos, costs, history and area administration. No access for manager, staff, FOH staff or portal-only staff merely because they hold those roles. |
| D4: weekly visibility | Include all outstanding maintenance items in the existing Friday managers email at 09:00 Europe/London, to `manager@the-anchor.pub`, alongside all content already in that email. |
| D5: costs | Display our open estimates separately from unknown costs, in pounds including VAT. Unknown amounts remain unknown rather than becoming zero. |
| D6: statuses | Keep all eight proposed statuses. Initially record scheduled visit details in notes rather than adding calendar integration. |
| D7: digest scope | Resolved by D4. Extend the existing Friday email. Do not create the proposed separate Monday maintenance digest or leave the required email integration as an optional future phase. |
| D8: areas | The proposed editable seed list is approved. |

Recipient source: the owner's explicit message in this conversation. The backslash before `@` in the message is formatting, not part of the email address.

Approved statuses: `reported`, `quoting`, `awaiting_landlord`, `scheduled`, `in_progress`, `on_hold`, `done`, `cancelled`.

Approved seed areas: Main Bar, Dining Room, Kitchen, Cellar, Toilets (Ladies), Toilets (Gents), Toilets (Accessible), Beer Garden and Terrace, Car Park, Exterior and Building, Function Room, Staff Areas, Plant and Utilities, Signage, Other.

## Consequences for the developer

### Access and audit

The earlier reporter-versus-manager matrix, staff reporting flow and field visibility split are superseded. Use one super-admin access boundary across pages, actions, database operations, storage, history and count responses. Do not add grants for other staff roles or broaden portal access. A generic maintenance permission granted to another role must not accidentally defeat the explicit super-admin-only requirement.

The scheduled email is an expressly requested system operation to the approved manager mailbox. It does not grant the mailbox user interactive maintenance access. Detail links must retain super-admin authentication and authorisation. Keep exceptional removal within the same super-admin boundary and preserve an attributed record where appropriate.

F07 to F09 and F23 require a simpler implementation than originally proposed, but identity integrity, audit access, role enforcement and deliberate activation remain relevant. There is no separate staff-grant activation stage to assume. The super-admin bypass identified in F23 still matters if the implementation promises an explicit disabled state.

### All outstanding items in the existing Friday email

Interpret outstanding as every item with a status other than `done` or `cancelled`, across both issues and improvements. Include undated items, low-priority items, on-hold items, items with Greene King, items with responsibility still to confirm and items with distant target dates. No age, due-date or responsibility filter may silently omit them.

Each outstanding item should appear once in a maintenance section with its reference, title, area, status, priority, responsibility and target date, including a clear indication when the date is unset. Use authenticated detail links. This compact presentation is a developer recommendation for fulfilling the agreed complete list, not a new owner-supplied business fact.

Preserve every existing email section, recipient behaviour for other content and operational safeguard. The approved maintenance recipient is `manager@the-anchor.pub`; if the existing email sends to additional recipients, verify that maintenance data is not automatically disclosed to them. Do not add a second send or a separate cron merely to work around locating the existing integration. The existing email must still run when maintenance has no outstanding items.

Load the complete outstanding set, including any necessary database pagination. A UI page limit, preview subset or summary total is not a substitute for all items. Define bounded rendering or an approved complete-list attachment if email size becomes a practical constraint, without silently truncating records. On a maintenance query failure, preserve the existing email's other content and make the missing maintenance section explicit to both the recipient and operational monitoring; do not report zero outstanding items.

Use Friday 09:00 Europe/London throughout summer and winter. Reuse the actual email's scheduling and duplicate-send protection once located. The former twenty-one-day landlord and thirty-day inactivity rules are no longer inclusion criteria. Their dedicated ageing machinery is not required merely to satisfy this email requirement; retain ordinary audit history and timestamps.

The owner has specified the weekly visibility mechanism, not named a separate human triage assignee or authorised an emergency notification service. Do not invent either. The nav count can remain an in-app aid but must not be treated as the only way undated work is surfaced.

### Existing email integration: evidence and remaining technical dependency

Current source inspection found these related jobs:

- [Private-bookings weekly summary](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/private-bookings-weekly-summary/route.ts): the source gates normal sends to Monday, defaulting to 09:00 London. `vercel.json` invokes the route hourly. Its content includes bookings, pending SMS and stale outcomes.
- [Checklist weekly summary](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/checklists-weekly-summary/route.ts): Monday 09:00 London, using the checklist outbox.
- [Cron configuration](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/vercel.json): rota manager alert scheduled for Sunday at 18:00 UTC. No Friday-specific cron entry was found.

Searches of current source, tasks, documentation and scripts did not identify the combined Friday managers email described by the owner. This is a limitation of the inspected checkout, not evidence that the email does not exist or fails to send. No production email run was invoked and no delivered email was inspected.

Before implementation, identify the actual Friday email producer and its current content, schedule, recipients and delivery protection. Check the deployed source or other existing integration if necessary. Do not repurpose the Monday private-bookings or checklist job on the assumption that it is the owner's Friday email. Record the verified integration point in the implementation plan and preserve its existing content through a before/after fixture comparison.

### Costs and lifecycle

The agreed headline spend is our open estimates in GBP including VAT, with uncosted items shown separately. Keep landlord-paid and responsibility-to-confirm items separate from our estimated spend. Retain the review's distinction between estimates/recorded actual costs and verified payments. No invoice integration or tax calculation workflow is added.

Save-first capture, cancellation instead of ordinary deletion, eight statuses and editable areas are settled. Completion/reopening consistency, concurrency, photo feasibility, audit atomicity and the technical error-handling requirements still need implementation and verification.

## Revised acceptance requirements

These supersede the review's reporter/manager and standalone phase 2 digest scenarios.

1. A super-admin can create an issue or improvement, add photos and notes, change fields, complete, reopen, cancel and administer areas. Other roles cannot read or mutate maintenance data through the UI, actions, counts, database or signed-photo paths.
2. Saving an item and adding a photo are separate recoverable operations. Failed or retried uploads neither delete the item nor create duplicate attachments.
3. Mistaken items are cancelled; normal controls do not destroy their history. Exceptional removal requires the authorised super-admin path and attribution.
4. The Friday email contains every outstanding status, both kinds and all responsibility values, including undated/on-hold/future-dated records. Done and cancelled items are excluded. Each included item appears once.
5. Existing Friday email sections and delivery behaviour are preserved. A maintenance-empty run does not suppress the existing email. A maintenance read failure is clearly identified while retaining other content.
6. Friday 09:00 London is exercised across both daylight-saving transitions. Repeated invocation does not duplicate the combined email. The approved maintenance destination is exactly `manager@the-anchor.pub`.
7. Cost examples distinguish zero from unknown and display our outstanding estimates in pounds including VAT. Other responsibility categories do not inflate our total.
8. The eight statuses and fifteen approved area seeds are present. Scheduled details are recorded in notes and no calendar event is implied.
9. The remaining upload, audit, date, accessibility, database and deployment gates in the original review still apply, adjusted to super-admin-only users and the single existing Friday email integration.

## Readiness after the decisions

All eight owner responses are recorded. The original broad staff permissions and standalone digest are no longer open decisions. The developer still needs to resolve the photo/runtime proof, audit guarantees, detailed lifecycle rules and the identity of the existing Friday email integration before claiming the feature is ready to ship.

Only this addendum and the review's update notice were changed for this decision handoff. The original specification, application code, email schedules and migrations remain unchanged. No messages were sent.
