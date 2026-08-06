# Developer review: seasonal pre-order journey specification

Date: 2026-08-04  
Reviewed document: `tasks/seasonal-preorder-journey-spec-2026-08-03.md`  
Review snapshot: AMS `63525547961f7268f0369bd6fe44cd874a076633`; website `14aa6be705dad14d876c8e843fb07621f3f291b6`  
Audience: developer and delivery owner  
Review outcome: **not ready to build as a complete feature**

The original specification was not changed.

## 1. Executive summary

The document is thoughtful and unusually strong on owner decisions, deposit snapshots, basic chase rules,
and some lifecycle cases. It is not yet an implementable end-to-end specification.

The main blockers are:

1. It collects orders but does not say how kitchen or front-of-house staff view, correct, print, export,
   aggregate or fulfil them.
2. The proposed schema does not enforce the central invariants and cannot safely represent several stated
   journeys.
3. Booking creation, contact creation, payment and notifications cross systems, but failure and recovery
   states are not defined.
4. The automatic refund flow cannot be atomic as described. Its calculation also does not fully account
   for earlier partial refunds or provider state.
5. Allergy information is health data, not merely “health-adjacent”. The lawful basis in the document is
   incomplete and needs a documented Article 9 condition and specialist review.
6. Decisions O1 to O4 affect the architecture or guest promise and must be resolved before build. O2 and
   O3 also block amendment design.
7. There is no plan to find and onboard existing qualifying bookings when the feature is enabled.
8. Removing the old booking flow now conflicts with the linked evidence-based retirement gate. Removing
   old code is also incorrectly treated as removing the need for deployment rollback.

Recommended delivery shape: first define the staff workflow and a smaller cover-based data model, then
lock the privacy and payment decisions, then write API contracts and state machines, and only then estimate
and build. A phased first release in which the booker orders for everyone would remove much of the token,
third-party phone and chase complexity if the owner accepts it.

## 2. Classification used

- **Status — Confirmed issue:** the specification or checked code has a real gap, conflict or unsafe claim.
- **Status — Optional improvement:** useful but not required for a safe first release.
- **P0:** release blocker or material money, privacy or operational risk.
- **P1:** must be resolved before implementation is complete.
- **P2:** should be resolved before release.
- **P3:** useful follow-up.

## 3. Findings

### F01 — No kitchen or front-of-house fulfilment journey

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / Operations
- **Relevant section:** Part B; §3 Testing
- **Description:** The feature ends when choices are stored. It does not define how staff find outstanding
  orders, view choices, see changes, aggregate dish counts, handle allergies, print or export a kitchen list,
  or mark an order as checked.
- **Rationale:** The business outcome is usable food orders, not rows in a database. Current booking sheets
  do not include the proposed data.
- **Impact:** The feature can be technically complete while the pub still cannot prepare or serve the orders.
- **Recommended action:** Add staff journeys and acceptance criteria for booking detail, service/date view,
  totals by item, per-cover list, allergy highlighting, print/export, late-change highlighting and audit history.
- **Open questions:** Which team owns the final check? What output does the kitchen use on service day? When
  is an order treated as locked?

### F02 — APIs and ownership boundaries are not specified

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Integration / Architecture
- **Relevant section:** §§B.4–B.8; §4 Rollout
- **Description:** There are no request and response contracts for creating contacts, issuing links, saving
  selections, returning status, reassigning covers, changing party size, withdrawing an item or staff edits.
  It is also unclear which repo owns each operation.
- **Rationale:** AMS, the public website, public token pages, jobs and PayPal all participate. Informal object
  sharing will create partial writes and contract drift.
- **Impact:** Teams cannot estimate or implement independently, and cross-repo releases can break at runtime.
- **Recommended action:** Define versioned endpoints, schemas, authentication, authorisation, idempotency,
  validation, error codes and owning service for every command and query. Add contract tests in both repos.
- **Open questions:** Does the website call one atomic create endpoint or several? Is the preorder guest page
  served by AMS only? Which API is authoritative for completion?

### F03 — Booking creation and pre-order setup have no safe failure model

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / Integration
- **Relevant section:** §B.5
- **Description:** The text says the form cannot submit until cover allocation is valid, but also says the
  booking and deposit are taken regardless of whether choices are in. It does not say what happens if the
  booking succeeds but contact creation, token creation, payment setup or message queueing fails.
- **Rationale:** These writes cross database, website and provider boundaries and cannot share one database
  transaction.
- **Impact:** A paid booking can exist without contacts or links, or a guest can see a failed booking after a
  booking was actually created.
- **Recommended action:** Define an explicit creation state machine. Create the booking and minimum booker
  contact in one server-side database transaction, then use durable outbox jobs for tokens and messages.
  Return a successful booking with a visible recovery state when non-critical work fails.
- **Open questions:** Is contact allocation required before Confirm, or can it be completed after booking?
  Which failures may block the booking?

### F04 — The proposed schema does not enforce its central invariants

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data integrity
- **Relevant section:** §§B.1–B.3
- **Description:** The partial unique index allows **at most** one booker, not exactly one. Nothing enforces
  that contact covers sum to party size. A contact's `booking_period_id` can disagree with its booking. A
  selection can reference a menu item from another period, and `course` can disagree with the item's course.
- **Rationale:** Application-only checks fail under staff edits, concurrent requests, scripts and future code.
- **Impact:** Chases, completeness, kitchen lists and refunds can use corrupt or cross-period data.
- **Recommended action:** Remove avoidable duplicated keys, or use composite foreign keys. Put booking/contact/
  cover mutations behind locked database functions. Add deferred or transaction-level invariant checks and
  database tests. Correct the “exactly one” index comment.
- **Open questions:** Is direct service-role table access permitted, or must all writes go through RPCs?

### F05 — A numeric `cover_index` is not a stable cover model

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data model / Functional
- **Relevant section:** §§B.2, B.6, B.8
- **Description:** Names and allergy notes are described per cover, but the schema stores them on each course
  selection. There is no stable cover ID. Reassignment, shrinking, partial completion and ordering across
  contacts therefore require renumbering or duplicated data.
- **Rationale:** A cover is a first-class concept in §B.1 and should be represented as one.
- **Impact:** A name or note can differ between courses, and shrinking can drop part of a person's meal.
- **Recommended action:** Add `booking_preorder_covers(id, contact_id, ordinal, guest_name, notes, created_at,
  updated_at, dropped_at)` and make selections reference `cover_id`. Keep a stable ordering key.
- **Open questions:** Can a cover move between contacts after choices exist? Should notes be per cover, per
  dish, or both?

### F06 — Completeness rules and course configuration are unresolved

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / Data
- **Relevant section:** §B.3; O4
- **Description:** The default may require starter, main and dessert from everyone, while O4 asks whether only
  mains are required. There is no defined Settings UI, validation, empty-array meaning, change control or
  snapshot of required courses for live bookings.
- **Rationale:** Completeness drives chase messages and manager escalation. A later menu edit can change a
  previously complete order without a deliberate operational decision.
- **Impact:** Guests may be chased for optional courses or marked complete without what the kitchen needs.
- **Recommended action:** Resolve O4 before schema work. Store an explicit required-course configuration per
  period/version, validate it against supported courses, expose it in Settings, and define whether existing
  bookings keep the old version.
- **Open questions:** Are choices “exactly one”, “at least one”, or optional per course? Can a guest choose no
  starter or dessert explicitly?

### F07 — Menu versioning and withdrawn-item handling are incomplete

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Data
- **Relevant section:** §§B.2, B.3; E7
- **Description:** Name and price are snapshotted, but course, description and allergen display are not. E7
  says a withdrawn item makes covers incomplete, without defining the transaction, affected bookings,
  notification timing, new chase budget or staff override. A hard delete may also be blocked by the new FK.
- **Rationale:** Menu changes after orders exist are normal operational events and affect what the guest saw.
- **Impact:** History can become misleading and a broad menu change can generate an uncontrolled message burst.
- **Recommended action:** Version menu items or snapshot all decision-relevant display fields. Prefer
  deactivate over delete. Add a preview showing affected covers, require confirmation, create replacement
  tasks, and set a clear notification rule.
- **Open questions:** Can an item be renamed without invalidating a choice? Who approves mass re-chasing?

### F08 — Food price meaning and guest payment expectation are unclear

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Payments
- **Relevant section:** §§B.2, B.6
- **Description:** `price_gbp` is stored and described as what the guest was “quoted”, but the journey does not
  say whether item prices are shown, totalled, included in a set menu, paid now, or paid at the pub.
- **Rationale:** A snapshot is only useful if its commercial meaning is defined.
- **Impact:** Confirmation pages, emails, refunds and staff bills can show inconsistent amounts.
- **Recommended action:** State the charging model and acceptance criteria. If pre-order prices are
  informational only, name the field and copy accordingly and keep it separate from the deposit.
- **Open questions:** Are supplements supported? Can a menu item have no price? Does changing a dish price
  affect existing orders?

### F09 — Booker and guest visibility rules are incomplete

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Privacy / Functional
- **Relevant section:** D11; §§B.5–B.8
- **Description:** D11 limits a guest to their own choices, but the booker's rights are not defined. The booker
  receives status summaries, can reassign covers and is told dropped choices, which may expose other guests'
  names, phone numbers, choices or allergy notes.
- **Rationale:** The booker is both a guest contact and an organiser; those roles need an explicit permission
  boundary.
- **Impact:** Personal or health information may be disclosed to the wrong person.
- **Recommended action:** Define a field-level access matrix for guest contact, booker, manager, FOH and BOH.
  Default booker summaries to completion status only; never show another contact's allergy notes without a
  documented need.
- **Open questions:** May the booker edit another contact's submitted choices? May they see guest names or phone
  numbers after submission?

### F10 — O1 understates the impact of changing shared guest tokens

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Architecture / Migration
- **Relevant section:** §B.4; O1
- **Description:** Making `guest_tokens.customer_id` nullable affects generated types, the existing
  `(customer_id, action_type, expires_at)` index and shared token code that currently assumes a customer. The
  proposal also lacks a rule tying a preorder token to exactly one contact and correct booking.
- **Rationale:** `guest_tokens` is shared by table, event, private booking, payment, feedback, waitlist and
  approval flows. This is not a one-column local change.
- **Impact:** Existing guest routes can regress or orphaned/multi-purpose tokens can be created.
- **Recommended action:** Complete an impact audit before selecting O1. If reusing the table, add
  `preorder_contact_id`, a target/action consistency check, suitable indexes, generated type changes and
  regression tests for every existing action. A separate table may be safer despite some duplication.
- **Open questions:** Must every token have exactly one subject? Can an existing token library be shared while
  storage stays separate?

### F11 — Public token-page security controls are missing

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Security
- **Relevant section:** §B.4; E10, E13, E14
- **Description:** Token entropy and hashing are mentioned, but there are no requirements for token rotation,
  revocation, resend behaviour, rate limiting, audit, `Cache-Control: no-store`, `noindex`, referrer policy,
  analytics exclusion, log redaction, CSRF or input sanitisation.
- **Rationale:** A long-lived URL is a bearer credential. URLs commonly leak through logs, analytics, browser
  history and referrers.
- **Impact:** Anyone with a leaked link can read or change an order until expiry.
- **Recommended action:** Define the complete bearer-token threat model and response headers. Bind action,
  contact and booking in the lookup; revoke old tokens on resend/contact change/cancellation; rate-limit
  reads and writes; keep tokens out of analytics and logs; escape all free text.
- **Open questions:** Is one stable token reused for every chase? Can staff revoke and reissue it?

### F12 — Permission confirmation is required but absent from the schema

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Privacy / Data
- **Relevant section:** D10; §§B.5, B.10
- **Description:** The document says the permission tick and timestamp must be stored, but neither proposed
  table contains the confirmation text/version, timestamp, actor, source or covered phone numbers.
- **Rationale:** A boolean without wording and version is weak evidence, and later contact edits may not be
  covered by the original tick.
- **Impact:** The pub cannot show what was confirmed or whether a newly added number was covered.
- **Recommended action:** Add a versioned permission-evidence record linked to the booking/contact batch. Record
  timestamp, wording version, source and booker identity. Require fresh confirmation when adding or changing
  third-party numbers.
- **Open questions:** What happens if the booker refuses? Can staff record verbal confirmation, and how?

### F13 — Allergy data is legally misclassified

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Privacy / Compliance
- **Relevant section:** §B.6; §B.10
- **Description:** Allergy information can reveal health information and should be treated as special-category
  personal data. Legitimate interests under Article 6 alone is not enough; an Article 9 condition is also
  required. The booker's permission to text does not solve this.
- **Rationale:** ICO guidance says health data requires both an Article 6 lawful basis and an Article 9
  condition. See [ICO special-category guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-are-the-rules-on-special-category-data/).
- **Impact:** The current design may process sensitive data without the required documented basis and controls.
- **Recommended action:** Get a documented privacy/legal decision before build. Minimise the field, explain who
  sees it and why, set access and retention controls, update the privacy notice, and consider a DPIA. Do not
  claim that recording a “requirement, never a reason” changes its data class.
- **Open questions:** Which Article 9 condition applies? Can the service collect a safer dietary-requirements
  field and direct guests to phone the pub for serious allergies?

### F14 — Retention and anonymisation are incomplete

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Privacy / Data lifecycle
- **Relevant section:** §B.10; E1
- **Description:** Clearing phone and guest name does not anonymise rows that remain linked to a booking and may
  contain allergy notes. Tokens, message bodies, provider logs, audit logs, manager emails, backups and chase
  records are not covered. “Selections may be kept” is therefore unproven.
- **Rationale:** Pseudonymous linked data remains personal data. The existing GDPR service will need explicit
  export, erasure and retention changes for the new tables.
- **Impact:** Data may be retained longer than stated and erasure/export responses may be incomplete.
- **Recommended action:** Make a field-by-field retention schedule across database, email, SMS provider, logs
  and backups. Clear or delete notes as sensitive data. Add the new entities to export, erasure and scheduled
  cleanup, with tests and legal hold rules.
- **Open questions:** Why 90 days? Is there a food-safety retention need? What is the mailbox and provider
  retention period?

### F15 — Subject access and erasure are stated but not designed

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Privacy / Operations
- **Relevant section:** §B.10
- **Description:** “Findable by phone number and erasable” has no verification process, admin journey, query,
  audit or rule for a shared number covering several people. After phone deletion, the same person may not be
  findable even while other linked personal data remains.
- **Rationale:** A phone number identifies a contact, not necessarily every cover/person represented by it.
- **Impact:** Staff may erase the wrong data or return an incomplete subject-access result.
- **Recommended action:** Define identity verification, search scope, shared-number handling, export format,
  selective redaction, audit and response ownership. Test it through the existing GDPR service.
- **Open questions:** Who is the data subject when a parent orders for four covers? How is a named cover found
  without their own phone?

### F16 — Phone validation, consent scope and inbound messaging are underspecified

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Integration / Privacy
- **Relevant section:** D10, D12, D14; E2–E5
- **Description:** E.164 normalisation, default country, landlines, international numbers and correction flows
  are not defined. STOP handling assumes inbound provider webhooks and does not define whether opt-out applies
  to one booking, all service messages or marketing too.
- **Rationale:** The unique index only works after consistent normalisation, and messaging preferences already
  exist elsewhere in the system.
- **Impact:** Duplicate contacts can bypass checks, valid guests can be rejected, or a STOP request can be
  applied too narrowly or too broadly.
- **Recommended action:** Reuse the existing phone-normalisation library, define supported countries and clear
  errors, and design inbound keyword/provider-event integration with the central messaging-consent model.
- **Open questions:** Does the SMS provider and number support inbound replies? Can a guest opt back in for this
  booking only?

### F17 — “Four messages” conflicts with dual-channel booker contact

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Communications
- **Relevant section:** D9, D14; §B.7
- **Description:** The booker can receive SMS and email at the same chase point. It is unclear whether the cap is
  four chase occasions, four transmissions across channels, or four per channel. `chase_count` cannot express
  per-channel outcomes.
- **Rationale:** D9 says four messages per person, while the ladder can send up to eight transmissions to the
  booker.
- **Impact:** Implementation can breach the stated cap or omit a required channel.
- **Recommended action:** Define the cap in terms of chase points and channel attempts. Store one delivery row
  per contact, point and channel rather than one counter.
- **Open questions:** Do retries count? Does the T0 invitation count? Does a status-only email to the booker
  count?

### F18 — Chase timing has a direct contradiction

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Time
- **Relevant section:** §B.7
- **Description:** The rules say points already in the past are skipped, then say a booking made two days out
  gets “T0 and the cutoff only”. If cutoff is three or seven days before, that cutoff is already past. Time of
  day, Europe/London handling, DST, reschedules and `preorder_cutoff_days = 0` are also unspecified.
- **Rationale:** Cron behaviour cannot be implemented deterministically from calendar-day labels alone.
- **Impact:** Duplicate, early, late or missing messages and manager alerts.
- **Recommended action:** Define exact UTC timestamps derived from the booking's London local start. State what
  happens for bookings made inside the cutoff: normally send T0 and immediate manager escalation, not a
  fictional past chase. Add a full truth table.
- **Open questions:** At what local hour do 7-day and 4-day messages send? Is cutoff based on start time or a
  fixed local hour?

### F19 — Recommended chase idempotency can permanently lose messages

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Reliability / Messaging
- **Relevant section:** §B.7
- **Description:** Writing a final unique ledger row before sending prevents duplicates but loses the message if
  the worker crashes after the insert and before the provider accepts it.
- **Rationale:** Exactly-once delivery is not available across the database and SMS/email provider.
- **Impact:** A guest or manager may never receive a required chase, with no automatic recovery.
- **Recommended action:** Use a durable outbox state machine (`pending`, `sending`, `accepted`, `delivered`,
  `failed`, `dead_letter`) with leases, provider idempotency keys where available, attempt counts and a
  reconciliation job. Keep the unique business key.
- **Open questions:** Which provider IDs and delivery webhooks are available? What is the retry and dead-letter
  policy?

### F20 — Failure, retry and “unreachable” rules are missing

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Error handling / Operations
- **Relevant section:** E2, E3; §B.7
- **Description:** “After retries” is not defined. There is no distinction between transient failure, rejected
  number, delivered-but-unread, bounced email or provider outage. Escalation timing and manual recovery are
  absent.
- **Rationale:** Provider acceptance is not proof of delivery, and retry policy affects cost and the message cap.
- **Impact:** Contacts may be escalated too early, never escalated, or messaged excessively.
- **Recommended action:** Define provider-status mapping, retry schedule, maximum attempts, dead-letter view,
  manager action and re-send controls. Test provider outage and delayed webhook cases.
- **Open questions:** What exact provider status makes a contact `unreachable`? Can staff correct the number and
  restart the ladder?

### F21 — Party growth does not define state or chase reset rules

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Lifecycle
- **Relevant section:** §B.8
- **Description:** Adding covers to a complete booker contact should make it incomplete, but status,
  `completed_at`, link reuse, chase budget and next chase point are not defined. Reassignment to a new contact
  can race with submission.
- **Rationale:** D9 stops chasing “the moment they complete”, but a later amendment can make them incomplete
  again.
- **Impact:** New covers may never be chased or may trigger more messages than allowed.
- **Recommended action:** Define a new revision/version for the order after amendment. Recompute completion in
  the same locked transaction, issue/reuse links deliberately, and define an amendment notification separate
  from the original chase cap.
- **Open questions:** Does growth after cutoff cause immediate manager escalation? Can new covers be added after
  service starts?

### F22 — Party shrink ordering cannot be implemented as written

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / Data
- **Relevant section:** D13; §B.8
- **Description:** “Keep selections in `submitted_at` order and drop the latest” orders course rows, not people.
  A cover can have three different timestamps, edits alter the meaning, and contacts may have partial covers.
  The rule also does not say which contact loses a cover.
- **Rationale:** The stated business rule is cover-level, while the model is selection-level.
- **Impact:** The system can drop only part of a meal or the wrong person's order.
- **Recommended action:** Use stable cover rows and record `first_completed_at` per cover. Define a deterministic
  cross-contact order, preview the exact proposed removals, require confirmation for staff edits, and keep an
  audit tombstone rather than silently deleting.
- **Open questions:** Should unsubmitted covers be dropped first? May the booker choose who is removed before
  the amendment commits?

### F23 — Booking moves cover only two of several period transitions

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / Payments
- **Relevant section:** E8, E9; O2
- **Description:** The document covers same-period and outside-period moves, but not moves into a period, between
  two different periods, accepted-to-declined changes, date changes that alter cutoff state, or staff changing
  the seasonal answer. Deposit and menu terms can both change.
- **Rationale:** Date amendments are an existing booking journey and can cross any configured period boundary.
- **Impact:** Orders, tokens, chases and money can remain tied to the wrong event.
- **Recommended action:** Create a transition matrix for no period, same period and different period, including
  paid/unpaid and before/after cutoff states. Resolve O2 and state whether cancel/rebook is an enforced rule or
  staff guidance.
- **Open questions:** Can the website guest move a seasonal booking, or staff only? What happens to an existing
  refund/payment when a move fails?

### F24 — “Last write wins” risks silent lost updates

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Concurrency / UX
- **Relevant section:** E10
- **Description:** Re-reading after submit does not prevent two devices overwriting each other. One user may see
  success even though their choice is immediately replaced.
- **Rationale:** Shared family links make simultaneous edits likely, not theoretical.
- **Impact:** The kitchen can receive choices nobody believes are final.
- **Recommended action:** Add an order revision or row version and use optimistic concurrency. On conflict,
  show which choices changed and ask the user to review. Audit old and new values.
- **Open questions:** Is one device meant to lock the order while editing? Should every successful change notify
  the booker?

### F25 — Cancellation retention conflicts with cascade deletion

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Data lifecycle
- **Relevant section:** §B.2; E1
- **Description:** E1 says cancelled rows are kept for audit, while both tables cascade from a deleted booking.
  The document assumes cancellation always means a status update and does not define hard-delete/GDPR cases.
- **Rationale:** The existing system can delete or anonymise data through other workflows and scripts.
- **Impact:** Audit data may be lost unexpectedly or retained against an erasure requirement.
- **Recommended action:** Distinguish cancellation, administrative deletion and erasure. Define each child's
  behaviour and audit retention. Test token expiry and outbox cancellation in the same lifecycle operation.
- **Open questions:** Are table bookings ever hard-deleted in production? Which audit fields must survive
  erasure?

### F26 — Refund arithmetic is ambiguous after earlier refunds

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Payments / Data
- **Relevant section:** Part C
- **Description:** “Refund `captured - owed`” does not say whether captured means original gross capture or net
  refundable balance. It does not account for prior partial refunds, pending refunds, manual refunds,
  chargebacks or concurrent amendments. `deposit_amount` is both a snapshot and a mutable operational amount
  elsewhere in the system.
- **Rationale:** Repeating a shrink after a prior refund can over-refund unless all refund ledger state is used.
- **Impact:** Direct financial loss and incorrect booking balances.
- **Recommended action:** Define `target_total_deposit`, `gross_captured`, `completed_refunds`,
  `reserved_pending_refunds` and `remaining_refundable` precisely. Calculate under the existing refund balance
  lock and store a durable amendment ID and target amount.
- **Open questions:** Does a manual cash refund reduce the automatic PayPal refund target? Which field remains
  the immutable original snapshot?

### F27 — Payment and booking changes cannot be atomic as described

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Payments / Reliability
- **Relevant section:** Part C rule 6; §B.8
- **Description:** The spec says a refund failure leaves the booking untouched and party-size/preorder changes
  happen in the same transaction. A PayPal API call cannot participate in the database transaction. The
  reverse failure—PayPal succeeds but the database update fails—is not addressed.
- **Rationale:** The existing refund code already treats provider success plus local failure as a reconciliation
  case.
- **Impact:** Money and booking state can disagree, and retrying can apply the amendment or refund twice.
- **Recommended action:** Use a persisted amendment saga: reserve the amendment and refund balance, call PayPal
  with a stable key, reconcile the result, then commit or compensate the booking transition. Show `pending`,
  `completed`, `manual_review` and `failed` states to staff.
- **Open questions:** Is the party-size change allowed to remain pending? If the refund cannot be made, does the
  owner want the smaller party recorded with a debt/task instead?

### F28 — Existing refund plumbing is not directly usable by automation

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Technical dependency / Payments
- **Relevant section:** Part C
- **Description:** The checked `processPayPalRefund` action requires an authenticated staff user and permission.
  Automatic amendments need a trusted system-actor path, a reason code and audit identity. Current code also
  enforces a 180-day capture-age limit.
- **Rationale:** Seasonal bookings can be made well before service, and the general booking horizon is longer
  than 180 days. PayPal's current refund API supports partial refunds and idempotency keys, but the account/API
  contract and age limit must be confirmed. See [PayPal refund API guidance](https://developer.paypal.com/docs/multiparty/issue-refund/).
- **Impact:** “Automatic” refunds may fail for early bookings or be impossible to call without bypassing the
  existing permission model.
- **Recommended action:** Add a system-owned refund service that still uses the existing balance reservation,
  ledger and reconciliation. Confirm the merchant account's refund window and define a manual fallback before
  promising automatic refunds.
- **Open questions:** What percentage of seasonal deposits may be older than the provider limit at amendment?
  Who handles a manual bank/cash refund?

### F29 — Party growth payment is an unresolved release blocker

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Product decision / Payments
- **Relevant section:** Part C rule 4; O3
- **Description:** The owner requires automatic refunds for shrinkage, but the opposite transition is left open.
  It affects whether an amendment is confirmed, pending payment or rejected and how pre-order covers change.
- **Rationale:** A complete party-size state machine needs both directions and repeated grow/shrink cycles.
- **Impact:** Developers cannot implement one safe amendment workflow, and the pub may under-collect deposits.
- **Recommended action:** Resolve O3 before build. The recommended payment-link approach needs expiry, reminder,
  rollback, capacity-hold and failure rules.
- **Open questions:** Is the larger table held while payment is pending? Does non-payment restore the old party
  size? Can staff waive the difference?

### F30 — Refund outcomes and customer communication are incomplete

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Error handling
- **Relevant section:** Part C; Part D
- **Description:** The journey does not define customer confirmation, pending provider status, partial success,
  expired refund window, manual fallback, notification failure or what staff and guest see after retry.
- **Rationale:** PayPal can return pending and local post-processing can fail after money moves.
- **Impact:** Guests may not know whether money was returned and staff can repeat an already-successful refund.
- **Recommended action:** Add a refund state model, visible history, reconciliation, customer email/SMS copy and
  manual-review queue. Make alerts contain a safe action, not only an error.
- **Open questions:** Is a 15-minute digest fast enough for a money mismatch? Who confirms completion to the
  customer?

### F31 — Alert requirements are split and conflict with linked delivery decisions

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Requirements / Delivery
- **Relevant section:** Part D; Part E
- **Description:** Part D depends on a mutable file in another repo instead of carrying acceptance criteria or a
  pinned version. That file says the old flow should only be retired after 400 sessions per arm and two full
  weekends, while D5 says delete it now. It also says the required exposure event is not built.
- **Rationale:** Two current documents give different go/no-go rules.
- **Impact:** Delivery can claim compliance with one document while violating the other.
- **Recommended action:** State explicitly that D5 supersedes the earlier experiment gate, or keep the gate.
  Pin linked requirements to commit and copy the final watch definitions into implementation tickets/tests.
- **Open questions:** Did the owner knowingly waive the sample and guardrail decision, or only the UI rollback?

### F32 — Alert reliability and sensitive email handling are missing

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Monitoring / Security
- **Relevant section:** D3; §§B.7, B.8, B.10; Part D
- **Description:** No schema is given for deduplication, batch windows, severity, repeat alerts, resolution,
  digest size, mail delivery failure, mailbox access or retention. Manager emails can contain guest phone
  numbers and allergy-related context.
- **Rationale:** An alert system needs to detect its own failure and minimise personal data.
- **Impact:** Important failures may be silently lost, repeatedly mailed or exposed in a shared mailbox.
- **Recommended action:** Use structured alert events with stable keys and status. Monitor the alert sender,
  cap and split digests, link authorised staff to AMS instead of emailing full PII, and define mailbox access
  and retention.
- **Open questions:** Which alerts are immediate rather than batched? Who owns and acknowledges the mailbox?

### F33 — Publishing a menu is an unsafe feature switch

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Deployment / Operations
- **Relevant section:** §4 Rollout
- **Description:** Menu publication is treated as the only activation switch. It does not verify that both repos,
  migrations, cron, provider webhooks, sender identities, privacy copy and staff screens are ready.
- **Rationale:** A normal content action should not silently activate an incomplete distributed system.
- **Impact:** The guest journey can go live with missing chases, staff views or refund support.
- **Recommended action:** Add a dedicated server-side feature flag/readiness gate and a preflight checklist.
  Keep independent kill switches for collection, outbound chases and automatic refunds. Fail closed with a
  staff-visible reason.
- **Open questions:** Who has activation permission? Can collection stay live while messages or refunds are
  disabled?

### F34 — Migration, access policy and query design are incomplete

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Migration / Security / Performance
- **Relevant section:** §§B.2, B.4; §4 Rollout
- **Description:** “Additive only” hides constraint replacement, nullability and generated-type changes. RLS,
  grants, service-role access, updated-at triggers, contact lookup indexes, chase-due indexes, uniqueness for
  ledgers and validation deployment order are not specified.
- **Rationale:** Existing booking-period tables are service-role-only under RLS. New public guest operations
  need an equally explicit access model.
- **Impact:** A migration can lock or break shared paths, or new tables can be overexposed/slow.
- **Recommended action:** Provide forward and rollback-compatible migrations, explicit RLS/grants, indexes
  from real queries, generated type regeneration and migration tests on a production-sized copy. Deploy code
  that tolerates old and new schema during the release window.
- **Open questions:** Will public routes always use a server-side admin client? What are expected booking/contact
  volumes?

### F35 — Existing eligible bookings have no backfill or onboarding plan

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Migration / Functional
- **Relevant section:** §4 Rollout
- **Description:** The rollout only creates contacts for new journey use. Bookings for seasonal dates may already
  exist before the menu or feature is published, including staff-created or accepted seasonal bookings.
- **Rationale:** Guests can book future dates before the October menu publication, and deployment is planned for
  September.
- **Impact:** Existing Christmas bookings will have no contacts, tokens, invitations or manager visibility.
- **Recommended action:** Define an idempotent discovery/backfill job, eligibility rules, dry-run report,
  manager approval, contact source, permission handling and first-message timing. Reconcile counts before
  activation.
- **Open questions:** How many qualifying production bookings exist? May existing booker data be used to send the
  first service message? How are declined seasonal bookings excluded?

### F36 — Current-state and cross-repo delivery evidence is not reproducible

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery / Configuration
- **Relevant section:** §2; Parts A, D and E
- **Description:** “Exists and works” and “already built” do not state branch, commit, deployed environment or
  production verification. The linked outstanding-work document has older claims that conflict with this
  spec. D4 also combines several completed branches without dependency order.
- **Rationale:** Code present on a branch is not the same as merged, deployed and verified.
- **Impact:** Work can be omitted, merged in the wrong order or falsely treated as live.
- **Recommended action:** Add a release manifest with repo SHA, branch/PR, migration version, environment,
  dependency and verification evidence for each delivered item. Refresh or mark older documents superseded.
- **Open questions:** Which changes are only local, merged to main, preview-deployed or production-deployed?

### F37 — Removing old code is confused with removing deployment rollback

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Delivery risk
- **Relevant section:** D5; Part E
- **Description:** Deleting the old four-step implementation may be an owner decision, but it does not remove
  the need to roll back a bad deployment. The linked analytics gate and missing live-flow coverage further
  increase the risk.
- **Rationale:** A release rollback restores a known commit; it need not preserve a runtime feature flag or dead
  path forever.
- **Impact:** A production regression may have no documented recovery and could affect all bookings.
- **Recommended action:** Keep D5 as source deletion if confirmed, but require a deployment rollback/runbook,
  database compatibility window and tested forward fix. Complete replacement tests before deletion and record
  the explicit waiver of the analytics gate.
- **Open questions:** Does “no rollback kept” mean no feature flag, no old source code, or no ability to redeploy
  the prior release?

### F38 — The test plan is materially incomplete

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Testing
- **Relevant section:** §3
- **Description:** The listed tests omit API contracts, RLS/authorisation, migration/backfill, provider timeout
  and pending states, outbox crash recovery, concurrency, menu revisions, date transitions, staff outputs,
  accessibility, volume, cross-repo compatibility and deployment rollback.
- **Rationale:** Most high-risk behaviour is at boundaries and failure points, not in arithmetic helpers.
- **Impact:** Green unit tests can coexist with lost messages, over-refunds or unusable kitchen output.
- **Recommended action:** Add a requirement-to-test matrix. Include database invariant tests; time/DST tests;
  PayPal/SMS/email sandbox tests; failure injection; end-to-end guest/booker/staff tests; accessibility scans
  plus manual checks; production-safe smoke tests and reconciliation tests.
- **Open questions:** Who provides UAT sign-off? Is there a staging environment with realistic menu, PayPal and
  SMS behaviour?

### F39 — Accessibility requirements are absent

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Accessibility / UX
- **Relevant section:** Parts A and B; §3
- **Description:** Repeated course pickers, dynamic cover totals, validation, status messages, timeout/error pages
  and mobile links have no accessibility acceptance criteria.
- **Rationale:** A multi-person form is difficult for keyboard and screen-reader users without deliberate
  grouping, labels, focus and error summaries.
- **Impact:** Some guests may be unable to submit required food choices.
- **Recommended action:** Set WCAG 2.2 AA as the target. Require semantic fieldsets/legends, unique labels,
  keyboard operation, focus management, live announcements for remaining covers, linked errors, adequate
  touch targets and manual screen-reader testing.
- **Open questions:** Which browsers and assistive technologies are supported?

### F40 — Capacity and performance requirements are missing

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Performance / Cost
- **Relevant section:** §B.7; §B.11; §4 Rollout
- **Description:** There are no targets for guest-page latency, large-party rendering, cron batch size, queue
  throughput, provider rate limits, query plans or digest size. The SMS cost example has no budget or alert
  threshold.
- **Rationale:** A 20-cover, multi-course form and a menu-wide withdrawal can create many rows and messages at
  once.
- **Impact:** Slow pages, cron overruns, rate limiting and unexpected messaging cost.
- **Recommended action:** Set simple budgets, add due-work indexes and pagination/batching, load-test worst-case
  parties and mass menu changes, and monitor messages per booking and per day.
- **Open questions:** What is peak seasonal booking volume and acceptable SMS spend?

### F41 — Observability does not cover the new end-to-end journey

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Monitoring / Audit
- **Relevant section:** Part D; §3; §4
- **Description:** Operational alerts cover selected failures, but there are no journey metrics, correlation IDs,
  queue age, completion funnel, contact coverage reconciliation, token errors, refund mismatches or privacy
  cleanup results.
- **Rationale:** The feature spans two repos and several asynchronous systems; logs alone will not locate a
  broken stage.
- **Impact:** Failures may first appear as guest calls or missing food on service day.
- **Recommended action:** Add correlation IDs from booking through contact, message and refund jobs. Dashboard
  eligible bookings, contacts/covers mismatch, completion by cutoff, oldest queue item, delivery failures,
  refund reconciliation and retention failures. Avoid personal data in telemetry.
- **Open questions:** What service levels should alert before the cutoff is missed?

### F42 — Delivery plan lacks owners, estimates and go/no-go gates

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery
- **Relevant section:** §B deadline; §4 Rollout
- **Description:** “Build and test in September” has no work breakdown, owners, estimates, dependencies, decision
  dates, privacy review, content approval, UAT window, provider setup, support training or contingency.
- **Rationale:** Parts B and C are several projects: schema/API, public UI, staff UI, communications, payment and
  compliance.
- **Impact:** The October menu date can arrive with an incomplete or unsafe journey.
- **Recommended action:** Split into deliverables with named owners and entry/exit criteria. Set decision
  deadlines for O1–O5, privacy and payment design review, staging/UAT, backfill rehearsal, production go/no-go,
  support runbook and rollback rehearsal.
- **Open questions:** Who is product owner, privacy owner, payment owner and operational approver? What is the
  fallback if the full feature misses the date?

### F43 — Guest copy and common error journeys need acceptance criteria

- **Status:** Optional improvement
- **Priority:** P2
- **Type:** UX / Content
- **Relevant section:** §§A.3, B.5, B.6
- **Description:** Copy is left for owner confirmation, and there are no defined journeys for API outage,
  expired link, changed menu, invalid number, no SMS, partial save, offline retry, validation summary or guest
  needing staff help.
- **Rationale:** These states will occur and service contact details should be consistent.
- **Impact:** Guests may abandon or call without enough information for staff to help.
- **Recommended action:** Add a small copy deck and error-state matrix with phone number, booking reference,
  retry behaviour and accessible focus rules. Version the consent/privacy wording.
- **Open questions:** Is email fallback offered to guests? Can staff complete choices by phone?

### F44 — A smaller first release could remove the highest-risk complexity

- **Status:** Optional improvement
- **Priority:** P2
- **Type:** Simplification / Delivery
- **Relevant section:** D8, D10–D14; Part B
- **Description:** Third-party contacts create most of the token, consent, STOP, privacy, messaging and shared-
  editing complexity. The core need can be met if the booker initially submits choices for all covers.
- **Rationale:** D12 is useful but not essential to storing per-cover food choices. It can be added after the
  staff workflow and core data model are proven.
- **Impact:** The full design has a high chance of missing the seasonal deadline or shipping with privacy gaps.
- **Recommended action:** Ask the owner to consider phase 1 as booker-only contact plus staff phone entry, with
  per-cover storage and kitchen outputs. Phase 2 can add delegated contacts and SMS ladders behind a separate
  flag.
- **Open questions:** Is guest delegation essential for the first Christmas season? What proportion of bookings
  is expected to need it?

## 4. Specific wording changes suggested

These are targeted corrections, not a rewrite of the original document.

1. **§B.2 index comment**  
   Replace “exactly one booker contact per booking” with “at most one booker contact per booking; exactly one
   must be enforced by the booking/contact creation transaction or a stronger database design.”

2. **§B.6 allergy note**  
   Replace “Free text about allergies is health-adjacent” with: “Allergy details can be health data and must be
   treated as special-category personal data. Before collection, document both the Article 6 lawful basis and
   Article 9 condition, access, privacy notice and retention.”

3. **§B.7 late booking example**  
   Replace “A booking made two days out gets T0 and the cutoff only” with an exact rule such as: “A booking made
   after its cutoff receives the T0 invitation immediately; no past chase is recreated; the manager escalation
   is queued immediately if the order is incomplete.” Confirm this is the owner's intended behaviour.

4. **§B.7 ledger recommendation**  
   Replace “written before sending” with: “Create a durable pending outbox row before sending. Mark provider
   acceptance and delivery separately, and retry expired leases with the same business/provider idempotency
   key.”

5. **Part C rule 6**  
   Replace “leaves the booking untouched” with wording based on an explicit amendment state, for example:
   “The amendment remains pending until the refund reaches a defined outcome. Provider success with local
   failure enters reconciliation and must not be retried with a new idempotency key.”

6. **D5 / Part E rollback wording**  
   Clarify: “Delete the old runtime path and flag. Keep normal deployment rollback and a database-compatible
   recovery window.”

7. **§4 activation wording**  
   Replace “publishing the menu is the switch” with: “A separate readiness flag activates pre-orders. Menu
   publication is required content, not proof that all services are ready.”

8. **E1 cancellation wording**  
   State separately what happens on status cancellation, administrative hard deletion and GDPR erasure.

## 5. Unresolved decisions that must be closed

1. Token storage and subject model: O1, after a shared-token impact audit.
2. Every period transition on booking amendment, not only O2's outside-period move.
3. Party growth payment, hold and rollback behaviour: O3.
4. Required and optional courses, including “no course” choices: O4.
5. Article 6 basis, Article 9 condition, privacy notice, DPIA need and retention for allergy data.
6. Staff/kitchen output and who signs off an order.
7. Whether the booker can view or edit another contact's choices and health-related notes.
8. Exact chase timestamps, message cap and inside-cutoff behaviour.
9. Refund target calculation, provider age limit and manual fallback.
10. Whether D5 explicitly overrides the earlier analytics retirement gate.
11. O5 retention only after a complete field-by-field schedule is available.

## 6. Overall readiness assessment

**Readiness: red — not ready for implementation as one delivery.**

Part A appears close to release once content, error and accessibility checks are added. Part E's test rewrite can
be planned independently, but deletion should not proceed until the decision conflict and rollback meaning are
resolved. Parts B and C need design work before reliable estimates or implementation. Part D needs a self-
contained operational contract and secure alert handling.

### Required changes before build starts

1. Define the staff and kitchen fulfilment journeys.
2. Replace the contact/selection-only model with a stable cover model and enforceable relationships.
3. Resolve O1–O4 and the allergy-data legal basis.
4. Define creation, amendment, chase and refund state machines with recovery paths.
5. Write the cross-repo API contracts and access matrix.
6. Add backfill, activation, monitoring and rollback plans.
7. Expand the test plan into a requirement-to-test matrix.

### Major risks

- Sensitive allergy data handled under an incomplete legal basis.
- Lost or duplicate messages from weak outbox semantics.
- Over-refunds or money/booking mismatch after concurrent amendments.
- Existing seasonal bookings omitted at launch.
- Kitchen unable to use the collected data.
- Cross-repo partial deployment activated by ordinary menu publication.
- Removal of the old booking path without measured evidence or a clear recovery plan.

### Recommended next steps

1. Hold a short owner/developer/operations decision session for the 11 unresolved decisions above.
2. Produce two focused designs: cover/order data plus staff fulfilment; amendment/refund saga.
3. Get privacy review of third-party phone and allergy processing before schema approval.
4. Choose full scope or the booker-only first release in F44.
5. Write API contracts, migration/backfill plan and state-transition tables.
6. Re-estimate against the October activation date and agree a fallback.
7. Only then create implementation tickets and acceptance tests.
