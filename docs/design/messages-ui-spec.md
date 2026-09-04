# /messages UI rebuild, spec

Status: implemented in the working tree; awaiting product sign-off on the ten
decisions in section 0 and a clean release commit (see section 8).
Date: 2026-09-03, revised 2026-09-04 after developer review
Review: `docs/design/messages-ui-spec-review.md` (31 findings, all addressed)
Plan: `tasks/messages-ui-review-plan.md`
Scope: `/messages` inbox only. `/messages/bulk`, `/messages/holding` and
`/messages/email-capture` are out of scope except for how the inbox links to them.

This release changes **no database schema and no server API contract**. It does
change client layout and a number of inbox behaviours, and it adds paging and a
search action to two existing server functions. Every observable change is listed
in section 4. It is not "presentation only": that earlier wording was wrong.

---

## 0. Decisions

Taken as documented defaults where the review raised an open question. Each can
be overruled; the code change is small in every case.

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Reply channel | **SMS only**, labelled and gated in the composer | The review's own "safest small scope". Email and WhatsApp replies need new send paths per channel and are not in this release. |
| 2 | Unread state ownership | **Shared team state** | That is what `messages.read_at` and `email_messages.staff_read_at` already are. Documented rather than pretended otherwise. |
| 3 | When does opening mark read | **Thread pane visible AND messages loaded AND the user may write read state** | Fixes the mobile auto-read without losing the convenience on the wide layouts. |
| 4 | New inbound in an open thread | **Left unread unless the reader is at the bottom of a visible thread** | Otherwise it drops out of the count having never been on screen. |
| 5 | Mark unread scope | **Keep the server's breadth, tell the truth in the UI** | The full-conversation restore is a deliberate prior fix (it is the exact inverse of mark-read). The bug was the silent optimistic "1". |
| 6 | Null `sms_opt_in` | **Fail closed; its own "Not recorded" state** | Matches `MessageService.sendReply`, which throws on null. Unknown consent is not consent. |
| 7 | Bulk link permission | **`messages.send_marketing`**, renamed "Bulk message" | Matches the destination page, which redirected everyone else to /unauthorized. |
| 8 | Enter to send | **Ctrl/Cmd+Enter on every device**; Enter always inserts a newline | Removes the pointer sniffing entirely. A hybrid laptop reports a fine pointer while someone types on a touch keyboard. |
| 9 | Mobile details surface | **Bottom sheet below 821px**, right drawer above | Thumb reach, and it settles the contradiction between the old sections 2.2 and 2.7. |
| 10 | Selected conversation | **In the URL as `?customer=<id>`** | Deep links, refresh recovery, and it makes the device Back button return to the list instead of leaving the page. |

---

## 1. What is wrong today

Measured against the real shell, not guessed. Key facts used throughout:

- `--breakpoint-shell: 821px`. Below it the app uses a 56px mobile topbar and a
  ~68px bottom tab bar, and the shell is `h-[100dvh] overflow-hidden` with
  `<main>` as the only scroller (padding `12px 16px 24px`).
- At and above 821px there is **no topbar at all**. The sidebar rail is 64px
  wide (it expands to 232px on hover, as an overlay). `<main>` padding is
  `22px 28px 40px`.
- `globals.css` forces `grid-template-columns: 1fr !important` on anything whose
  class list contains `md:grid-cols`, `lg:grid-cols` or `xl:grid-cols` when the
  viewport is 820px or narrower.
- Buttons are 25px (`sm`) / 31px (`md`) tall on desktop, and 34/42px with a
  44px floor below 821px.

### 1.1 The panel height is a magic number, and it is wrong on mobile

`Card className="h-[calc(100vh-12rem)] lg:h-[calc(100vh-14rem)]"`.

- `100vh` is the **large** viewport, so on a phone with browser chrome showing
  it over-measures by roughly 100px. `AppShell` deliberately uses `100dvh` for
  exactly this reason; the inbox opts back out of that fix.
- The 12rem/14rem allowance has to cover the topbar, `<main>`'s padding **and**
  the `PageHeader`. The header's height is not fixed: it carries up to five
  action buttons which wrap to three rows on a phone (~240px, not 192px).
- Net effect on a phone: the card is 150-250px taller than the space available,
  so `<main>` scrolls **and** the conversation list scrolls inside it, and the
  composer sits below the fold. That is the single worst symptom.
- On desktop the same arithmetic leaves ~70px of dead space under the card.

### 1.2 The three-column grid collapses the thread at common desktop widths

`lg:grid-cols-[320px_1fr_280px]` starts at 1024px.

| Viewport | Content width | Thread column |
|---|---|---|
| 1024 (iPad landscape, small laptop) | 902px | **302px** |
| 1280 | 1158px | 558px |
| 1440 | 1318px | 718px |

At 1024-1150px the message thread is narrower than the conversation list beside
it. Bubbles are capped at 70% of 302px, so a text message wraps at about 24
characters, and the thread header (avatar, name, three buttons) wraps onto three
rows.

### 1.3 The 768-1023px band gets no second column at all

The grid only splits at `lg` (1024px), but the app chrome switches to desktop at
821px. Every viewport from 821-1023px, iPad Pro 11" portrait included, gets a
single stacked pane **and** desktop-sized 25px buttons with no 44px touch floor.
It is the worst of both layouts.

### 1.4 The filter strip overflows and hides itself

`SectionNav` renders five tabs with counts (All, Unread, Email, SMS, WhatsApp)
inside a 320px column with 12px padding, so ~296px of room for ~396px of tabs.
`SectionNav` is `overflow-x-auto scrollbar-hide`, so two filters are simply
invisible with no affordance. `SectionNav` is also page-level chrome (36px dark
green tabs with a bottom border) being used as a panel control.

### 1.5 The composer textarea does not fill its row

`Textarea` renders its own `<div className="flex flex-col">` wrapper. The
composer puts `flex-1` on the `Textarea`'s `className`, which lands on the inner
`<textarea>`, not on the wrapper that is actually the flex item. The wrapper
shrinks to content, so the input is a default-width textarea instead of filling
the composer.

### 1.6 Inbound bubbles are nearly invisible

Inbound bubbles are `bg-surface-hover` (`#f5f5f4`) on a `bg-surface-2`
(`#fafaf9`) thread background. That is a 1.5% luminance difference; the bubble
shape is effectively lost.

### 1.7 Density and noise

- Every single message carries a channel `Badge` above it. In a thread that is
  99% SMS, that is one redundant pill per message.
- Every unread row carries a full-width `N unread` badge on its own line, adding
  ~24px per row and breaking the scan down the left edge.
- `formatDistanceToNow(..., { addSuffix: true })` produces "about 2 hours ago" in
  a column that has room for "2h".
- The composer permanently shows "0 characters, 0 SMS segments".
- The "Mark read" button is a no-op: opening a conversation already marks it read
  (`loadConversationMessages(..., { markAsRead: true })` on selection).
- "View profile" appears twice on screen at once (thread header and contact rail).

### 1.8 Contact details are desktop-only

The contact rail is `hidden lg:flex`. Below 1024px there is no way to see the
customer's phone number, email, or SMS opt-out state without navigating away
from the inbox and losing the thread.

### 1.9 The thread opens at the oldest message on a phone

A conversation is auto-selected on load, so its messages arrive while the thread
pane is still `display: none` behind the list. The auto-scroll effect ran against
a zero-height element, did nothing, and set its "already scrolled" flag anyway.
Tapping into the conversation then showed the **top** of the thread. On a long
history the newest message, the one the customer is waiting on, was several
screens down.

Found by driving the page in a browser at 375px, not by reading the code.

### 1.10 Conversation rows never truncated, so the list overflowed sideways

`truncate` needs an unbroken `min-width: 0` chain. The row had `min-w-0` on the
outer wrapper but not on the two inner flex rows, so a `white-space: nowrap`
child kept its full text width as a minimum. The grid's single `1fr` track is
`minmax(auto, 1fr)`, and that auto minimum is the content's min-content size, so
the track resolved to **810px inside a 343px card** at 375px. Measured, not
guessed:

```
card:  width 343  scrollWidth 811
grid:  width 341  scrollWidth 811   grid-template-columns: 810.656px
row:   width 810
```

### 1.12 Correctness defects found by the developer review

These are the ones that could cost a customer, and they were all confirmed
against the code before being fixed.

**A slow response could put one customer's history under another's name.**
`loadConversationMessages` wrote every successful response straight into shared
state with no request identity, and selection did not clear the previous
customer. A slow load for A landing after B is selected showed A's messages,
A's contact details and A's phone number under B's heading, with a composer that
would text B.

**A phone marked conversations read that nobody had opened.** The first unread
conversation was auto-selected as soon as the list loaded, and the selection
effect immediately called `markConversationAsRead`, on one pane too, where the
thread is hidden behind the list. Unread work disappeared before anyone saw it.

**A mixed-channel thread always replied by SMS.** The inbox renders SMS,
WhatsApp, email and feedback in one timeline, and the composer called
`sendSmsReply` regardless. Nothing on screen said so.

**The bulk link used the wrong permission.** The button was gated on
`send_transactional || manage`; `/messages/bulk` requires `send_marketing`.
Users with one and not the other either hit /unauthorized or never saw the link.

**Read-state controls were shown to users who cannot use them.** `/messages`
needs only `messages.view`, but every read-state write is gated on
`manage || send_transactional`. A view-only user got a failure toast on *every*
conversation they opened.

**Unknown SMS consent was treated as consent.** `sms_opt_in` is nullable. The
UI treated everything except `false` as replyable and the contact panel printed
null as "Opted in", while the server rejects null outright.

**"Message sent" was said for messages that had not been sent.** Quiet hours
defer a reply to the job queue and return `success: true, status: 'scheduled'`.
So does a send whose audit-log write failed. Both were reported as sent.

**The unread total was presented as exact when it was capped.** `totalUnread`
sums the fetched rows only, and the unread query stops at 500.

**Search could not find an older conversation.** Filtering happened in the
browser over a page of the most recent 250 *communications*, not conversations.
One chatty customer could consume most of that window.

**The whole timeline was re-fetched every 30 seconds.** `getCustomerTimeline`
did `select('*')` with no limit, pulling `body_html`, `delivery_history`,
`engagement` and `context` that the thread never renders.

**A failed load looked like an empty inbox.** The skeleton ended, a toast
appeared and went, and "No conversations" was left on screen.

### 1.11 Smaller correctness points

- `getMessageTime` formats with the **browser's** timezone while the date
  separators above it are computed in Europe/London. A staff member outside the
  UK sees times that disagree with the day headings.
- Enter sends the message on touch devices, where Enter should insert a newline.
- SMS opt-out hides the composer with a one-line note below the fold, rather than
  replacing it.

---

## 2. Target design

### 2.1 Height model: stop guessing, measure with flexbox

The page becomes a single flex column that owns the viewport, with `PageHeader`
as a `shrink-0` row and the inbox as `flex-1 min-h-0`. The inbox then adapts to
whatever height the header happens to take, so wrapping action buttons can never
push the composer off-screen again.

```
<div class="flex h-full flex-col overflow-hidden shell:h-[calc(100dvh-62px)]">
  PageHeader        shrink-0
  Alert (optional)  shrink-0
  Card              flex-1 min-h-0
</div>
```

- **Below 821px**: `h-full` is exact and needs no constant. `<main>` is
  `flex-1` inside a `h-[100dvh]` flex column, so its height is already definite
  and its padding is inside its own content box.
- **821px and above**: one documented constant, `62px` = `<main>`'s `22px` top +
  `40px` bottom padding from `AppShell`. `100dvh`, never `100vh`.

If that constant ever drifts, the failure mode is a few pixels of page scroll,
not a composer below the fold.

### 2.2 Responsive layout

| Band | Layout |
|---|---|
| `< 821px` | One pane at a time. List, tap a row, thread replaces it, back button returns. Contact details via the drawer, which is full width at this size. |
| `821px - 1279px` | Two panes: list `300px` + thread `1fr`. Contact details via a 380px right drawer, opened from a "Details" button. |
| `>= 1280px` (`xl`) | Three panes: list `320px` + thread `1fr` + contact rail `300px`. |

Moving the split from `lg` (1024px) to the shell breakpoint (821px) fixes iPad
portrait. Moving the third column from `lg` to `xl` guarantees the thread is
never narrower than 538px when the rail is showing.

Grid classes use the `shell:` and `xl:` variants. They deliberately avoid the
string `lg:grid-cols`, which `globals.css` overrides to `1fr !important` below
821px.

### 2.3 Page header

Reduced from five buttons to at most three controls:

- `New message` (primary, → `/messages/bulk`), permission-gated as today.
- `Holding queue (N)` (secondary), only when `N > 0`.
- Overflow `⋮` menu: Refresh, Mark all read, Message templates.

Subtitle keeps the unread summary. Auto-refresh runs every 30s regardless, so
manual Refresh belongs in the overflow.

### 2.4 Conversation list

Header block, in order:

1. `SearchInput`, full width.
2. One row: an `Unread (N)` toggle pill on the left, a channel `<Select>` on the
   right (All channels / SMS / WhatsApp / Email). Replaces `SectionNav` entirely.
   Both fit a 300px column on one 44px row.

Rows:

- 2px primary accent bar plus `bg-primary-soft` when selected, so the selection
  is legible at a glance.
- Unread state is a bold name plus a small count pill sitting under the
  timestamp on the right, not a badge on its own line. Row height drops from
  ~86px to ~66px, so roughly 30% more conversations fit on a phone screen.
- Timestamps are compact and London-based: `now`, `5m`, `2:45pm` (today),
  `Yesterday`, `Mon` (this week), `12 Aug` (older).
- Preview line is prefixed `You: ` when the last message was outbound, so staff
  can see at a glance whether a customer is still waiting on a reply.
- Channel shown as a leading label only when the conversation is not SMS.
- Loading shows six skeleton rows rather than a full-panel spinner, so the panel
  does not jump when data lands.

### 2.5 Thread

- Header: back (icon, `< 821px`), avatar, customer name linking to the profile,
  and a status line. Actions collapse into `Details` (below `xl`), `Profile`,
  and an overflow with `Mark unread`. `Mark read` is removed: it was a no-op.
- Consecutive messages from the same side and the same channel are grouped: the
  timestamp and status line render once per run, not once per bubble.
- The channel label renders only when it changes within a run, so a pure SMS
  thread shows no channel chrome at all.
- Inbound bubble: `bg-surface` with a `border-border` outline on a `bg-surface-2`
  thread. Outbound: `bg-primary` / `text-primary-fg`, unchanged.
- A failed message is never grouped with its neighbours. It keeps the existing
  always-visible treatment plus a danger ring on the bubble, and its own status
  line. Grouping it with the resend that followed would have stamped
  "Not delivered" across a message that did reach the customer, which is worse
  than the bug it replaced.
- Date separators scroll with the thread. Sticky was tried and reverted: an
  opaque pill pinned to the top of the scroller sat over the first bubble of the
  group and clipped its text.
- Only the last bubble of a run gets the pointed tail corner.
- Bubble width: `max-w-[85%]`, `sm:max-w-[78%]`, `xl:max-w-[68%]`.

### 2.6 Composer

- Textarea wrapped in a `flex-1 min-w-0` element so it actually fills the row,
  and auto-grows from 1 to 6 rows.
- `Enter` sends only on a fine pointer (`matchMedia('(pointer: fine)')`). On
  touch, `Enter` inserts a newline and the Send button is the only send path.
- The character/segment line appears only once there is text, and turns into a
  warning tone at 3+ segments.
- SMS opt-out **replaces** the composer with an inline notice and a link to the
  profile, instead of silently removing it.

### 2.7 Contact panel

Same component in all three placements (inline rail at `xl`, right drawer at
821-1279px, bottom drawer below 821px). Contents:

- Avatar, name, and the customer's channels.
- Phone as a `tel:` link and email as a `mailto:` link, so an iPad user can dial
  from the inbox.
- SMS opt-in and WhatsApp status as tone-coded badges.
- Last activity time.
- `View full profile`.

### 2.8 Truncation and overflow discipline

Every flex row in a conversation row carries `min-w-0`, and all three grid
columns carry `min-w-0`. The column rule is the important one: it removes a grid
item's automatic minimum size, so no amount of unbreakable content can widen a
track. It also survives the `grid-template-columns: 1fr !important` that
`globals.css` applies below 821px, which a `minmax(0, 1fr)` track definition
cannot.

### 2.9 Thread scroll position

The thread opens on the newest message every time it is shown. A scroller with
`clientHeight === 0` is treated as hidden: instead of scrolling it and marking
the job done, the jump is re-armed for the next time the pane appears. `showBack`
is a dependency of that effect, so revealing the thread on a phone re-runs it.

### 2.10 Timezone

All message times are formatted with `timeZone: 'Europe/London'` and
`hourCycle: 'h12'`, matching the London date separators. (`hour12: true` renders
noon as "0pm" under `en-GB` on Node 20, so `hourCycle` is mandatory.)

---

## 3. Correctness rules

### 3.1 One customer on screen at a time

Every thread request carries a monotonic id. A response is committed only if
both its id is still the newest **and** its customer is still the selected one.
Changing selection clears `messages`, `selectedCustomer`, the error and the
"has older" flag before the new request starts, so a stale or failed load can
never leave another customer's content visible.

### 3.2 Selected is not the same as opened

`?customer=<id>` holds the selection. Below 821px the thread only exists when
that parameter is set, which is only after the user taps a row, so "opened"
follows from the layout rather than being tracked separately. Auto-selection
runs on the wide layouts only, and uses `replace` so it never fills the history.

Mark-read requires all of: a selected customer, a visible thread, loaded
messages, no thread error, and `manage || send_transactional`.

### 3.3 Reply eligibility

`src/lib/messages/replyEligibility.ts` is the single rule, used by the composer
and unit tested. It returns either `{ canReply: true, destination }` or a block
with a named reason and staff-facing copy:

| Reason | Condition |
|---|---|
| `no_permission` | user lacks `send_transactional` and `manage` |
| `opted_out` | `sms_opt_in === false` |
| `consent_unknown` | `sms_opt_in` is null or undefined |
| `no_mobile_number` | no non-blank `mobile_number` |

Blocked states replace the composer with the reason and a link to the profile.
The composer, when enabled, says "Replies send by SMS to <number>" and carries
an accessible name naming the destination.

### 3.4 Send outcomes

`src/lib/messages/sendOutcome.ts` maps the service result to one message and one
rule about the draft:

| Outcome | Shown as | Draft |
|---|---|---|
| sent or queued | "Message sent" (success) | cleared |
| deferred by quiet hours | "Scheduled, not sent yet. Quiet hours are on, so this goes out <time>." (warning) | cleared |
| audit log write failed | "Sent, but it could not be recorded against the customer. Tell a manager." (warning) | cleared |
| suppressed duplicate | "Not sent: identical to a recent message..." (error) | **kept** |
| any error | the server's own message (error) | **kept** |

`MessageService.sendReply` now forwards `deferred` and `scheduledFor`, which it
previously dropped.

### 3.5 Read-state scope, stated plainly

- Read state is **shared across the team**, not per staff member.
- Opening a conversation marks every inbound message in it read.
- "Mark whole conversation unread" is the exact inverse: it restores every
  previously read inbound message. The menu label says so, and the UI no longer
  shows an optimistic "1" that the reload then contradicted.
- "Mark all read" clears every unread inbound message in the database, including
  conversations not on screen. It is behind a confirmation that says this.

### 3.6 Data honesty

- `getInbox` returns `unreadIsCapped`. When true the header and the filter pill
  render "500+", and a banner says the number is a lower bound.
- The list footer states that it is a recent window and that search reaches
  older conversations.
- Search runs server-side (`searchConversations`), resolving customers by name,
  phone or email first, so a conversation outside the recent page is findable. A
  matching customer who has never been messaged still appears.
- Filters intersect: Unread AND channel AND search. Channel matches any channel
  the conversation has used, not only its latest message. `feedback` is not
  offered, because it cannot be replied to.
- Sort is unread-first, then most recent. Auto-selection picks the first unread,
  else the first row.

### 3.7 Thread performance

- `getCustomerTimeline(customerId, { limit, before })` returns the newest 60
  messages with an explicit column list, plus `hasOlder`. `before` pages
  backwards behind a "Load older messages" control.
- Polling refreshes the newest page only.
- Polling pauses entirely while the tab is hidden, catches up on becoming
  visible, never overlaps itself, and backs off from 30s to a 5 minute ceiling
  after consecutive failures.

### 3.8 Accessibility

- The list is a `listbox` of `option`s with `aria-selected` and a roving tab
  stop; Up, Down, Home and End move between rows, Enter and Space open one.
- Each row's accessible name carries who, unread count, when, and the preview,
  because visually those are weight and colour.
- The thread is `role="log"` with `aria-live="polite"`, labelled with the
  customer's name. Each bubble carries a visually hidden "You said" or
  "<name> said" plus the time, since direction is otherwise only alignment and
  colour.
- Opening a thread on one pane moves focus to the thread heading; Back returns
  to the list.
- `@media (pointer: coarse)` lifts every control inside `[data-touch-targets]`
  to 44px at any width, which is what the 821-1279px band needed. It asks
  whether the primary input is a finger rather than inferring it from width.

### 3.9 Message content

- Body precedence is `body_text`, then stripped `body_html`, then a stated
  placeholder. The subject is a heading and is never repeated as the body.
- An HTML-only email renders readable text rather than an empty bubble.
- Attachments list their filenames.
- A run breaks on a change of side, channel **or status**, and a failed message
  is always alone in its run.
- Unparseable timestamps group under "Date unknown" rather than "Invalid Date".

## 4. Behaviour changes, in full

For QA, training and release notes. Everything a user can observe:

1. Selection is in the URL; browser Back closes a thread on a phone.
2. No auto-selection below 821px; the list is the landing view.
3. Marking read waits for the thread to be visible and loaded.
4. "Mark read" is gone. It was a no-op: opening already marks read.
5. "Mark unread" is renamed "Mark whole conversation unread" and is hidden from
   users who cannot write read state.
6. "Mark all read" now asks for confirmation and is similarly hidden.
7. "New Message" is renamed "Bulk message" and gated on `send_marketing`.
8. Refresh, Mark all read and Templates moved into an overflow menu; the holding
   queue joins them below 821px.
9. The composer states it sends SMS and to which number, and is replaced by a
   named reason when it cannot send.
10. Ctrl/Cmd+Enter sends; Enter inserts a newline everywhere.
11. Send feedback distinguishes sent, scheduled, unlogged, suppressed and failed;
    the draft survives everything except a real handover.
12. Drafts are kept per customer for the session.
13. Search is server-side, needs two characters, and covers email as well as name
    and phone.
14. Filters are an Unread toggle plus a channel select, replacing the five-tab
    strip. `feedback` is no longer a filter.
15. Unread counts show "500+" when capped.
16. Threads load the newest 60 messages with a "Load older messages" control.
17. A "N new messages" jump button appears if messages arrive while scrolled up.
18. Contact details are reachable below 1280px: bottom sheet on a phone, right
    drawer on a tablet. Phone and email are tap-to-call and tap-to-email.
19. Timestamps are compact and London-based; delivery status is per run.
20. Inbox and thread failures show an error with Retry instead of an empty state.
21. Polling stops while the tab is hidden.

## 5. Files

| File | Change |
|---|---|
| `messages/page.tsx` | Suspense boundary for `useSearchParams` |
| `messages/_components/MessagesClient.tsx` | Rewritten: data, state, URL, polling, layout |
| `messages/_components/ConversationList.tsx` | New: listbox, filters, error state, capped counts |
| `messages/_components/ConversationThread.tsx` | New: log semantics, runs, paging, composer states |
| `messages/_components/ContactPanel.tsx` | New: three consent states, tel/mailto links |
| `messages/_components/messagesFormat.ts` | New: names, previews, timestamps, body precedence, attachments |
| `lib/messages/replyEligibility.ts` | New: the single reply rule |
| `lib/messages/sendOutcome.ts` | New: send result to staff-facing outcome |
| `services/communications.ts` | Paged timeline, server search, `unreadIsCapped` |
| `services/messages.ts` | Forward `deferred` and `scheduledFor` |
| `actions/messagesActions.ts` | Timeline options, `searchConversations`, capped flag |
| `ds/icons/paths.tsx` | Added a `refresh` icon |
| `app/globals.css` | `--spacing-page-shell-pad-y`, `pointer: coarse` targets |
| `vitest.setup.ts` | `ResizeObserver` stub for jsdom |
| tests | 3 new unit files, component tests rewritten to 32 cases |

## 6. Verification

Environment recorded, because the build is memory-sensitive:

- Node **20.19.5** (as pinned in `.nvmrc`), `NODE_OPTIONS=--max-old-space-size=8192`
- macOS 25.4.0, Chromium via the in-app browser pane
- Fixture: a ten-conversation harness covering long names, a WhatsApp thread, an
  HTML-only email with an attachment, a failed send followed by a resend, and
  all three blocked-composer states. The harness is deleted; it is not shipped.

Automated: `npm run lint` clean, `npx tsc --noEmit` clean, `npx vitest run`
**715 files / 6110 tests** passing, `npm run build` successful.

Browser, measured in the DOM rather than eyeballed. No vertical page scroll and
no horizontal scroll at any width, and the composer is on screen at every one:

Every figure below is `getBoundingClientRect()` on the live grid columns, not an
estimate.

| Viewport | Columns | Thread width | Before the rebuild |
|---|---|---|---|
| 375 | 1 pane at a time, 341 | 341 | overflowed to 810px inside a 343px card |
| 640 x 400 (200% zoom) | 1 pane, 606; card held at its 360px floor and the page scrolls | 606 | compressed to a header row |
| 820 | 1 pane at a time, 786 | 786 | 786, but no second column |
| 821 | 300 + 399 | 399 | single stacked pane |
| 1024 | 300 + 602 | 602 | **302** |
| 1279 | 300 + 857 | 857 | single stacked pane below 1024; 302 at 1024 |
| 1280 | 320 + 538 + 300 | 538 | 558 |
| 1440 | 320 + 698 + 300 | 698 | 718 |
| 1600 | 320 + 858 + 300 | 858 | 878 |

The 640 x 400 row is the only one that scrolls, and that is deliberate: below
roughly 500px of usable height the inbox holds a 360px floor and the page
scrolls, rather than the inbox collapsing to a header row.

Also exercised by hand and confirmed:

- Repeated open and close landing on the newest message every time (scroll gap 0
  on three consecutive opens).
- All three blocked-composer states render the right reason and a profile link.
- Zero controls under 44px on a coarse pointer, and the `pointer: coarse` rule
  confirmed present in the compiled CSS.
- Roving keyboard focus: one tab stop, Arrow and End move between rows.
- Bottom sheet below 821px, right drawer above.
- Composer placeholder no longer clips at 375px (the number moved to the helper
  line, which is also what the screen reader announces).

## 7. Out of scope, stated explicitly

- **Email and WhatsApp replies.** The inbox reads them; it replies by SMS only,
  and now says so on screen.
- List virtualisation. Paging the thread is the fix; virtualisation only if
  paging proves insufficient.
- Playwright in CI. The repo runs Vitest; the browser matrix above was executed
  manually and its measurements recorded.
- Changing how broadly "Mark whole conversation unread" restores messages.
- Attachment download. Filenames are listed; opening them is not built here.

## 8. Before release

Still owner or reviewer work, not code:

1. Sign off the ten decisions in section 0, especially SMS-only replies and the
   shared read-state model.
2. Create a clean commit or PR containing only the files in section 5.
3. Run CI on Node 20 and link the run here.
4. Smoke test on production data: open an inbox with a real 500+ unread count,
   a customer with a long thread, and one with no mobile number.
5. Rollback is a straight revert; there is no migration to undo.
