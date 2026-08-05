# Developer review: guest pages redesign specification

Date: 2026-08-05  
Reviewed document: `tasks/guest-pages-redesign-spec-2026-08-05.md`  
Design handoff: `design_handoff_guest_pages/README.md`, prototype HTML and bundled tokens  
Code snapshot: `569625aa308c9d12d86986724d0d3cebecfea8c0`  
Audience: developer and delivery owner  
Review outcome: **not ready to build without corrections**

The original specification was not changed.

## 1. Executive summary

The specification does good repository discovery. Its Tailwind v4 correction, token namespacing,
separate shell for the two excluded legacy pages, use of `next/font`, and phased delivery direction are
sound. However, several statements do not match the current code, and important security,
accessibility, payment-state and delivery requirements are missing.

The main blockers are:

1. The specified primary button colour, white on `#a57626`, has about **4.02:1** contrast. It fails the
   WCAG AA requirement of 4.5:1 for the specified normal-size button text.
2. The public parking page loads a booking by raw ID with an admin client and displays `booking.notes`.
   The staff UI labels the same field **Internal notes**. This needs removing from the public projection
   and a security decision on the ID-only access model.
3. `/error` is primarily an authentication, password-reset and onboarding error route. Treating its
   “Back to Dashboard” action as a guest bug is based on the wrong audience assumption.
4. Adding a same-origin `/privacy` footer link to bearer-token pages can send the full token URL in the
   `Referer` header under the current `strict-origin-when-cross-origin` policy.
5. The scope is internally inconsistent. `parking/not-found.tsx` is a Next.js not-found boundary, not a
   `/parking/not-found` route. The document alternates between 14 and 15 routes and understates the
   changed-file count.
6. The state and test plans omit several real PayPal, expired-hold, setup-failure, loading, manual-review
   and degraded-data states. The existing UI test inventory is also described incorrectly.
7. The component plan has no badge primitive even though badges are required throughout and the chosen
   implementation deliberately does not import `.anchor-badge` styles.
8. The proposed font variable names collide with the proposed Tailwind theme names, and loading all
   brand fonts in the root layout would add them to staff pages that do not use them.

The safest delivery is to correct the scope and component contracts first, resolve the parking and
`/error` decisions, approve an accessible CTA colour, add a complete route-state-test matrix, then build
the phases with monitoring and rollback gates.

### Verified strengths and non-issues

- The Tailwind v4 CSS-first correction is right; a new `tailwind.config` is not needed.
- Namespaced guest colour utilities are the right direction, provided element and focus selectors are also
  scoped as described in F10.
- `lucide-react` is already installed, so no new icon dependency is needed.
- A separate `GuestShell` is safer than replacing the legacy shell used by excluded routes.
- No schema or data migration is required for the visual change itself. The material migration work is the
  controlled component/CSS cutover and its rollback evidence.
- Keeping existing route handlers, server actions and PayPal provider controls is appropriate.

## 2. Classification used

- **Status - Confirmed issue:** verified conflict, gap or unsafe requirement.
- **Status - Required decision:** an assumption that changes scope, architecture or acceptance criteria.
- **Status - Optional improvement:** useful but not required for a safe first release.
- **P0:** release blocker or material security, privacy, money or accessibility risk.
- **P1:** must be resolved before the affected phase is implemented or merged.
- **P2:** should be resolved before release.
- **P3:** useful follow-up.

## 3. Findings

### F01 - Scope and route count are inconsistent

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Scope / Delivery
- **Relevant section:** Scope; F3; F4; Phased delivery
- **Description:** The scope starts with 14 routes, F4 changes this to 15, and Phase 4 repeats 15.
  `src/app/parking/not-found.tsx` is a Next.js segment-level not-found boundary. It is rendered with a
  404 response at the requested parking URL; it does not create a normal `/parking/not-found` route.
  `GuestBlockedState` is said to serve seven routes, but adding the parking boundary changes the number
  of consuming surfaces.
- **Rationale:** Route count, render-state count and file count are different measures and are currently
  mixed together.
- **Impact:** Tickets, fixture URLs, test cases, estimates and completion reporting will disagree.
- **Recommended action:** Add one authoritative scope table with columns for route pattern, special
  boundary/state, files, audience, phase and in/out status. Describe the result as 14 route entries plus
  one parking not-found boundary unless `/error` is removed after F02.
- **Open questions:** Does the owner approve adding the parking not-found boundary? Is `/error` still in
  scope after its real audience is confirmed?

### F02 - `/error` is misclassified as a guest page

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / Scope
- **Relevant section:** F5; Phase 4; Owner decision 2
- **Description:** All named `FRIENDLY_MESSAGES` in `src/app/error/page.tsx` concern password reset or
  rate limiting. The route is reached from `src/app/auth/confirm/route.ts` and from onboarding throttling
  in `src/middleware.ts`. “Back to Dashboard” is therefore valid for much of its actual audience, not a
  confirmed guest bug.
- **Rationale:** A shared auth/onboarding error surface needs actions based on the failed journey. Replacing
  its action with the pub website would make staff recovery worse.
- **Impact:** Phase 4 can ship the wrong recovery action and an inappropriate guest footer to staff or job
  candidates.
- **Recommended action:** Either exclude `/error` from this guest redesign, or make the error model carry an
  audience and recovery target and render the correct shell/action per source. Remove the current owner
  recommendation until that decision is made.
- **Open questions:** Should password-reset errors return to login, dashboard or request-reset? Should
  onboarding rate limits use their own error page?

### F03 - Public parking exposes internal notes and uses ID-only access

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Security / Privacy / Data
- **Relevant section:** Scope; Phase 4; parking screen requirements
- **Description:** `src/app/parking/guest/[id]/page.tsx` is public in middleware, queries
  `parking_bookings` with the admin client using `.select('*').eq('id', id)`, and passes the row to the
  public renderer. The renderer shows `booking.notes`. The authenticated parking form labels that exact
  field “Internal notes”. The URL uses the booking ID directly rather than a signed, expiring guest token.
- **Rationale:** Internal notes can contain operational or personal information never intended for a guest.
  An unexpired booking ID acts as a long-lived bearer credential.
- **Impact:** Confidential staff notes and booking details could be disclosed to anyone who obtains an ID.
- **Recommended action:** Before visual work, replace `select('*')` with a public allow-list and remove
  `notes` unless a separate guest-visible field is created. Complete a threat review of the ID link and
  prefer a signed, expiring token with rate limiting and revocation. If this cannot fit the redesign,
  create and complete a blocking security remediation ticket.
- **Open questions:** Has any internal note already been exposed? Are parking IDs random UUIDs? How long do
  links remain valid, and can staff revoke them?

### F04 - The preserved cancellation GET link performs a destructive action

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Security / HTTP semantics
- **Relevant section:** Verification item 5; table-manage cancel requirements
- **Description:** The specification requires keeping a GET link that cancels a booking. `rel="nofollow"`
  is advisory and does not stop link scanners, crawlers, browser tooling or accidental navigation from
  following it.
- **Rationale:** GET is expected to be safe and idempotent. It should not change booking state.
- **Impact:** A booking can be cancelled without an intentional form submission, especially when token URLs
  are handled by automated security scanners.
- **Recommended action:** Change the fallback GET to open a non-sandboxed confirmation page and perform the
  actual cancellation only by POST. If behaviour truly cannot change in this project, require explicit
  security sign-off, audit logging, `no-store`, one-time confirmation protection and a test proving no
  framework prefetch is used.
- **Open questions:** Which embedded clients lack `allow-forms`? Can the fallback open a top-level tab or
  window where a normal POST works?

### F05 - The primary CTA palette fails WCAG AA contrast

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Accessibility / Visual design
- **Relevant section:** Component plan - `GuestButton`; Verification item 4
- **Description:** White text on the required gold fill `#a57626` is about 4.02:1. The specified 14px,
  16px and 18px semibold labels are not safely classed as large text and require 4.5:1. The generic design
  token's charcoal-on-gold option is also only about 4.33:1.
- **Rationale:** The accessibility pass cannot approve a palette that fails by design.
- **Impact:** Every primary action can fail WCAG 2.1/2.2 AA and automated audits.
- **Recommended action:** Obtain design approval for a compliant combination. Using white on
  `#8b6914` is about 5.09:1; another option is a newly approved darker fill. Record contrast values for
  default, hover, disabled and focus states.
- **Open questions:** May `#8b6914` become the default CTA fill? If not, which brand-approved colour pair is
  authoritative?

### F06 - “Styling only” conflicts with required copy and interaction changes

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Scope / Content
- **Relevant section:** Scope; Token and font foundation; Component plan; screen requirements
- **Description:** The specification says no copy changes, but it adds kickers, a shared address/footer,
  trust lines, badge labels, feedback script lines, new call buttons, new secondary actions and changed
  payment button wording. Some of these also change link destinations or component props.
- **Rationale:** Developers cannot tell which new strings are approved presentation copy and which are
  prohibited product-copy changes.
- **Impact:** Reviewers may reject correct work as out of scope, or unapproved copy may reach production.
- **Recommended action:** List every approved new or changed string and destination. State that existing
  business, legal and error copy remains unchanged except for that approved list.
- **Open questions:** Are the footer, trust line, feedback scripts, call CTAs and amount-bearing PayPal CTA all
  owner-approved? Is the `/error` action allowed to change?

### F07 - The badge primitive required by the screens is missing

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Technical / Component design
- **Relevant section:** F2; Component plan; table-manage, booking-portal and parking screens
- **Description:** Many screens require success, outstanding, danger and outline badges, but the ten-component
  plan has no `GuestBadge`. The specification also rejects importing the handoff stylesheet, so classes such
  as `.anchor-badge` will not exist.
- **Rationale:** Badge rules include colour, dot, radius, spacing and status mappings and should not be copied
  into every route.
- **Impact:** Implementations will either fail to compile/style, duplicate utilities or import the forbidden
  global CSS.
- **Recommended action:** Add `GuestBadge` with named variants and a documented status-to-variant mapping.
  Include its contrast and screen-reader treatment in tests.
- **Open questions:** Should unknown statuses use `outline` and retain their humanised text? Should the dot be
  decorative or carry a hidden status label?

### F08 - The font variable plan contains a CSS variable collision

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Technical / Tailwind
- **Relevant section:** F6; Token and font foundation
- **Description:** The document tells `next/font` to expose `--font-anchor-display`,
  `--font-anchor-body` and `--font-anchor-script`, and also tells the Tailwind `@theme` block to define the
  same names. A theme alias cannot safely reference itself.
- **Rationale:** The runtime font variable and Tailwind theme token need different names.
- **Impact:** Font utilities may resolve to invalid or overridden variables, causing fallback fonts and visual
  mismatch.
- **Recommended action:** Use distinct runtime variables, for example `--font-dm-serif-runtime`, then map
  `--font-anchor-display: var(--font-dm-serif-runtime)` in `@theme`. Do the same for Outfit and Clicker Script.
- **Open questions:** Will font families be applied through Tailwind utilities, a scoped guest class, or both?

### F09 - Brand fonts are loaded globally without a performance budget

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Performance / Architecture
- **Relevant section:** F6; Token and font foundation; Risks
- **Description:** Adding three families and several weights to the root layout can preload them on the
  authenticated staff app as well as guest pages. Clicker Script is used on only two feedback screens. These
  pages are explicitly expected to work on weak mobile signal, but no transfer-size, LCP or CLS budget is set.
- **Rationale:** Route-scoped `next/font` imports can avoid unused font downloads while keeping self-hosted
  output and no layout shift.
- **Impact:** Slower first render on both staff and guest routes, with no acceptance threshold to catch it.
- **Recommended action:** Define fonts in a guest-only module and apply their variables from `GuestShell`.
  Load Clicker Script only in the feedback routes if practical. Compare built route assets and measure LCP/CLS
  on a throttled mobile profile before and after each phase.
- **Open questions:** What is the maximum added font transfer size? Is exact script-font fidelity worth a
  route-wide download on non-feedback pages?

### F10 - Global focus and motion rules can leak into the staff app

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Accessibility / CSS isolation
- **Relevant section:** F2; Component plan - Focus, checkboxes, motion
- **Description:** The handoff presents a global `:focus-visible` rule, while the specification promises
  namespacing and zero staff-app blast radius. Adding that selector to `globals.css` would change focus radius,
  colour and outline on every authenticated control. Reduced-motion hover overrides have the same scoping risk.
- **Rationale:** Namespaced colour tokens alone do not scope element selectors.
- **Impact:** Phase 1 can visually regress unrelated staff pages and make existing component focus tests
  unreliable.
- **Recommended action:** Put a stable class such as `.guest-theme` on `GuestShell` and scope guest element,
  focus and reduced-motion rules beneath it, or keep all states in the guest primitives. Add a staff-page
  before/after visual check.
- **Open questions:** Are any guest controls rendered outside `GuestShell`? Should privacy and any retained
  auth error page use the same scope class?

### F11 - The table-payment client cannot produce the specified whole-page success state as structured

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Technical / State management
- **Relevant section:** table-payment screen; Component plan; “logic untouched” requirement
- **Description:** The server page owns the “Complete your deposit payment” h1 and greeting. The client owns
  `paymentState`. When client capture succeeds it can currently replace only its inner panel, not the outer h1,
  lead, card and action required by the handoff.
- **Rationale:** Styling class changes alone cannot make client state replace server-owned page chrome.
- **Impact:** The implementation either misses the design or performs an unplanned component/state refactor.
- **Recommended action:** Specify the boundary. A practical option is a client-safe presentation component
  that receives both idle and success content and owns the page body below `GuestShell`, while all payment
  server actions remain unchanged. Add a regression test for server-completed and client-completed success.
- **Open questions:** On capture success, should the page update immediately in place or refresh to the
  server-confirmed state? Which copy is authoritative for each path?

### F12 - The real route and PayPal state matrix is incomplete

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Error handling / Integration
- **Relevant section:** Verification items 3 and 5; all payment screens
- **Description:** The verification list covers only a subset of real states. Missing examples include table
  hold expiry, PayPal order-create failure, order-ID persistence failure, table client error/retry, event
  `creating`, missing client ID, `manual_review`, event fallback refresh, booking-portal capture
  `capturing/success/error`, fresh-link loading/error, and the parking refunded/expired/retry variants.
- **Rationale:** These branches already exist in code and several are money or reconciliation states.
- **Impact:** A phase can pass the stated checks while leaving common or high-risk branches unstyled, broken or
  misleading.
- **Recommended action:** Add a route-state matrix containing trigger, source branch, expected heading, alert
  tone/role, actions, fixture and automated/manual test owner. Include degraded dependencies and invalid
  environment configuration.
- **Open questions:** Which payment states require a full success screen versus an in-place alert? What must a
  guest do after `manual_review` or a capture that succeeded remotely but failed locally?

### F13 - Booking-portal PayPal requirements do not match the current component contract

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Integration / Content / Technical
- **Relevant section:** booking-portal screen; Phase 3
- **Description:** The design asks for “Pay deposit of £250.00”, but `FreshPayPalLinkClient` receives no amount
  and currently says “Pay deposit via PayPal”. The portal does not embed PayPal buttons; it creates an order
  and redirects to an approval URL. Its processing and error panels are not mapped to the new primitives.
- **Rationale:** This is more than styling. It changes props, copy and possibly where the trust line appears.
- **Impact:** The developer must guess whether to alter the API, hard-code a value, retain existing copy or
  misrepresent the redirect flow.
- **Recommended action:** Decide and document the exact CTA copy. If the amount is included, pass a formatted
  display amount from the verified server row and test it. Map fresh-link and capture states explicitly without
  changing order creation, redirect or `autoStart` behaviour.
- **Open questions:** Should the CTA include the amount? Should the trust line appear before redirect and during
  auto-start? What should remain visible while a fresh link is being created?

### F14 - Shared component contracts are not implementable enough

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Technical / Accessibility
- **Relevant section:** Component plan
- **Description:** The plan gives visual variants but not React contracts. `GuestButton` must support native
  buttons, submit buttons, external anchors, `next/link`, disabled/loading states and full-width overrides
  without nesting interactive elements. `GuestAlert` needs explicit `role`, live-region and title/body props.
  `GuestField` must support input/select/textarea IDs, errors and `aria-describedby`. The shell says padding is
  overridable but does not name the prop.
- **Rationale:** These decisions affect server/client boundaries, HTML validity and keyboard/screen-reader
  behaviour.
- **Impact:** Different pages will invent incompatible APIs, or create invalid link-button markup.
- **Recommended action:** Add typed prop contracts and short usage examples for every primitive. Make leaf
  primitives hook-free and client-safe. State that `GuestShell` alone owns the page `<main>` landmark.
- **Open questions:** Will buttons use an `asChild` pattern, separate `GuestLinkButton`, or a discriminated
  union? Which components may import Next-only modules?

### F15 - Action hierarchy and width rules contradict each other

- **Status:** Required decision
- **Priority:** P1
- **Type:** UX / Visual design
- **Relevant section:** `GuestButton`; table-manage; feedback; error
- **Description:** The global rule says one primary action per page and buttons become auto-width above 640px.
  Table-manage can show “Save changes” and “Save food choices” as primary actions, plus a red confirmation
  action. Feedback and error screens explicitly show full-width buttons. The plan has no `block` or hierarchy
  override.
- **Rationale:** Long task pages contain several independent forms, so “page” is too broad a unit for one
  primary action.
- **Impact:** Implementations will differ and visual review will have no objective pass condition.
- **Recommended action:** Change the rule to one primary action per task card or form, list approved exceptions,
  and define a `fullWidth`/responsive prop per button use.
- **Open questions:** Should both table-manage save buttons be gold? Should feedback and error actions remain
  full width on desktop?

### F16 - Landmark and heading requirements are missing

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Accessibility / HTML semantics
- **Relevant section:** Shared shell; Component plan; Phase 4
- **Description:** The new shell is expected to own the full page, but current tell-us and booking-portal
  components already render `<main>`. A direct migration can create nested `<main>` elements. Heading rules
  for cards, form groups and the privacy hero are not defined.
- **Rationale:** A page should have one main landmark and a logical heading outline.
- **Impact:** Invalid or confusing document structure for assistive technology, despite matching screenshots.
- **Recommended action:** Specify one `<main>` in `GuestShell`, with header and footer outside it. Change inner
  page roots to `form`, `section`, `article` or `div` as appropriate. Add semantic render tests.
- **Open questions:** Does privacy need an `<article>` inside the main landmark? Which card labels are headings
  and which are visual labels only?

### F17 - Accessibility acceptance criteria are incomplete and internally inconsistent

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Accessibility / Testing
- **Relevant section:** Component plan; Verification item 4
- **Description:** The handoff says checkboxes/radios are 20px with 44px label rows, while the tell-us screen
  specifies an 18px checkbox. The plan checks preserved ARIA strings but not error focus, field-error
  association, 200%/400% zoom, 320px reflow, screen-reader names, icon decoration, forced colours or dynamic
  announcement of payment states. Visual contrast checking omits the failing CTA palette.
- **Rationale:** Preserving existing attributes does not prove the changed UI meets WCAG.
- **Impact:** Keyboard and screen-reader regressions can pass the current checklist.
- **Recommended action:** Resolve the checkbox size conflict and add automated axe-style checks plus manual
  keyboard, VoiceOver/NVDA, zoom/reflow and reduced-motion cases. Require errors to use `aria-invalid`,
  `aria-describedby` and useful focus placement where relevant.
- **Open questions:** What WCAG target is required? Which browser/screen-reader combinations are part of sign-off?

### F18 - The test inventory is incorrect and new UI coverage is not planned

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Testing
- **Relevant section:** F7; Verification
- **Description:** The repository already has `tests/components/GuestCancelBooking.test.tsx`, a table-manage
  cutoff test, source guards for table payment and public parking, and route-handler tests around several
  guest flows. Therefore “no component tests” and “the two tests that touch this area” are false. At the same
  time, there are no planned tests for the ten new primitives or route-state renderings.
- **Rationale:** Existing tests may constrain refactors, and a full suite alone does not create coverage for new
  markup.
- **Impact:** Developers can accidentally break existing assertions or ship untested shared components.
- **Recommended action:** Replace F7 with an accurate impacted-test list. Add unit/render tests for every
  primitive, cancellation semantics, tell-us disclosure/errors, client payment states and representative
  server-state fixtures. Keep existing route/action tests as behaviour guards.
- **Open questions:** Which existing source guards may be replaced by behaviour tests? Is an accessibility test
  library approved for this repo?

### F19 - The visual proof method is temporary and not reproducible

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Testing / Delivery
- **Relevant section:** Verification item 2
- **Description:** A throwaway public route that is deleted before commit leaves no repeatable fixture,
  baseline, diff tolerance or review artifact. It also risks exposing realistic fixture data or being committed
  accidentally. Only 390px and 640px are named, while a 380px grid breakpoint and wider desktop behaviour are
  specified.
- **Rationale:** Later phases and regressions cannot rerun deleted evidence.
- **Impact:** “Pixel-perfect” becomes subjective and visual drift can return immediately.
- **Recommended action:** Create a persistent, synthetic fixture harness that is available only in test or
  development, or render presentation components directly in a screenshot runner. Store approved baselines
  and define viewport, browser, font-ready wait, motion disabling and pixel-diff tolerance. Test at least 320,
  375/390, 640 and a desktop width.
- **Open questions:** Where will approved screenshots live? Who signs off diffs? Can a guarded fixture route be
  guaranteed to return 404 in production?

### F20 - The visual source of truth is outside the repository

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Dependency / Delivery
- **Relevant section:** What this document is; Design handoff reference
- **Description:** The implementation depends on an iCloud Downloads path that another developer, CI runner or
  later checkout will not have. The specification has no version, checksum or immutable copy of the handoff.
- **Rationale:** Exact visual requirements and the logo asset must be reproducible for review and maintenance.
- **Impact:** Work can be blocked, use a changed handoff silently, or lose its audit trail.
- **Recommended action:** Put the approved handoff README, logo asset and either the prototype or approved
  screenshots in a versioned project location, subject to repository policy. Record checksums if the full
  bundle cannot be committed.
- **Open questions:** Is the handoff licensed and sized for repository storage? Who owns future design updates?

### F21 - File count and effort are materially understated

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Estimation / Delivery
- **Relevant section:** Scope; Phased delivery
- **Description:** The scope says 19 existing files. The phase lists imply about 29 existing code files, ten
  new components and a new asset, before tests and fixture infrastructure. `GuestSubmitButton` is mentioned
  as an in-place restyle but is not consistently listed in a phase.
- **Rationale:** File count drives the stated XL score and delivery split.
- **Impact:** Estimates, review capacity and phase exit dates will be too small.
- **Recommended action:** Generate an exact changed-file manifest per phase, including tests, assets and
  evidence. Re-estimate after F01, F02 and the component contracts are resolved.
- **Open questions:** Is the complexity score used for staffing or only guidance? Are screenshot fixtures and
  tests included in the estimate?

### F22 - Shared-component isolation is not fully resolved

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Architecture / Scope
- **Relevant section:** F3; Component plan; Phase 1 and Phase 3
- **Description:** Creating a new `GuestShell` correctly protects the excluded manager route, but
  `GuestSubmitButton` is also used by `/m/[token]/charge-request`. “Restyle in place” is ambiguous because the
  wrapper has no fixed visual class beyond its spinner; visual classes are supplied by each caller. The
  document also says all shared components are server components unless used by a client page, which is not a
  precise React boundary rule.
- **Rationale:** An API or default-style change to a shared wrapper can still alter or break the excluded route.
- **Impact:** The “leave exactly as it is” promise is not guaranteed.
- **Recommended action:** Leave `GuestSubmitButton` API and defaults unchanged and update only in-scope caller
  class names, or add a new guest-namespaced submit component. Add a render test for the excluded manager page's
  shared dependency contract.
- **Open questions:** Is changing only the spinner icon acceptable on the manager page? Should all new guest
  primitives live under `features/guest` with no imports from excluded routes?

### F23 - The new footer can propagate bearer tokens through referrers

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Security / Privacy
- **Relevant section:** Shared shell footer; Security headers; all token pages
- **Description:** Token pages will gain a same-origin `/privacy` link. The app's response policy is
  `Referrer-Policy: strict-origin-when-cross-origin`, which permits the full path and query as a same-origin
  referrer. That can copy `/g/<token>/...` or `/booking-portal/<token>` into privacy-page request logs and
  telemetry.
- **Rationale:** Guest tokens are bearer credentials and should not be copied beyond the page that consumes
  them.
- **Impact:** A purely visual footer change expands the locations in which live tokens can be stored.
- **Recommended action:** Set `referrerPolicy="no-referrer"` on footer navigation from credential-bearing
  pages or apply a route-specific no-referrer policy. Confirm tokens are redacted from logs, analytics,
  screenshots and error reporting. Add a browser/network acceptance test.
- **Open questions:** Does any analytics or request logging retain same-origin referrers today? Should all guest
  token responses use `no-referrer` by default?

### F24 - Legal/privacy content is treated as deferrable despite confirmed inconsistencies

- **Status:** Required decision
- **Priority:** P1
- **Type:** Data / Legal / Content
- **Relevant section:** Owner decision 3; Phase 4
- **Description:** The public policy names “The Anchor” as controller, uses the Staines TW19 6BJ address and
  `privacy@theanchorpub.co.uk`, while `COMPANY_DETAILS` names Orange Jelly Limited and the new footer uses
  Stanwell Moor TW19 6AQ and `manager@the-anchor.pub`. The policy is dated December 2024 and its processor list
  does not obviously reflect all current services.
- **Rationale:** Restyling and prominently linking a legal notice can be perceived as republishing it. The
  correct controller and contact facts require owner or legal confirmation, not a developer guess.
- **Impact:** Guests can see conflicting identity and contact information on one page.
- **Recommended action:** Require an owner/legal content check before Phase 4. Record confirmed controller
  name, postal address, privacy email, processor list and revised date. If copy remains unchanged, document the
  explicit acceptance of the inconsistency and a dated remediation ticket.
- **Open questions:** Is Orange Jelly Limited the legal controller? Which privacy mailbox and address are
  monitored and correct? Has the December 2024 policy been reviewed against current processing?

### F25 - Deployment, monitoring and rollback gates are absent

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Monitoring / Deployment
- **Relevant section:** Phased delivery; Verification; Risks
- **Description:** Phases are described as deployable, but there are no pre/post-deploy smoke tests, observation
  periods, payment/feedback success metrics, client-error monitoring, rollback criteria, owner sign-off or
  asset/font performance checks.
- **Rationale:** Visual refactors can still break form submission, PayPal SDK layout, hydration, links and
  mobile interaction.
- **Impact:** Regressions may first appear as lost payments, abandoned feedback or customer calls.
- **Recommended action:** Add phase entry/exit gates and a release checklist. Monitor page errors, PayPal
  create/capture/manual-review rates, parking retry failures, feedback submit success, route 404/429 rates and
  web vitals without recording tokens or personal data. Define rollback thresholds and the responsible owner.
- **Open questions:** What monitoring already exists? How long must each phase remain stable before the next?
  Who can roll back?

### F26 - Contact and brand facts will drift if copied as literals

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Data / Maintainability
- **Relevant section:** Shared shell footer; blocked/help states
- **Description:** The design uses several phone formats, explicit email/site URLs and a hand-copied address,
  while the application already has `COMPANY_DETAILS` and some routes use an environment phone override.
- **Rationale:** Shared guest chrome should have one data source and separate display values from `tel:` values.
- **Impact:** Future changes can leave different guest pages with different contact details.
- **Recommended action:** Define one guest contact object derived from approved company details. Normalise the
  telephone URI separately from its display format. Document whether environment overrides remain supported.
- **Open questions:** Should production contact values come from code or environment? Is `www.the-anchor.pub`
  or `the-anchor.pub` canonical?

### F27 - The radius instruction does not match the current Tailwind theme

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Technical / Visual fidelity
- **Relevant section:** Token and font foundation
- **Description:** The document says to add 6px and 12px guest radii only if defaults drift. The current theme is
  6px, 8px, 10px, 14px and 20px; there is no 12px token. The desired guest card radius is already different.
- **Rationale:** Depending on `rounded-md` would produce 10px, not the approved 12px.
- **Impact:** Shared cards, alerts and sunk boxes can miss the pixel-accurate target.
- **Recommended action:** Add an unconditional, clearly named 12px guest radius such as
  `--radius-guest-card`, and use the existing 6px value only where its mapping is explicit.
- **Open questions:** Should guest utilities use semantic names (`guest-field`, `guest-card`) rather than size
  names that may later drift?

### F28 - A pre-order data failure silently removes the whole section

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Error handling / Functional
- **Relevant section:** table-manage screen; Verification item 3
- **Description:** `table-manage/page.tsx` catches `loadBookerPreorderView` failure, logs a warning and renders no
  guest explanation. The specification preserves this behaviour but does not design or test the degraded state.
- **Rationale:** A guest following a pre-order reminder can see no food section and no reason or recovery action.
- **Impact:** The redesign can look complete while the main journey has disappeared during an outage.
- **Recommended action:** Add a non-blocking problem alert explaining that food choices could not be loaded and
  giving a retry/call action, while keeping booking management and cancellation available. Test the caught
  failure branch.
- **Open questions:** Should the page offer a refresh link? Which log/alert threshold should notify staff?

### F29 - Guest route metadata is not part of the acceptance criteria

- **Status:** Optional improvement
- **Priority:** P3
- **Type:** UX / Privacy
- **Relevant section:** Scope; Verification
- **Description:** Most token pages inherit the root title “Management Tools”. Only the feedback and privacy
  pages define relevant metadata. The redesign changes the guest brand but does not check browser titles or
  link-preview behaviour.
- **Rationale:** Clear titles help guests distinguish payment and booking tabs. Token pages must remain noindex
  and avoid personal data in titles.
- **Impact:** The visual redesign can still feel internal or expose dynamic details in browser history if added
  carelessly later.
- **Recommended action:** Add static, non-personal route metadata such as “Booking payment - The Anchor” and
  assert `noindex`, `nofollow` and no token/customer data in metadata.
- **Open questions:** Is metadata explicitly out of scope for this delivery?

### F30 - The claimed traffic-based phase priority is unverified

- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Delivery / Evidence
- **Relevant section:** Phase 1 rationale
- **Description:** `/feedback` is called the highest-traffic public page, but the specification provides no
  source or period for that claim.
- **Rationale:** Phase order is partly justified by traffic and immediate value.
- **Impact:** The team may prioritise the wrong surface or expose the busiest page to the least-proven version
  of the new shared layer.
- **Recommended action:** Cite privacy-safe request counts, or remove the traffic claim and prioritise by
  implementation risk. Consider proving the shell on the lowest-risk page before the highest-volume page.
- **Open questions:** What are route volumes and completion rates over the last 30 to 90 days?

### F31 - The full component library need not be built before it is exercised

- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Simplification / Delivery
- **Relevant section:** Phase 1
- **Description:** Phase 1 proposes all ten primitives although several are not used until payment, parking or
  portal phases.
- **Rationale:** Unused abstractions are harder to review and often change once real screens use them.
- **Impact:** More Phase 1 code, longer review and possible rework.
- **Recommended action:** Build the shell and primitives needed by feedback first, then add amount, details,
  badge, trust and blocked-state primitives with the first route that proves each contract. Keep one shared
  design checklist so incremental work does not drift.
- **Open questions:** Does the team prefer one foundation pull request or smaller vertical slices?

## 4. Specific wording changes suggested

These are targeted corrections, not a rewrite of the original document.

1. **Scope count**  
   Replace “14 guest-facing routes” with wording such as:  
   “The current candidate scope contains 14 route entries plus the `parking` not-found boundary. The final
   count depends on the `/error` audience decision. The authoritative scope is the route-state table below.”

2. **Styling-only boundary**  
   Replace the absolute copy statement with:  
   “This is primarily a styling and layout change. Approved presentation copy additions are limited to the
   kickers, footer, trust lines, badges and action labels listed in this document. Existing business, legal and
   error copy otherwise remains unchanged. Any security remediation is tracked and approved separately.”

3. **Font variables**  
   Clarify:  
   “Expose `next/font` through distinct runtime variables, then map guest Tailwind font tokens to those
   variables. Do not give the runtime variable and the `@theme` token the same name.”

4. **Primary button accessibility**  
   Replace the white-on-`#a57626` rule only after design approval, for example:  
   “Primary buttons use white text on `#8b6914` or another approved combination with at least 4.5:1 contrast
   at every specified text size.”

5. **Verification states**  
   Replace “The handoff enumerates them per page” with:  
   “The route-state appendix is authoritative. Every listed server, client, dependency-failure and retry state
   must have a fixture and a named automated or manual acceptance check.”

6. **`/error` owner decision**  
   Replace the current recommendation with:  
   “`/error` currently serves authentication and onboarding failures. Decide whether it remains an auth surface
   or becomes audience-aware before changing its shell or recovery actions.”

## 5. Unresolved decisions that must be closed

1. Final scope: route entries versus parking not-found boundary, and whether `/error` belongs in guest scope.
2. Accessible primary CTA colour approved by the design owner.
3. Parking access model, public field allow-list and treatment of existing internal notes.
4. Whether the destructive GET cancellation fallback may remain.
5. Exact list of approved new copy and changed link destinations.
6. Payment success behaviour for client capture, event manual review and portal capture states.
7. Booking-portal CTA wording and whether the amount is passed into the client.
8. One-primary-action rule and desktop full-width exceptions.
9. Guest component APIs, landmark ownership and alert semantics.
10. Route-scoped versus root font loading and performance budgets.
11. Token-page referrer policy and telemetry redaction.
12. Correct legal controller, privacy address, email, processor list and policy date.
13. Production monitoring metrics, thresholds, sign-off owner and rollback owner.

## 6. Overall readiness assessment

**Readiness: red - not ready for implementation as written.**

The visual direction is usable and much of the technical discovery is strong. Phase 1 should not start until
the CTA contrast, handoff versioning, font/component contracts and CSS scoping are corrected. The parking and
`/error` decisions must be closed before Phase 4, with the parking note exposure treated as a security issue
rather than a styling detail. Payment phases need the full existing state matrix before implementation.

### Required changes before build starts

1. Create the authoritative route/surface/file/state matrix and correct the count.
2. Approve a WCAG-compliant CTA palette.
3. Add `GuestBadge` and complete typed contracts for shell, button, alert, field and blocked state.
4. Correct the font variable mapping and scope guest styles/fonts away from staff routes.
5. Version the handoff and assets inside an accessible project location.
6. Inventory approved copy additions and action destinations.
7. Define the visual-test harness and shared-component test plan.

### Required before the affected phases ship

1. Remove internal parking notes from the public projection and resolve signed access.
2. Resolve `/error` audience and recovery actions.
3. Remove or formally secure the destructive GET cancellation path.
4. Define every payment, retry, failure and manual-review state.
5. Prevent token referrer and telemetry leakage.
6. Confirm the privacy policy facts before Phase 4.
7. Add monitoring, smoke tests, observation windows and rollback gates.

### Major risks

- Disclosure of parking internal notes and other booking data through a public ID URL.
- Live bearer tokens copied into same-origin logs through the new footer.
- An inaccessible primary CTA shipped across every guest journey.
- Staff and onboarding users sent to the wrong recovery destination from `/error`.
- Payment capture or manual-review branches visually broken despite happy-path approval.
- Global focus/font changes leaking into the authenticated staff application.
- A deleted temporary preview route leaving no repeatable visual evidence.
- Legal identity and contact details visibly conflicting on the privacy page.

### Recommended next steps

1. Hold a short owner, developer and design decision session for the 13 unresolved decisions.
2. Immediately create a security ticket for parking notes/access and a separate decision for the GET
   cancellation fallback.
3. Amend the specification with the targeted corrections and route-state matrix.
4. Add persistent synthetic fixtures and tests for the shared primitives before route migration.
5. Re-estimate the corrected file list and assign phase owners and release gates.
6. Start Phase 1 only after accessibility and CSS/font isolation are approved.
