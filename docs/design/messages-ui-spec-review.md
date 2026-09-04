# Developer review: `/messages` UI rebuild specification

Review date: 2026-09-04  
Reviewed document: `docs/design/messages-ui-spec.md`  
Review scope: specification quality, current implementation, delivery evidence, and release risk  
Original document changed: no

## Overall assessment

**Readiness: not ready for release or final developer sign-off.**

The responsive layout work is detailed and well evidenced. The height, column, overflow, truncation, timezone, and basic mobile navigation changes are sensible. The stated lint, type-check, full test, and production build results are reproducible in the supported Node 20 environment.

However, the specification concentrates on layout and does not define several important inbox behaviours. The current implementation can mark a mobile conversation read before the user opens it, can show one customer's data while another customer is selected, and always sends an SMS even when the open conversation is email or WhatsApp. These are release blockers.

The document also says the change is “presentation only” with two behaviour changes. That is not accurate. Search behaviour, filter combinations, selection, read state, message grouping, channel display, contact access, keyboard sending, error feedback, and navigation all change.

### Priority guide

- **P0**: release blocker; risk of wrong-customer action, wrong-channel contact, or unread-state corruption.
- **P1**: required before release sign-off.
- **P2**: should be resolved or explicitly accepted before release.
- **P3**: optional improvement.

### Finding classes

- **Confirmed issue**: visible in the current specification or implementation.
- **Required gap/decision**: the specification does not define enough to implement or accept safely.
- **Optional improvement**: useful, but not required for the stated release.

## Release blockers and required findings

### F01 — Async responses can put the wrong customer on screen

- **Section:** 2.5 Thread; 2.9 Thread scroll position; 5 Verified
- **Priority / type:** P0 — Correctness, concurrency
- **Class:** Confirmed issue
- **Description:** Conversation requests have no cancellation, request identity, or stale-response guard. The previous customer's messages and contact remain in state while a new customer loads. A slow response for customer A can arrive after customer B and overwrite the visible data while `selectedCustomerId` still points to B.
- **Rationale:** `loadConversationMessages` writes every successful response directly to shared `messages` and `selectedCustomer` state. Selection does not clear that state.
- **Impact:** Staff could read A's history under B's selection, open the wrong profile, or send an SMS to B while the screen still shows A. A load failure can leave the same unsafe stale state in place.
- **Recommended action:** On selection, clear or replace the thread with a customer-specific loading state. Track a request sequence or use cancellation and only commit a response when its customer ID still matches the active selection. Disable sending until the selected ID, loaded customer, and loaded messages all match.
- **Open questions:** Should cached threads be kept per customer, or should every switch show a clean loading state?

### F02 — Mobile auto-selection marks a conversation read before it is opened

- **Section:** 1.9; 2.5; 4 Behaviour changes
- **Priority / type:** P0 — Functional correctness, data state
- **Class:** Confirmed issue
- **Description:** The first unread conversation is automatically selected after the list loads. A selection effect immediately calls `markConversationAsRead`, even below 821px where the thread is hidden and the user is still looking at the list.
- **Rationale:** The specification treats selection and opening as the same event, but they are different on the one-pane mobile layout.
- **Impact:** Unread work can disappear without being seen. This can cause missed customer messages and makes unread counts untrustworthy.
- **Recommended action:** Do not auto-select on the one-pane layout, or separate “selected” from “opened/visible.” Mark read only after the thread is visible and the message data has loaded successfully. Add a regression test for a mobile initial load.
- **Open questions:** On two- and three-pane layouts, should automatic selection count as read immediately, after load, after focus, or only after explicit user action?

### F03 — A mixed-channel thread always replies by SMS

- **Section:** 2.4 Conversation list; 2.5 Thread; 2.6 Composer
- **Priority / type:** P0 — Functional, integration, customer contact
- **Class:** Confirmed issue and required decision
- **Description:** The inbox displays SMS, WhatsApp, email, and feedback in one timeline, but the composer always calls `sendSmsReply`. The specification never says whether reply means “reply by SMS,” “reply on the last inbound channel,” or “let staff choose a channel.”
- **Rationale:** The visible conversation and the outbound transport are not the same concept. A customer may have emailed without consenting to SMS or may have no mobile number.
- **Impact:** Staff may contact a customer through the wrong channel, fail to reply, or believe they replied to an email/WhatsApp message when they sent an SMS instead.
- **Recommended action:** Define the reply-channel rule before release. The safest small scope is to label the composer clearly as “Send SMS,” show the destination number, and disable it unless SMS is available and allowed. If same-channel reply is expected, add channel-specific send actions and eligibility checks.
- **Open questions:** Are email and WhatsApp replies intentionally unsupported? If so, what action should staff take from those threads?

### F04 — “New message” uses the wrong permission gate and misleading route

- **Section:** 2.3 Page header; 6 Out of scope
- **Priority / type:** P1 — RBAC, navigation
- **Class:** Confirmed issue
- **Description:** The button is shown for `send_transactional` or `manage`, but it links to `/messages/bulk`, whose page requires `send_marketing`.
- **Rationale:** “Permission-gated as today” does not name the required permission and the source and target disagree.
- **Impact:** Some users see an allowed-looking action and are then sent to Unauthorized. Other users with marketing permission but without the two source permissions may not see the link.
- **Recommended action:** Gate the link with `send_marketing`, or change the destination to a true one-customer transactional composer. State the exact permission in the specification and add an RBAC matrix test.
- **Open questions:** Is this meant to start a single transactional message or a bulk marketing send?

### F05 — Read-state permissions and ownership are undefined

- **Section:** 2.3; 2.5; 4 Behaviour changes
- **Priority / type:** P1 — RBAC, data model, multi-user workflow
- **Class:** Confirmed issue and required decision
- **Description:** `/messages` requires only `messages.view`, but opening, “Mark unread,” and “Mark all read” mutate global read state. The UI does not hide those controls from view-only users. The server write gate uses `manage` or `send_transactional`, while the service also performs a separate view check. The specification does not say whether read state is global or per staff member.
- **Rationale:** Read state controls shared operational work. Permission and ownership rules must be explicit.
- **Impact:** View-only users get failure toasts. One staff member can clear or restore unread work for everyone. Concurrent staff actions can conflict without a clear winning rule.
- **Recommended action:** Define whether read state is shared or per user. Define the permission for every action, gate the UI to the same rule, and test view-only, transactional, manager, and template-only roles.
- **Open questions:** Is “read” a shared team queue state or personal staff state? Is an audit trail required?

### F06 — Reply eligibility treats unknown consent as opted in

- **Section:** 2.6 Composer; 2.7 Contact panel
- **Priority / type:** P1 — Consent, correctness, error handling
- **Class:** Confirmed issue
- **Description:** `sms_opt_in` is nullable. The UI treats every value except `false` as replyable and the contact panel displays null as “Opted in.” The server correctly fails closed when the value is null. A missing mobile number is also not checked before showing the composer.
- **Rationale:** Unknown consent is not confirmed consent, and a reply cannot be sent without a usable destination.
- **Impact:** The UI gives a false compliance signal and allows staff to compose a message that the server will reject.
- **Recommended action:** Define explicit states for opted in, opted out, and unknown/not recorded. Require a valid mobile number and confirmed SMS eligibility before enabling send. Show a clear read-only reason for all blocked states, including missing permission.
- **Open questions:** Can transactional SMS legally be sent when `sms_opt_in` is null, or must the customer explicitly opt in?

### F07 — New messages in an open thread have no read-state rule

- **Section:** 2.5 Thread; 6 Out of scope
- **Priority / type:** P1 — Functional, concurrency
- **Class:** Required gap
- **Description:** Polling refreshes the open thread with `markAsRead: false`. A new inbound message can therefore appear in the thread while remaining unread in the list. The opposite policy could also be wrong if the user is scrolled away or the tab is hidden.
- **Rationale:** “Opening a conversation marks it read” does not define messages that arrive after opening.
- **Impact:** Counts can disagree with what is on screen, or messages can be cleared without being noticed.
- **Recommended action:** Define visibility-based read rules. Consider the tab visibility, active customer, thread visibility, and whether the user is near the newest message. Add multi-tab and multi-user cases.
- **Open questions:** Should an inbound message be marked read when rendered, when the tab is focused, when it enters the viewport, or only on explicit action?

### F08 — Search and “all conversations” are incomplete without saying so

- **Section:** 2.4 Conversation list; 6 Out of scope
- **Priority / type:** P1 — Data completeness, functional
- **Class:** Confirmed issue
- **Description:** Search and filters run only over data already loaded in the browser. The inbox service fetches 250 recent communications, not 250 conversations, plus up to 500 unread communications. One very active customer can consume much of the recent limit, so older read conversations may be absent.
- **Rationale:** The UI labels imply a complete inbox and complete search.
- **Impact:** Staff may conclude that a customer or conversation does not exist. Results depend on unrelated message volume.
- **Recommended action:** Either add conversation-level pagination and server search, or label the view as recent/limited and provide a supported route to older results. Define result scope and ordering in the specification.
- **Open questions:** How far back must staff be able to search? Is search expected to include message text as well as name, phone, and email?

### F09 — Unread totals can be shown as exact when they are capped

- **Section:** 2.3 Page header; 2.4 Conversation list; 6 Out of scope
- **Priority / type:** P1 — Data accuracy
- **Class:** Confirmed issue
- **Description:** When at least 500 unread communication rows exist, `hasMoreUnread` is true but `totalUnread` is calculated only from fetched rows. The header and toggle still display the number as exact.
- **Rationale:** A banner that says older unread messages exist does not make “500 unread messages” an accurate total.
- **Impact:** Operational counts, prioritisation, and acceptance checks are misleading.
- **Recommended action:** Return an exact count query, or display “500+” and call it a lower bound. Define whether “Mark all read” affects only the visible result or every unread record; the current server action affects all.
- **Open questions:** Is an exact total needed, or is a capped count acceptable?

### F10 — The open timeline is unbounded and repeatedly reloaded

- **Section:** 2.5 Thread; 6 Out of scope
- **Priority / type:** P1 — Performance, scalability
- **Class:** Confirmed issue
- **Description:** The timeline query selects every column for every communication for the customer, in ascending order, with no page limit. The client renders all bubbles and reloads the full result every 30 seconds.
- **Rationale:** Long histories include large HTML bodies, attachments, delivery history, engagement, and context that this UI mostly does not use.
- **Impact:** Slow thread opens, high database and network load, large browser memory use, scroll jank, and polling overlap as histories grow.
- **Recommended action:** Define a page size and “load older” behaviour. Select only rendered fields, use a cursor for new messages, and consider list virtualisation only if paging is not enough. Add payload and latency budgets.
- **Open questions:** What is the largest real customer timeline today, and what growth is expected?

### F11 — Loading failures are presented as valid empty data

- **Section:** 2.4 Conversation list; 2.5 Thread; 5 Verified
- **Priority / type:** P1 — Reliability, error handling
- **Class:** Confirmed issue
- **Description:** Initial inbox failure ends the skeleton and shows “No conversations” after only a toast. A thread failure can leave old customer data visible. There is no persistent error state or local retry action.
- **Rationale:** Empty, loading, permission, and failure are different states and need different UI.
- **Impact:** Staff can mistake an outage for an empty queue, miss inbound work, or act on stale data.
- **Recommended action:** Add explicit inbox and thread error states with Retry. Keep the active customer identity visible but never show another customer's content. State what remains visible during background refresh failure.
- **Open questions:** Should stale data remain visible with a clear “last updated / refresh failed” warning, or be hidden?

### F12 — Send success is not defined precisely

- **Section:** 2.5 Thread; 2.6 Composer; 5 Verified
- **Priority / type:** P1 — Integration, user feedback
- **Class:** Confirmed issue and required gap
- **Description:** The send service can return sent, scheduled/deferred, duplicate-suppressed, logging failure, or delivery failure states. The UI generally says “Message sent” for any non-error, non-suppressed result. The specification only defines a generic send path and later delivery labels.
- **Rationale:** Accepted, queued, scheduled, sent, delivered, and logged are not the same outcome.
- **Impact:** Staff may promise that a customer has been contacted when the message is only scheduled or its audit record failed.
- **Recommended action:** Define the user-facing result for every service outcome. Use “Scheduled,” “Queued,” or “Sent” accurately. Keep failed content available for retry. Define whether sending should always scroll the staff member to their new outbound message.
- **Open questions:** Is quiet-hours deferral expected from inbox replies? Should staff be told the planned send time?

### F13 — “Mark unread” and “Mark all read” have unexpectedly broad scope

- **Section:** 2.3; 2.5
- **Priority / type:** P1 — Functional, data mutation
- **Class:** Confirmed issue and required decision
- **Description:** “Mark unread” changes every previously read inbound SMS, WhatsApp, and email for the customer back to unread. “Mark all read” changes every unread inbound message in the database, including records not present in the capped list. The wording does not explain either scope.
- **Rationale:** Most inboxes use “Mark unread” as a reminder on the latest item or conversation, not as restoration of the full historic unread count.
- **Impact:** Counts can jump by hundreds and shared queue state can change far beyond what the user saw.
- **Recommended action:** Decide whether the desired model is a conversation-level unread flag, the latest inbound message, or all messages since a point. Rename actions and add confirmation if the broad global scope is intentional.
- **Open questions:** What should the unread count become after “Mark unread”: 1, the number since last reply, or all inbound history?

### F14 — The iPad touch-target problem identified in the spec is not fixed

- **Section:** 1.3; 2.2 Responsive layout; 2.4 Conversation list
- **Priority / type:** P1 — Accessibility, touch usability
- **Class:** Confirmed issue
- **Description:** Section 1.3 identifies 25/31px controls from 821–1023px as part of the problem. The target changes the columns but keeps the desktop control-size rules at and above 821px. The 44px floor still applies only below 821px.
- **Rationale:** iPads and other touch devices commonly have CSS viewports above 821px.
- **Impact:** Small targets remain hard to use and may fail WCAG 2.2 target-size expectations.
- **Recommended action:** Apply touch sizing by input capability or make the inbox controls at least 44px in the 821–1279px band. Test real iPad portrait and landscape interaction, not only width.
- **Open questions:** Is compact desktop density more important than a consistent 44px target in this inbox?

### F15 — Screen-reader and keyboard behaviour is not specified

- **Section:** 2.4 Conversation list; 2.5 Thread; 2.7 Contact panel; 5 Verified
- **Priority / type:** P1 — Accessibility
- **Class:** Required gap
- **Description:** The specification gives visual states but no accessible name, focus, announcement, or reading-order requirements. Message direction is communicated mainly by alignment and colour. New messages are not announced. Mobile pane changes do not say where focus moves. The thread scroller has no message-log semantics.
- **Rationale:** A responsive visual check cannot establish accessibility.
- **Impact:** Keyboard and screen-reader users may not know who sent a message, whether a pane changed, whether new content arrived, or how to return to the selected row.
- **Recommended action:** Add WCAG 2.2 AA acceptance criteria. Define sender/direction text, `role="log"` or equivalent semantics, restrained live announcements, focus movement on open/back, focus return after drawer close, logical tab order, visible focus, zoom/reflow, and contrast checks.
- **Open questions:** Which browsers and assistive technologies are supported?

### F16 — Pointer detection is not a safe Enter-to-send rule

- **Section:** 1.11; 2.6 Composer; 4 Behaviour changes
- **Priority / type:** P1 — Input handling, accessibility
- **Class:** Confirmed risk
- **Description:** `matchMedia('(pointer: fine)')` is checked once. Hybrid laptops, tablets with a mouse, remote sessions, and changed input devices can report a fine pointer while the user is typing on a touch keyboard. The key handler also does not exclude IME composition.
- **Rationale:** Pointer capability does not reliably identify the current text input method.
- **Impact:** Enter can send incomplete text, including while a user is composing characters.
- **Recommended action:** Prefer a stable shortcut such as Ctrl/Cmd+Enter, or make Enter-to-send a user setting. If plain Enter remains, handle `isComposing`, listen for capability changes, and test hybrid devices.
- **Open questions:** Is plain Enter a firm staff requirement, or can the safer explicit shortcut be used everywhere?

### F17 — Current tests do not cover the highest-risk behaviour

- **Section:** 3 Files; 5 Verified
- **Priority / type:** P1 — Testing
- **Class:** Confirmed issue
- **Description:** The component test named “Responsive” runs in jsdom and does not set viewport widths, compute CSS, measure overflow, test focus, or exercise drawers. There are no tests for stale async responses, rapid selection, mobile auto-read, view-only RBAC, combined channel/send rules, null consent, missing mobile, polling arrivals, load failures, scheduled sends, IME input, or long histories.
- **Rationale:** The full suite passing proves regression safety elsewhere, but not these inbox requirements.
- **Impact:** The main release blockers can pass every current automated check.
- **Recommended action:** Add component tests for state and RBAC, plus browser tests at 375, 820, 821, 1024, 1279, and 1280px. Include delayed/out-of-order responses, keyboard/focus checks, a long thread, long names, large unread counts, errors, and axe or equivalent accessibility checks.
- **Open questions:** Is Playwright already part of the normal CI environment, or will these remain a documented manual suite?

### F18 — “Presentation only” and “two behaviour changes” are inaccurate

- **Section:** 3 Files; 4 Behaviour changes
- **Priority / type:** P1 — Specification accuracy, QA scope
- **Class:** Confirmed issue
- **Description:** The release changes search to include email, combines unread and channel filters, changes automatic selection effects, adds drawers, moves actions, changes status density, groups messages, changes timestamps, changes reply feedback, and exposes new contact links. These are observable behaviours, even without server or database changes.
- **Rationale:** QA, training, rollback, and release notes depend on an honest change inventory.
- **Impact:** Test scope is too narrow and stakeholders may approve a larger change than they realise.
- **Recommended action:** Replace “presentation only” with “client-side UI and interaction change; no server or database schema changes.” List all observable workflow changes and link each to acceptance tests.
- **Open questions:** Which changes have product-owner approval, especially combined filters and automatic read behaviour?

### F19 — Release ownership, approval, rollback, and deployment steps are missing

- **Section:** Status; 5 Verified; 6 Out of scope
- **Priority / type:** P1 — Delivery
- **Class:** Required gap
- **Description:** “Status: implemented” has no owner, reviewer, commit/PR, acceptance sign-off, deployment target, feature flag, rollout plan, rollback condition, or post-release check. The reviewed implementation is currently in an uncommitted working tree alongside unrelated changes.
- **Rationale:** Passing local checks is not the same as a releasable, traceable change.
- **Impact:** The wrong files can be deployed, review evidence can drift, and rollback can be slow if the inbox fails during service.
- **Recommended action:** Record the commit/PR, owners, required approvals, CI run, environment, release window, smoke test, rollback method, and go/no-go checks. Keep unrelated changes out of the release commit. Consider a short-lived feature flag if the P0 fixes cannot be isolated confidently.
- **Open questions:** Who owns product acceptance and who is on call after release?

### F20 — Mobile drawer placement contradicts the target

- **Section:** 2.2; 2.7 Contact panel; 5 Verified
- **Priority / type:** P2 — Specification/implementation mismatch
- **Class:** Confirmed issue
- **Description:** Section 2.7 requires a bottom drawer below 821px, while section 2.2 only says a full-width drawer. The implementation always uses a right drawer with full width on mobile.
- **Rationale:** Drawer direction affects motion, reachability, screenshots, and acceptance tests.
- **Impact:** The implementation cannot be accepted against the written target without deciding which statement is correct.
- **Recommended action:** Choose one mobile placement, update the wording, and add a browser test for it.
- **Open questions:** Is bottom-sheet behaviour a design requirement or was full-width right entry accepted during implementation?

### F21 — The required opt-out profile link is missing

- **Section:** 2.6 Composer
- **Priority / type:** P2 — Functional mismatch
- **Class:** Confirmed issue
- **Description:** The specification says the opt-out notice includes a link to the profile. The implementation shows plain text only.
- **Rationale:** The notice tells staff to use the profile but gives no direct action.
- **Impact:** Extra navigation and a direct acceptance failure.
- **Recommended action:** Add an accessible link/button to the selected profile, or change the requirement if direct navigation is intentionally removed.
- **Open questions:** Should the link open the consent section directly rather than the profile top?

### F22 — Grouping and channel-label wording is contradictory

- **Section:** 2.5 Thread
- **Priority / type:** P2 — Specification clarity, message status
- **Class:** Confirmed issue and required gap
- **Description:** A run is defined as the same side and same channel, so a channel cannot “change within a run.” The implementation labels every non-SMS run. It also shows only the last message's timestamp and delivery status, which can make a mixed sent/delivered/read run look uniform. Email bounce and other channel-specific statuses are not defined.
- **Rationale:** Grouping removes per-message facts, so the remaining group label must have precise meaning.
- **Impact:** Staff can misread delivery state or developers can implement different grouping rules.
- **Recommended action:** State: “Show the channel once at the start of each non-SMS run; omit it for SMS.” Define which statuses may be grouped and how sent, delivered, read, scheduled, bounced, failed, and undelivered appear.
- **Open questions:** Should a status change break a run? Should email “read/opened” remain distinct from delivered?

### F23 — Filter semantics and feedback handling are not defined

- **Section:** 2.4 Conversation list
- **Priority / type:** P2 — Functional, data contract
- **Class:** Required gap
- **Description:** The spec does not say whether Unread and channel filters combine, whether channel means the latest message or any historical channel, how counts react to other filters, or how filters are cleared. The data model includes `feedback`, but the channel select does not.
- **Rationale:** A conversation can contain several channels, and the current `channels` list is itself based on capped data.
- **Impact:** A WhatsApp filter can show a row whose latest message is SMS with no WhatsApp label. Staff may not understand why a result is present or absent.
- **Recommended action:** Define filter intersection, scope, count rules, empty state, clear action, and feedback treatment. Prefer filtering by an explicit conversation field rather than an incidental historic-channel array.
- **Open questions:** Should feedback appear in this inbox at all?

### F24 — Sorting, initial selection, and browser Back behaviour are unstated

- **Section:** 2.2; 2.4; 2.5
- **Priority / type:** P2 — User journey
- **Class:** Required gap
- **Description:** The service puts all unread conversations before read conversations, then sorts by time. The client auto-selects the first unread conversation. Mobile row selection is local state and does not add browser history, so device/browser Back can leave the page instead of returning to the list.
- **Rationale:** These choices determine which customer appears first and how staff move through work.
- **Impact:** Old unread threads can sit above newer replies, conversations can be marked read unexpectedly, and mobile Back behaviour can surprise users.
- **Recommended action:** State the sort and initial-selection rules. Decide whether mobile pane state belongs in URL/history. Test resizing between layout bands while a thread or drawer is open.
- **Open questions:** Should recency always win, should unread only decorate rows, or is unread-first a confirmed operational rule?

### F25 — Message content rules are incomplete for email and attachments

- **Section:** 2.5 Thread; 6 Out of scope
- **Priority / type:** P2 — Functional, integration
- **Class:** Confirmed issue and required gap
- **Description:** The thread prefers `body_text`, then `subject`, and renders the subject separately. An email with a subject but no text body repeats the subject. An HTML-only email can appear empty. Attachments show only labels, with no filename, count, type, safe download, unavailable state, or malware/expiry handling.
- **Rationale:** “Attachment rendering out of scope” does not define a usable fallback or explain what email content is guaranteed by the data source.
- **Impact:** Staff may miss the actual customer message or be unable to act on an attachment.
- **Recommended action:** Define channel-specific content precedence and a non-duplicating fallback. State minimum attachment metadata and a safe route to view/download, even if full inline rendering remains out of scope.
- **Open questions:** Are all inbound emails guaranteed to have `body_text`? Are attachment URLs signed and time-limited?

### F26 — Draft, scroll, and unseen-new-message journeys are missing

- **Section:** 2.5; 2.6; 2.9
- **Priority / type:** P2 — UX, state management
- **Class:** Required gap
- **Description:** Switching conversations clears the draft without warning. Returning to the list and reopening has no stated draft rule. When new messages arrive while the user is scrolled up, the thread does not auto-scroll and has no “new messages” indicator. Sending while scrolled up may leave the new outbound message off screen.
- **Rationale:** These are common inbox actions and data-loss cases.
- **Impact:** Staff can lose typed replies or fail to notice an arrival.
- **Recommended action:** Preserve drafts per customer for the session, or confirm before discarding. Add a new-message marker/jump action and always reveal a successfully sent outbound message.
- **Open questions:** Should drafts survive navigation or refresh, and for how long?

### F27 — Timestamp rules and edge cases do not fully match the wording

- **Section:** 2.4; 2.10
- **Priority / type:** P2 — Correctness, localisation
- **Class:** Confirmed issue
- **Description:** The spec says weekday for “this week,” but the implementation uses the previous six calendar days. Future timestamps are shown as “now.” Invalid thread timestamps can still reach date grouping. The exact spacing/case examples also differ by runtime locale formatting.
- **Rationale:** Calendar week and rolling six-day window are different rules.
- **Impact:** Small but visible inconsistencies, especially around Monday, clock skew, and imported data.
- **Recommended action:** Replace “this week” with “within the previous six calendar days,” or implement a real London calendar-week rule. Define future/invalid timestamp fallback and test DST boundaries.
- **Open questions:** Should future timestamps show the clock time, “Scheduled,” or a data warning?

### F28 — Polling is declared out of scope without performance acceptance criteria

- **Section:** 2.3; 6 Out of scope
- **Priority / type:** P2 — Performance, reliability
- **Class:** Required gap
- **Description:** The spec accepts 30-second polling but gives no query count, payload, latency, concurrency, hidden-tab, multi-tab, timeout, overlap, or backoff limits.
- **Rationale:** This UI makes polling more expensive by keeping a full timeline open. “Deliberate choice” is not a performance requirement.
- **Impact:** Database load and client memory can grow silently, especially on several staff devices or tabs.
- **Recommended action:** Record current measurements and a budget. Pause or reduce polling for hidden tabs, prevent overlapping requests, use backoff after failures, and fetch deltas where practical.
- **Open questions:** How many simultaneous inbox users and open tabs must be supported?

### F29 — Monitoring and success measures are missing

- **Section:** 5 Verified; 6 Out of scope
- **Priority / type:** P2 — Monitoring, delivery
- **Class:** Required gap
- **Description:** The specification has no client or server measures for inbox load failure, polling failure, stale data, send outcomes, wrong permission links, render time, or unread-count mismatch. It also gives no target for whether the rebuild improves response work.
- **Rationale:** Manual viewport checks cannot detect production data, permission, or concurrency failures.
- **Impact:** Regressions may be found only after staff miss a message.
- **Recommended action:** Add structured error reporting for inbox and thread loads, action failures, and send outcome categories. Define post-release checks such as load success, median thread-open time, send error rate, and staff-reported missed messages.
- **Open questions:** Which existing communications monitoring can be reused, and who receives alerts?

### F30 — Responsive acceptance is too narrow and the 62px coupling remains brittle

- **Section:** 2.1; 2.2; 5 Verified
- **Priority / type:** P2 — Responsive design, maintainability, testing
- **Class:** Required gap
- **Description:** The target says “stop guessing,” but desktop height still depends on a 62px copy of shell padding. Verification covers six widths but not the exact 820/821 and 1279/1280 boundaries, browser zoom, large text, long translated content, safe areas, virtual keyboard, split screen, the unread alert, or real touch input. No browser/OS versions are recorded.
- **Rationale:** The known bugs were caused by shell coupling and content-dependent height.
- **Impact:** A shell token change or accessibility setting can reintroduce clipping or small controls without failing tests.
- **Recommended action:** Prefer a shell-provided definite-height content area or shared layout token. Expand acceptance to boundary widths, 200% zoom, large text, keyboard open, long names/counts, alert present, and supported Safari/Chrome/Edge combinations.
- **Open questions:** Can `AppShell` expose a reusable full-height page slot so the inbox does not own shell arithmetic?

### F31 — Verification evidence needs a reproducible environment record

- **Section:** 5 Verified
- **Priority / type:** P2 — Delivery evidence
- **Class:** Confirmed issue
- **Description:** Commands and totals are listed, but the Node version, memory setting, commit, browser, OS, data fixture, and run link are not. In this review, the build failed with an out-of-memory error under unsupported Node 26, then passed under the repository's Node 20.19.5 with `NODE_OPTIONS=--max-old-space-size=8192`.
- **Rationale:** Build reproducibility depends on the supported runtime and available memory.
- **Impact:** A developer can get a different result while believing they ran the same verification.
- **Recommended action:** Record Node 20, memory setting, exact commit, CI URL, browser/device versions, and fixture or account used. Keep the environment in automated scripts where possible.
- **Open questions:** Is the production build environment fixed to the same Node and memory limits as CI?

## Optional improvements and simplifications

### O01 — Use one unambiguous name for the bulk-send action

- **Section:** 2.3 Page header
- **Priority / type:** P3 — UX simplification
- **Class:** Optional improvement
- **Description:** “New message” suggests a single conversation, while the route is a bulk marketing screen.
- **Rationale:** Accurate labels reduce permission and expectation problems.
- **Impact:** Fewer wrong turns and less training.
- **Recommended action:** Rename it “Bulk message” or “Send campaign” if the destination remains `/messages/bulk`.
- **Open questions:** None after F04 is decided.

### O02 — Use one keyboard shortcut on every device

- **Section:** 2.6 Composer
- **Priority / type:** P3 — Interaction simplification
- **Class:** Optional improvement
- **Description:** Device-capability branching adds edge cases and hidden behaviour.
- **Rationale:** Ctrl/Cmd+Enter to send and Enter for newline is predictable across desktop, tablet, hybrid devices, remote sessions, and assistive input.
- **Impact:** Less code, simpler tests, and lower accidental-send risk.
- **Recommended action:** Use Ctrl/Cmd+Enter and show the shortcut in the composer help text.
- **Open questions:** Confirm with staff before changing an established Enter-to-send habit.

### O03 — Separate layout acceptance from inbox workflow changes

- **Section:** 3 Files; 4 Behaviour changes
- **Priority / type:** P3 — Delivery simplification
- **Class:** Optional improvement
- **Description:** The release combines responsive repair with grouping, timestamp, filter, action, contact, and composer behaviour changes.
- **Rationale:** Smaller changes are easier to review and roll back.
- **Impact:** Lower release risk and clearer fault isolation.
- **Recommended action:** If schedule allows, land the correctness and layout foundation first, then ship grouping/density refinements separately.
- **Open questions:** Is the current change already too far through review to split cleanly?

### O04 — Add URL state for the selected conversation

- **Section:** 2.2; 2.5
- **Priority / type:** P3 — Navigation improvement
- **Class:** Optional improvement
- **Description:** Selection exists only in client state.
- **Rationale:** A query parameter or nested route can support deep links, refresh recovery, browser Back, and easier support/debugging.
- **Impact:** Better mobile navigation and reproducible issue reports.
- **Recommended action:** Consider `/messages?customer=<id>` or a nested route after the release blockers are fixed.
- **Open questions:** Are customer IDs acceptable in internal URLs and logs?

## Suggested wording changes to the original specification

These are targeted edits only; the original document has not been rewritten.

1. **Status**

   Replace `Status: implemented` with:

   > Status: implemented in the working tree; not release-ready pending correctness, RBAC, accessibility, and acceptance review.

2. **Section 2.3, New message**

   Replace “permission-gated as today” with the exact permission and intended action, for example:

   > `Bulk message` (primary, → `/messages/bulk`), shown only to users with `messages.send_marketing`.

3. **Section 2.5, channel label**

   Replace “only when it changes within a run” with:

   > Show the channel once at the start of each non-SMS run. Omit the label for SMS runs.

4. **Section 2.6, composer purpose**

   Add:

   > This composer sends SMS only. Show the destination number and disable it unless the customer has a valid mobile number, confirmed SMS eligibility, and the user has transactional-send permission. Email and WhatsApp replies are not supported in this release.

   Use different wording if same-channel replies are the actual requirement.

5. **Section 2.7, mobile drawer**

   Choose either “full-width right drawer” or “bottom drawer” and use the same wording in sections 2.2, 2.7, and 5.

6. **Section 3, change type**

   Replace “presentation only, with two behaviour changes” with:

   > No database schema or server API changes are required. This release changes client layout and several inbox interactions, listed in section 4.

7. **Section 4, behaviour changes**

   Add the exact rules for selection, marking read, new inbound messages, filtering, search scope, sorting, drafts, reply channel, send outcomes, and Mark unread scope.

8. **Section 5, verification**

   Add the commit, Node version, memory setting, browser/OS versions, test data, CI link, and automated/manual test split.

9. **Section 2.4, timestamp wording**

   Replace “this week” with “within the previous six calendar days” unless a true calendar-week rule is intended.

## Required decisions still unresolved

1. Is reply SMS-only, same-channel, or user-selectable?
2. Is unread state global to the team or personal to each staff member?
3. Exactly when does opening or viewing mark a message read on each layout?
4. What does “Mark unread” affect?
5. What is the source of truth for SMS eligibility when consent is null?
6. What is the complete scope of search and conversation history?
7. What permission should expose the bulk-send link?
8. What should staff see for scheduled, queued, sent, delivered, read, bounced, and failed outcomes?
9. Is the mobile details surface a bottom drawer or a full-width right drawer?
10. What browser, device, accessibility, load, and latency targets define acceptance?

## Major risks

- Wrong-customer information or actions caused by stale async responses.
- Missed inbound messages caused by mobile auto-read and unclear open-thread read rules.
- Contact through the wrong channel because a mixed thread always sends SMS.
- Consent and permission confusion from nullable SMS state and mismatched RBAC gates.
- Incomplete search and misleading unread totals caused by row caps.
- Slow or unstable long threads caused by unbounded full-history polling.
- Accessibility failure on iPad-sized touch layouts and for keyboard/screen-reader users.
- Difficult rollback or audit because the implementation is not tied to a clean commit and release record.

## Recommended next steps

1. Stop release and resolve F01–F03 first.
2. Decide the reply-channel, read-state, consent, and Mark unread rules with the product owner.
3. Fix RBAC gates and all blocked-composer states.
4. Add stale-response protection, mobile read tests, and channel/send tests.
5. Add explicit error states, timeline paging, and honest unread/search limits.
6. Complete keyboard, screen-reader, touch-target, and browser-boundary acceptance testing.
7. Update the original specification only with the agreed targeted wording and full behaviour list.
8. Create a clean PR/commit, run CI in Node 20, record evidence, run a production-like smoke test, and define rollback checks.

## Review evidence

- The pasted source and `docs/design/messages-ui-spec.md` are identical except for the repository copy's final newline.
- Reviewed the current message client, list, thread, contact panel, formatting helpers, server actions, communications service, SMS reply service, shell, drawer, permissions, and current tests.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- Targeted inbox tests: 2 files, 13 tests passed.
- Full suite: 713 files, 6056 tests passed.
- Production build: passed with Node 20.19.5 and `NODE_OPTIONS=--max-old-space-size=8192`.
- A build under unsupported Node 26.4.0 compiled, then failed during type checking with an out-of-memory error. This does not contradict the supported Node 20 build, but shows why the verification environment must be recorded.
- The previous manual browser claims were inspected but not independently replayed in this review.
