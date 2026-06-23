# Spec - Guest Opt-in Capture and Permission Hardening

**Status:** Revised after adversarial review. Ready for implementation planning.
**Date:** 2026-06-22
**Repos checked:**
- Management app: `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`
- Public site: `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub`

## 0. Relationship to shipped communications logging

This spec extends the communications logging work that has already shipped. It must not rebuild it.

Existing code to preserve:

- `src/lib/notifications/notify.ts`
- `src/lib/notifications/channel.ts`
- `src/lib/notifications/routing-matrix.ts`
- `src/lib/twilio.ts`
- `src/app/api/webhooks/twilio/route.ts`
- `src/app/actions/customerSmsActions.ts`
- `src/services/gdpr.ts`
- `notification_deliveries` and `notification_attempts`

Implementation rules:

1. `customer_consents` becomes the authoritative audit trail for consent and opt-out evidence.
2. Existing analytics events are useful telemetry, but they are not the consent system of record.
3. Existing notification eligibility helpers stay in place. Add consent writes and permission gates around them; do not create a second routing or eligibility engine.
4. Existing Twilio STOP channel isolation stays in place. Extend it to write `customer_consents` rows alongside current customer updates.
5. Existing GDPR export, erasure, and retention services must be extended for `customer_consents`.
6. Existing WhatsApp opt-in toggles are retrofit work, not greenfield work.

## 1. Goal

Make every path that adds or enriches a guest/customer capture communication consent correctly.

This means:

1. No helper or import silently creates a customer as SMS-active.
2. Public forms show clear service-contact wording and explicit optional marketing/WhatsApp choices.
3. Staff forms record how consent was captured, including verbal capture.
4. WhatsApp opt-in is explicit and auditable.
5. Marketing sends require marketing consent and a separate marketing permission.
6. Public API proxies preserve consent fields and strip anything only staff may set.

This spec covers the contact person added to the customer table. The app does not currently collect phone/email for every attendee in a booking party, so per-attendee consent is out of scope until those details exist.

## 2. Compliance rules used

Sources checked:

- ICO PECR electronic mail marketing guidance: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/electronic-and-telephone-marketing/electronic-mail-marketing/
- ICO detailed PECR electronic mail rules: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/how-do-we-comply-with-the-pecr-electronic-mail-marketing-rules/
- Twilio WhatsApp opt-in docs: https://www.twilio.com/docs/whatsapp/api

Applied rules:

1. Booking confirmations, payment links, waitlist updates, refunds, cancellations, and operational changes are service messages. They must not contain marketing content.
2. Service messages use contract or legitimate interests as the lawful basis. A service-contact notice is transparency evidence, not marketing consent.
3. Marketing by email, SMS, WhatsApp, DM, or similar electronic message needs specific channel consent unless a valid PECR soft opt-in is deliberately enabled later.
4. For this implementation, default to explicit opt-in checkboxes for marketing. Keep `soft_opt_in` reserved but disabled.
5. WhatsApp business-initiated messaging needs explicit opt-in. A WhatsApp link click is not enough.
6. Consent must be channel-specific. Email consent is not SMS consent, and SMS consent is not WhatsApp consent.
7. Staff verbal capture must record that the customer was told what they were agreeing to.
8. Opt-out and objection must be honoured. SMS STOP clears SMS eligibility. WhatsApp STOP must not alter SMS status.

## 3. Main current risks

### 3.1 Silent SMS activation

These paths create customers with `sms_opt_in: true` without an auditable source:

- `src/lib/sms/customers.ts` via `ensureCustomerForPhone`
- `src/lib/parking/customers.ts` via `resolveCustomerByPhone`
- `src/app/actions/customers.ts` bulk import maps every imported customer to `sms_opt_in: true`
- `src/app/(authenticated)/customers/CustomersClient.tsx` appends `sms_opt_in=on` when creating a customer
- Public table booking legacy code in `components/features/TableBooking/TableBookingForm.tsx` hardcodes `customer.sms_opt_in: true`

### 3.2 Public proxies drop consent

The public site API routes normalize payloads before forwarding to the management app. Today they keep phone/email but do not preserve any comms consent object:

- `app/api/table-bookings/route.ts`
- `app/api/table-bookings/create/route.ts`
- `app/api/event-bookings/route.ts`
- `app/api/event-waitlist/route.ts`
- `app/api/public/private-booking/route.ts`
- `app/api/private-booking-enquiry/route.ts`
- `app/api/parking/bookings/route.ts`
- `app/api/parking/payment/create-order/route.ts`

### 3.3 Lookup can create a customer

Management `src/app/api/customers/lookup/route.ts` can create a customer from legacy private booking data through `ensureCustomerForPhone`. That means a lookup is not purely read-only.

Required change: customer lookup must not set opt-in. Prefer not creating a customer at lookup time; defer creation until booking submit where consent context exists.

### 3.4 Permission model is too broad

Current consent-changing actions rely on broad permissions:

- SMS/WhatsApp toggles use `customers:edit`.
- Customer create/import uses `customers:manage`.
- Manual/bulk messages use `messages:send`.

This is not enough for consent. A user who can edit a customer should not automatically be allowed to opt someone into WhatsApp or marketing.

## 4. Required data model

### 4.1 Add append-only consent audit

Create `customer_consents`:

| Column | Notes |
|---|---|
| `id` | UUID primary key |
| `event_sequence` | Monotonic sequence or identity used as a tiebreaker after `captured_at` |
| `customer_id` | FK to `customers` |
| `channel` | `email`, `sms`, `whatsapp` |
| `purpose` | `service`, `marketing` |
| `status` | `opted_in`, `opted_out`, `objected`, `unknown`, `legacy` |
| `legal_basis` | `contract`, `legitimate_interests`, `consent`, `soft_opt_in`, `unknown` |
| `source` | Capture point enum, see section 7 |
| `capture_method` | `checkbox`, `staff_verbal`, `profile_toggle`, `import_attestation`, `api_field`, `inbound_keyword`, `system_migration`, `service_notice`, `provider_event` |
| `consent_text_version` | Version string |
| `consent_text` | Snapshot text shown or read |
| `captured_at` | Timestamp |
| `captured_by_user_id` | Staff user, nullable for public forms |
| `source_url` | Public page URL if available |
| `ip_hash` | Optional, hashed only |
| `user_agent` | Optional |
| `related_entity_type` | `table_booking`, `event_booking`, `event_waitlist`, `private_booking`, `parking_booking`, `customer`, `message`, `import` |
| `related_entity_id` | UUID/text ID |
| `metadata` | JSONB |

Rules:

- Never update audit rows, except GDPR redaction of direct or indirect personal data.
- Service notice evidence is `purpose='service'`, `capture_method='service_notice'`, and `status='unknown'`. Do not model it as consent.
- Latest state ordering is `captured_at DESC, event_sequence DESC`.
- Writes that change customer summary fields must also insert audit rows in the same transaction.
- Use one transactional RPC/service method for audit row plus summary update. Guard each customer with `SELECT FOR UPDATE` or an advisory lock.
- Keep a minimal non-PII suppression record after erasure where needed to avoid re-contacting opted-out or objected customers.

Initial `source` enum values:

- `public_table_booking`
- `public_event_booking`
- `public_event_waitlist`
- `public_private_booking`
- `public_parking_booking`
- `staff_table_booking`
- `staff_event_booking`
- `staff_private_booking`
- `staff_parking_booking`
- `customer_profile`
- `customer_import`
- `customer_lookup_legacy`
- `twilio_inbound_sms`
- `twilio_inbound_whatsapp`
- `direct_message`
- `system_migration`
- `gdpr_action`

### 4.2 Keep customer summary fields, but define them

Use existing summary fields where available:

- `sms_opt_in`
- `marketing_sms_opt_in`
- `email_status`
- `marketing_email_opt_in`
- `whatsapp_opt_in`
- `marketing_whatsapp_opt_in`
- `whatsapp_status`
- `whatsapp_opt_in_at`
- `whatsapp_opted_out_at`

Add missing timestamp/source fields:

- `sms_opt_in_at`
- `sms_opted_out_at`
- `marketing_sms_opt_in_at`
- `marketing_sms_opted_out_at`
- `marketing_email_opt_in_at`
- `marketing_email_opted_out_at`
- `marketing_whatsapp_opt_in_at`
- `marketing_whatsapp_opted_out_at`
- `sms_opt_in_source`
- `whatsapp_opt_in_source`

Definitions:

- `sms_opt_in` means operational SMS eligibility. It is not marketing consent.
- `marketing_sms_opt_in` means marketing SMS is allowed.
- `whatsapp_opt_in` means business-initiated WhatsApp is allowed.
- `marketing_whatsapp_opt_in` means marketing WhatsApp is allowed.
- A `*_marketing_*_opt_in` field must not be true unless backed by a real opt-in audit row.
- Legacy flags without evidence must not be laundered into new consent.

## 5. Required service layer

Add `ConsentService`.

Core methods:

- `recordConsent(input)`
- `applyBookingContactConsent(customerId, consentPayload, context)`
- `applyStaffCapturedConsent(customerId, consentPayload, actorUserId, context)`
- `recordOptOut(customerId, channel, source, context)`
- `recordObjection(customerId, channel, purpose, source, context)`
- `getConsentState(customerId)`

Do not make `ConsentService` a parallel notification engine. Notification send eligibility stays in the shipped notification/Twilio helpers unless that code is deliberately refactored with regression tests.

All customer creation helpers must accept an explicit consent context:

```ts
type CustomerConsentContext = {
  source: ConsentSource
  serviceContactNoticeShown?: boolean
  marketingEmailOptIn?: boolean
  marketingSmsOptIn?: boolean
  whatsappOptIn?: boolean
  marketingWhatsAppOptIn?: boolean
  consentTextVersion?: string
  consentText?: string
  captureMethod: ConsentCaptureMethod
  actorUserId?: string | null
  sourceUrl?: string | null
}
```

Required helper changes:

- Do not flip `ensureCustomerForPhone` globally in one commit.
- Add an explicit option first, then migrate each call site deliberately.
- `ensureCustomerForPhone` and parking `resolveCustomerByPhone` must stop implicit opt-in after their callers pass consent context.
- Existing customers must not be opted back in just because a new booking was made.
- If consent audit fails, the customer create/update must fail when it would otherwise change opt-in state.

## 6. API contract

Add this object to public and management guest/customer creation requests:

```ts
communication_consent?: {
  service_contact_notice_shown?: boolean
  marketing_email_opt_in?: boolean
  marketing_sms_opt_in?: boolean
  whatsapp_opt_in?: boolean
  marketing_whatsapp_opt_in?: boolean
  consent_text_version?: string
}
```

Non-breaking rollout:

1. Management app accepts this object as optional first.
2. If missing, management app applies safe defaults: no marketing opt-in, no WhatsApp opt-in, and no new consent audit except legacy/system metadata where needed.
3. Public site is updated to send the object.
4. Only after both repos are deployed and observed should the management app require it for versioned routes or new client versions.

Rules:

- Public routes may only pass the public fields above.
- Public routes must ignore or reject `capture_method`, `actor_user_id`, `source='staff'`, and direct customer summary fields such as `sms_opt_in`.
- API keys are not RBAC. Enforce field stripping in the public/proxy request validation layer.
- Staff routes may pass `capture_method='staff_verbal'` only with a signed-in actor.
- WhatsApp opt-in checkboxes must be unchecked by default.
- Marketing checkboxes must be unchecked by default.
- Server code owns the fallback consent text version if the client omits it during rollout.
- Idempotency hashes must include consent choices and text version, but not IP/user agent/captured timestamp metadata.

Suggested public service wording:

> We will use your phone and email to manage this booking, including confirmations, reminders, payment links, waitlist updates, and changes.

Suggested public optional checkboxes:

- `Email me about future events and offers.`
- `Text me about future events and offers.`
- `Send booking updates by WhatsApp.`
- `Send me WhatsApp event and offer updates.`

The exact copy must be versioned in code, for example `guest-comms-consent-v1`.

## 7. Capture points to implement

### 7.1 Management app

| Area | Files | Required change |
|---|---|---|
| Shared customer helper | `src/lib/sms/customers.ts` | Add explicit consent context. Stop implicit opt-in after call sites are migrated. |
| Parking customer helper | `src/lib/parking/customers.ts` | Add explicit consent context. Stop implicit opt-in after call sites are migrated. |
| Table bookings API | `src/app/api/table-bookings/route.ts` | Validate and apply optional `communication_consent`. Include consent choices in idempotency hash. |
| Event bookings API | `src/app/api/event-bookings/route.ts` | Same. |
| Event waitlist API | `src/app/api/event-waitlist/route.ts` | Same. |
| Private booking public API | `src/app/api/public/private-booking/route.ts` and `src/app/api/private-booking-enquiry/route.ts` | Same. |
| Private booking service | `src/services/private-bookings/mutations.ts` | Pass consent context into customer resolution. |
| Parking API | `src/app/api/parking/bookings/route.ts` | Same for website and staff sources. |
| Parking staff action | `src/app/actions/parking.ts` | Add staff consent controls. |
| FOH table booking | `src/app/api/foh/bookings/route.ts` | Treat FOH as `staff`. Add staff-verbal service capture when a real phone is supplied. Keep walk-ins deactivated. |
| FOH event booking | `src/app/api/foh/event-bookings/route.ts` | Same. |
| Manual event booking | `src/app/actions/events.ts` | Add staff-verbal consent fields. |
| Customer lookup | `src/app/api/customers/lookup/route.ts` | Do not opt in or create customers during lookup. If legacy creation remains temporarily, mark `legacy` and `sms_opt_in:false`. |
| Customer create/edit | `src/app/actions/customers.ts`, customer UI pages | Add explicit contact preference controls and consent audit. Remove hardcoded `sms_opt_in=on`. |
| Customer import | `src/components/features/customers/CustomerImport.tsx`, `src/app/actions/customers.ts` | Add consent columns or import attestation. Default no marketing and no WhatsApp. |
| Profile toggles | `src/app/actions/customerSmsActions.ts`, `customers/[id]/page.tsx` | Retrofit existing toggles to use `ConsentService` and new permissions. |
| Direct/manual SMS | `src/app/actions/sms.ts`, `src/lib/twilio.ts` | Do not create opted-in customers from a bare phone number. Require customer or explicit consent context. |
| Reply-to-book inbound | `src/lib/sms/reply-to-book.ts` | Inbound customer creation must not imply opt-in or marketing consent. |
| Twilio inbound STOP | `src/app/api/webhooks/twilio/route.ts` | Extend existing STOP branch to write consent audit rows. Do not change channel isolation. |
| Notifications | `src/lib/notifications/notify.ts`, `src/lib/notifications/channel.ts` | Keep shipped routing/eligibility behavior. Add marketing permission checks at marketing send call sites. |
| GDPR | `src/services/gdpr.ts`, `src/app/actions/gdpr.ts` | Export, erase/redact, and retain `customer_consents`. |

### 7.2 Public site

| Area | Files | Required change |
|---|---|---|
| Table booking modern form | `components/features/TableBooking/ManagementTableBookingForm.tsx` | Add service notice and optional consent checkboxes. Submit `communication_consent`. |
| Table booking legacy form | `components/features/TableBooking/TableBookingForm.tsx`, `CustomerDetails.tsx`, `lib/api/bookings.ts` | Remove `sms_opt_in: true`. Add consent fields. |
| Table booking proxy | `app/api/table-bookings/route.ts`, `app/api/table-bookings/create/route.ts` | Preserve validated consent object and forward it. |
| Event booking form | `components/features/EventBooking/ManagementEventBookingForm.tsx` | Add consent controls. Forward to booking and waitlist. |
| Event booking proxy | `app/api/event-bookings/route.ts` | Preserve and forward consent. |
| Event waitlist proxy | `app/api/event-waitlist/route.ts` | Preserve and forward consent. |
| Private hire enquiry | `components/PrivateBookingInquiryForm.tsx`, `lib/api/private-bookings.ts` | Add service notice and optional consent controls. |
| Private booking proxy | `app/api/public/private-booking/route.ts`, `app/api/private-booking-enquiry/route.ts` | Preserve and forward consent. |
| Parking wizard | `components/features/ParkingBookingWizard/index.tsx`, `lib/api/parking.ts` | Add service notice and optional consent controls. |
| Parking API routes | `app/api/parking/bookings/route.ts`, `app/api/parking/payment/create-order/route.ts`, `app/api/parking/payment/capture/route.ts` | Preserve and forward consent into management `/parking/bookings` and create-order. Capture must not mutate consent. Include consent choices in any idempotency key. |
| Customer lookup proxy | `app/api/customers/lookup/route.ts` | Keep lookup read-only from a consent perspective. Do not attach consent. |
| WhatsApp links | `components/WhatsAppLink.tsx` and direct `wa.me` links | Track click only. Do not mark opt-in from a click. |
| Privacy policy | `app/privacy-policy/page.tsx` | Add specific channel consent wording and current consent text version. |

## 8. Permission changes

Add these RBAC actions to `src/types/rbac.ts` `ActionType` before adding any code that checks them:

- `view_contact_preferences`
- `manage_contact_preferences`
- `manage_whatsapp_opt_in`
- `record_service_contact`
- `send_transactional`
- `send_marketing`
- `view_consent_audit`
- `export_consent_audit`

Seed these permissions in a Supabase migration before the app gates are deployed:

| Permission | Allows |
|---|---|
| `customers:view_contact_preferences` | View consent state and audit summary. |
| `customers:manage_contact_preferences` | Change service SMS/email eligibility and record staff verbal capture. |
| `customers:manage_whatsapp_opt_in` | Opt a customer into or out of WhatsApp. |
| `customers:record_service_contact` | Record service-contact notice during staff booking flows. |
| `messages:send_transactional` | Send service messages only. |
| `messages:send_marketing` | Send marketing messages. Must also pass channel marketing consent. |
| `messages:view_consent_audit` | View full consent audit trail. |
| `messages:export_consent_audit` | Export consent evidence. |

Role seed rules:

- `super_admin`: all new permissions.
- `manager`: contact preferences, WhatsApp opt-in, transactional sends, marketing sends, and audit view.
- `staff`: service-contact capture during booking flows and transactional sends only, unless a later decision grants more.
- Verbal marketing consent capture is manager/super_admin only by default.
- Public API keys can submit public consent fields with bookings only. They cannot manage or override consent.

Deployment invariant:

1. Add `ActionType` values.
2. Run the permission seed migration.
3. Verify `role_permissions` contains grants.
4. Only then replace existing gates.

Update current gates:

- Replace `customers:edit` for SMS/WhatsApp toggles.
- Replace `messages:send` for marketing sends.
- Keep `messages:view` for comms inbox/profile reads.
- Keep `messages:manage` for operational admin tasks, not as a blanket consent override.

## 9. Sending rules

### 9.1 Service messages

Service messages are allowed when:

- The message is strictly about the active booking, payment, waitlist, refund, cancellation, or operational change.
- The customer has not opted out, objected, or been deactivated on that channel.
- Existing notification eligibility helpers approve the channel.
- For SMS, `sms_opt_in` is operational eligibility. It may be set from a service-contact notice for a new booking only when the customer has not previously opted out or objected.
- For WhatsApp, `whatsapp_opt_in` is required unless the message is a valid customer-initiated WhatsApp response inside the provider service window.

STOP behaviour:

- SMS STOP clears `sms_opt_in` and `marketing_sms_opt_in`.
- WhatsApp STOP clears WhatsApp fields only.
- A later booking must not silently reactivate a STOPped channel.

### 9.2 Marketing messages

Allowed only when:

- User has `messages:send_marketing`.
- Channel-specific marketing consent is true.
- Channel is not deactivated, bounced, complained, opted out, or objected.
- Message includes a clear opt-out path.

Do not use `sms_opt_in` as marketing consent.

### 9.3 WhatsApp

Allowed only when:

- `whatsapp_opt_in=true` for business-initiated messages.
- `marketing_whatsapp_opt_in=true` for WhatsApp marketing.
- Template/routing rules allow the message.
- WhatsApp failures update WhatsApp fields only.

## 10. Edge cases to handle

1. Existing opted-out customer makes a new booking. Do not opt them back in unless they explicitly ask to re-enable that channel.
2. Public user checks marketing email but not marketing SMS. Only email marketing is allowed.
3. Public user checks WhatsApp service but not WhatsApp marketing. Booking WhatsApp can be used; WhatsApp marketing cannot.
4. Staff enters a phone during FOH booking and does not confirm service SMS notice. Customer must not become SMS-active.
5. Staff says they got verbal consent. Store `capture_method='staff_verbal'`, actor user, text version, and source route.
6. Bulk import has no consent columns. Import customers with no marketing consent and no WhatsApp opt-in.
7. Bulk import includes consent columns. Require import attestation and `customers:manage_contact_preferences`.
8. Public proxy receives forged `actor_user_id`, `capture_method`, or direct `sms_opt_in`. Ignore or reject it.
9. Same idempotency key is retried with different consent choices. Treat as idempotency conflict.
10. Customer lookup finds legacy private booking data. Do not create an opted-in customer from lookup alone.
11. WhatsApp link is clicked. Track only; do not opt in.
12. WhatsApp inbound non-STOP from unknown number. Do not create marketing consent.
13. STOP from WhatsApp. Opt out WhatsApp only.
14. STOP from SMS. Opt out SMS and SMS marketing.
15. Email bounces or complaints. Clear marketing email eligibility as required.
16. GDPR export must include consent rows and consent text snapshots.
17. GDPR erasure must redact PII in consent evidence but retain minimal suppression state.
18. Public site deploy lags behind management app. Management must keep accepting missing `communication_consent`.
19. New permission gates ship before role seed. This must be blocked by deployment order and tests.
20. Two consent writes happen at the same time. Transaction locks and sequence ordering must produce deterministic final state.
21. Public email marketing may need double opt-in if chosen later. Do not assume it is enabled.

## 11. Backfill and GDPR

Do not treat old data as real consent.

Backfill plan:

1. Insert `customer_consents` rows with `status='legacy'` for existing opt-in summary fields.
2. Keep existing SMS service eligibility where appropriate on legitimate interests, but label source as `legacy_system_state`.
3. Do not treat legacy marketing flags as future marketing consent unless legal/product approve that source.
4. Block marketing where there is no real opt-in evidence, then run a re-permission campaign if needed.
5. Generate a report of customers with:
   - `sms_opt_in=true` and no audit row
   - `marketing_sms_opt_in=true` and no real opt-in audit row
   - `whatsapp_opt_in=true` and no real opt-in audit row
   - `marketing_email_opt_in=true` and no real opt-in audit row
6. Require approval before any cleanup that changes live opt-in fields.

GDPR plan:

- Export `customer_consents` rows and consent text snapshots.
- Erasure redacts `consent_text`, `ip_hash`, `user_agent`, source URL where identifying, and free-text metadata.
- Retain non-PII suppression state for opt-out/objected channels.
- Retention jobs must include old consent rows according to the privacy policy.

## 12. Implementation order

1. Add `ActionType` values and seed RBAC permissions/role grants.
2. Add `customer_consents`, timestamps, indexes, RLS/service-role grants, generated types, and transactional RPC/service write path.
3. Build `ConsentService` and unit tests.
4. Extend existing Twilio STOP and profile toggle code to write consent audit rows without changing channel logic.
5. Make management APIs accept optional `communication_consent` with safe defaults.
6. Update public site forms and proxy routes to collect and forward consent.
7. Migrate customer creation helpers by domain, one call-site group at a time.
8. Add staff UI controls and granular permission gates after seeded grants are verified.
9. Add marketing send permission checks at marketing call sites while preserving existing notification eligibility.
10. Backfill legacy audit rows and produce approval report.
11. Extend GDPR export, erasure, retention, and privacy policy wording.
12. After both repos are deployed and telemetry is clean, consider making `communication_consent` required for new client versions.

## 13. Acceptance criteria

- New customer creation from booking routes never sets any opt-in field true without a matching audit row in the same transaction.
- Management app accepts old public payloads during rollout without breaking bookings.
- Public table, event, waitlist, private hire, and parking flows pass `communication_consent` end to end.
- Staff FOH/manual/admin flows can record staff-verbal capture with actor user ID.
- Customer import defaults to no marketing and no WhatsApp unless consent evidence is supplied.
- WhatsApp opt-in cannot be changed by a user without `customers:manage_whatsapp_opt_in`.
- Marketing sends require `messages:send_marketing` and channel marketing consent.
- Public `wa.me` clicks never change opt-in state.
- STOP writes audit rows and only affects the matching channel.
- GDPR export includes consent audit rows.
- GDPR erasure redacts PII but preserves suppression state.
- Existing notification routing and WhatsApp/SMS eligibility tests still pass.

## 14. Test plan

Unit:

- `ConsentService.recordConsent`
- latest-state derivation using `captured_at` plus sequence tiebreaker
- transactional audit plus summary update
- helper call sites do not create implicit opt-in
- idempotency hash includes consent choices and version
- channel-specific marketing gating
- WhatsApp service vs marketing gating
- permission constants compile through `ActionType`

Integration:

- Permission seed migration grants expected roles before gates are used
- Management table booking with and without consent
- Management event booking and waitlist
- Private booking enquiry
- Parking booking and PayPal create-order
- FOH table/event booking with staff service-contact capture
- Customer lookup does not opt in
- Customer import with and without consent columns
- SMS STOP and WhatsApp STOP write audit rows and preserve channel isolation
- GDPR export includes consent rows
- GDPR erasure redacts PII but keeps suppression state
- Marketing sends remain blocked without marketing consent after notification changes

Public site:

- Table booking form sends consent
- Event booking and waitlist send consent
- Private hire sends consent
- Parking wizard sends consent
- Proxies reject or strip staff-only consent fields
- Public requests still succeed while management treats `communication_consent` as optional

Validation:

- Management app: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`
- Public site: `npm run build`, `npm run lint`, `npm run test`

## 15. Decisions

Defaults for this implementation:

- Explicit marketing opt-in only.
- `soft_opt_in` reserved but disabled.
- Service-contact notice for booking SMS/email.
- SMS STOP remains a carrier-suppression style opt-out and is not silently reversed by a later booking.
- Explicit unchecked WhatsApp opt-in.
- Read-only customer lookup.
- Separate channel choices.
- Verbal marketing consent is manager/super_admin only.

Open decisions before build:

1. Should public email marketing use single or double opt-in?
2. What exact consent copy should be approved for `guest-comms-consent-v1`?
3. Should managers get `messages:export_consent_audit`, or super_admin only?
