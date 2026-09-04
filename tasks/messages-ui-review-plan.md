# /messages review response, implementation plan

Source: `docs/design/messages-ui-spec-review.md` (31 findings + 4 optional).
Target: `docs/design/messages-ui-spec.md` updated, then all changes implemented.

## Verification of the review's claims

Checked against the code before acting. Every P0/P1 claim is real:

| Finding | Verified how |
|---|---|
| F01 stale async | `loadConversationMessages` writes `setMessages`/`setSelectedCustomer` with no request identity |
| F02 mobile auto-read | selection effect calls `markConversationAsRead` regardless of whether the thread pane is visible |
| F03 SMS-only reply | composer calls `sendSmsReply` for every channel |
| F04 permission gate | `/messages/bulk/page.tsx` requires `send_marketing`; button gated on `send_transactional \|\| manage` |
| F05 read-state RBAC | `canWriteMessageReadState()` = `manage \|\| send_transactional`; UI shows the controls to anyone with `view` |
| F06 null consent | `MessageService.sendReply` throws on `!optInData?.sms_opt_in`, so null fails closed server-side; UI treats null as replyable |
| F09 capped total | `totalUnread` reduces over fetched rows only, capped at `UNREAD_COMMUNICATION_FETCH_LIMIT` = 500 |
| F10 unbounded thread | `getCustomerTimeline` does `select('*')` ascending with no limit, reloaded every 30s |
| F12 send outcomes | quiet hours returns `success: true, status: 'scheduled', deferred: true, scheduledFor` |
| F13 unread scope | `markConversationUnread` clears `read_at` on every previously read inbound row |
| F24 sort | service sorts unread-first, then recency |

`markConversationUnread`'s breadth is deliberate (it is the documented exact inverse of
`markConversationRead`, added to fix counts never returning). Keep the server behaviour, make the UI
honest about it.

## Decisions taken (defaults, owner can overrule)

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Reply channel | **SMS only this release**, labelled and gated | The review's own "safest small scope". Multi-channel reply needs new send paths per channel. |
| 2 | Unread state ownership | **Shared team state** | That is what the tables do. Document it, do not pretend otherwise. |
| 3 | When does opening mark read | **Thread pane visible AND messages loaded** | Fixes F02 without losing the convenience on desktop. |
| 4 | New inbound in an open thread | **Marked read only when tab visible, thread visible, and scrolled near the bottom** | Otherwise it disappears from the count unseen. |
| 5 | Mark unread scope | **Keep server breadth, tell the truth in the UI** | The symmetry is deliberate; the bug was the silent "1". |
| 6 | Null `sms_opt_in` | **Fail closed, own state "Not recorded"** | Matches the server. Unknown consent is not consent. |
| 7 | Bulk link permission | **`messages.send_marketing`**, renamed "Bulk message" | Matches the destination page. Adopts O01. |
| 8 | Enter to send | **Ctrl/Cmd+Enter everywhere**, Enter always newlines | Adopts O02; removes the pointer sniffing entirely. |
| 9 | Mobile details surface | **Bottom sheet below 821px**, right drawer above | Section 2.7 already said bottom; better thumb reach. |
| 10 | Selected conversation in URL | **Yes, `?customer=<id>`** | Adopts O04, and fixes browser Back on mobile (F24). |

## Work packages

### WP1 Correctness (P0)
1. Request sequencing in `MessagesClient`: monotonic `requestIdRef`; commit a thread response only when both the sequence and the customer id still match. Clear `messages`/`selectedCustomer` on every selection change.
2. Split `selectedCustomerId` from `openedCustomerId`. Mark read from the thread, once it is visible and loaded, never from selection.
3. Below 821px: no auto-selection at all. The list is the landing view.
4. `src/lib/messages/replyEligibility.ts`: pure function returning `{ canReply, reason, destination }` from customer + permissions. Used by the composer and unit tested.

### WP2 Permissions and consent (P1)
5. Gate the bulk link on `send_marketing`; rename to "Bulk message".
6. Gate Mark unread / Mark all read on `manage || send_transactional`; do not call `markConversationAsRead` at all without it (this was toasting an error on every open for view-only users).
7. Three consent states in `ContactPanel` and the thread header: Opted in / Opted out / Not recorded.
8. Composer blocked states: no permission, opted out, consent not recorded, no mobile number. Each with a named reason and a profile link (F21).

### WP3 Data honesty (P1)
9. `getInbox` returns `unreadIsCapped`; header renders "500+" and the toggle pill "500+".
10. Server-side conversation search action so search is not limited to the loaded page.
11. Label the list scope, and define filter intersection (F23): Unread AND channel AND search; channel matches any channel in the conversation; `feedback` excluded from the picker.

### WP4 Thread performance (P1)
12. `getCustomerTimeline(customerId, { limit, before })`: newest page first, explicit column list, `hasOlder` flag.
13. "Load older messages" control; polling only ever refreshes the newest page.
14. Polling: pause on hidden tab, no overlapping requests, exponential backoff after failures.

### WP5 Feedback and errors (P1)
15. Distinct send outcomes: sent, scheduled (with time), queued, suppressed duplicate, logging failure, error. Draft is kept on every non-success.
16. Inbox and thread error states with Retry; never show another customer's content.
17. Structured `logger` calls for inbox load, thread load, and send outcome categories (F29).

### WP6 Accessibility and input (P1)
18. Ctrl/Cmd+Enter to send; `isComposing` guard; hint text in the composer.
19. Conversation list as a `listbox`/`option` pattern with `aria-selected`, roving focus, and a visible focus ring.
20. Thread as `role="log"` with `aria-live="polite"`, per-message visually hidden "You said" / "<name> said" and a spoken timestamp.
21. Focus management: opening a thread on mobile moves focus to the thread heading; Back returns focus to the row; drawer close returns focus to the Details button.
22. Touch targets: `@media (pointer: coarse)` lifts inbox controls to 44px at every width (fixes the 821-1279 band).

### WP7 Content and journeys (P2)
23. Email content precedence: never repeat the subject as the body; HTML-only email renders a stripped-text fallback; attachments list filenames.
24. Per-customer drafts kept for the session; switching conversations no longer discards typed text.
25. "New messages" jump button when messages arrive while scrolled up; always reveal your own sent message.
26. Timestamps: "previous six calendar days" (matching the code), future timestamps show the clock time, invalid dates fall back safely.

### WP8 Layout and maintainability (P2)
27. Replace the hardcoded 62px with a `--spacing-page-shell-pad-y` token defined next to the shell tokens in `globals.css`.
28. Bottom sheet for the details surface below 821px.

### WP9 Spec and evidence
29. Rewrite the spec's status, change-type, behaviour-change list, decisions, and acceptance sections.
30. Record the environment (Node version, memory, commit) with the verification evidence.

### WP10 Tests
31. Unit: reply eligibility, timestamps, email content precedence, run grouping with mixed statuses.
32. Component: stale/out-of-order responses, rapid switching, mobile no-auto-read, view-only RBAC, blocked composer states, send outcomes, error + retry, drafts, capped counts, filter intersection.
33. Browser matrix executed and recorded at 375 / 820 / 821 / 1024 / 1279 / 1280, plus 200% zoom and keyboard-open.

## Out of scope, stated explicitly

- Email and WhatsApp **replies**. The inbox reads them; it replies by SMS only, and now says so.
- List virtualisation. Paging the thread is the fix; virtualisation only if paging proves insufficient.
- Playwright in CI. The repo runs Vitest; the browser matrix is executed manually and recorded.
- Changing `markConversationUnread`'s breadth.
