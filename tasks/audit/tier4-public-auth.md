# Public + Auth

Audited at 375px width against the standard mobile rubric. This section is unusually clean:
almost every route renders through the shared `.auth` / `.public` layout classes in
`src/app/globals.css`, which already carry a dedicated mobile breakpoint
(`@media (max-width: 820px)`, starting line 1226) that:
- bumps `--spacing-input-h` / `--spacing-btn-h` / `--spacing-btn-h-lg` up to 42–48px (tap targets),
- sets `html, body { max-width: 100vw; overflow-x: hidden; }` (line 1235-1239) as a global
  safety net against horizontal body scroll,
- collapses `.auth__card` to full-width, zero-border, reduced padding (line 1437-1443),
- stacks `.public__footer` and reduces `.public__hero-title` font-size (lines 1336-1429).

None of that is a page-level fix — it's a shared-CSS system already doing the right thing — so it
is not reported as a per-route issue below. Findings below are limited to things the individual
page/component JSX does that the shared CSS can't rescue.

## /

Live file: `/Users/peterpitcher/Cursor/OJ-AMS-mobile/src/app/page.tsx`

Pure `redirect('/dashboard')` — no JSX render body. Nothing to audit at this route.

PASS (no mobile issues found)

REDESIGN: no — not a rendering route.

## /login

Live file: `/Users/peterpitcher/Cursor/OJ-AMS-mobile/src/app/login/page.tsx`

Pure `redirect('/auth/login')` — no JSX render body. Nothing to audit at this route.

PASS (no mobile issues found)

REDESIGN: no — not a rendering route.

## /auth/login

Live files:
- `/Users/peterpitcher/Cursor/OJ-AMS-mobile/src/app/auth/login/page.tsx` (Suspense wrapper)
- `/Users/peterpitcher/Cursor/OJ-AMS-mobile/src/app/auth/login/_components/LoginClient.tsx` (actual form)

Uses the shared `.auth` / `.auth__card` layout (single-column card, full-width inputs/buttons via
`Field`/`Input`/`Button` from `@/ds`, `type="email"` / `type="password"` / `inputMode="numeric"`
set correctly). Tap targets inherit the 42–48px mobile-breakpoint button/input heights from
globals.css. Nothing in this file introduces a fixed px width, a `grid-cols-N`, or an unwrapped
row of controls wider than 375px.

- [L] item#1 — `flex items-center justify-between` row (Forgot-password link + optional "After
  sign in: {redirectTo}" status text) has no `flex-wrap`, no `min-w-0`/`truncate` on the status
  span. `redirectTo` comes straight from the `redirectedFrom` query param / a cookie
  (`sanitizeRedirectTarget`, lines 12-24) and can be an arbitrary in-app path (e.g.
  `/private-bookings/<uuid>/communications`). A long value doesn't wrap onto its own line (flex
  items don't shrink below their max-content width by default) and gets silently clipped by the
  global `overflow-x:hidden` safety net rather than staying readable — `LoginClient.tsx:175-182`.

REDESIGN: no — single card layout is already correct for mobile; this is a one-line CSS fix
(`flex-wrap` + `min-w-0`/`truncate` on the span), not a structural redesign.

## /auth/recover

Live file: `/Users/peterpitcher/Cursor/OJ-AMS-mobile/src/app/auth/recover/page.tsx`

Static informational card: `min-h-screen flex items-center justify-center bg-sidebar p-4` wrapping
a `max-w-md` card of plain paragraph text. No fixed px widths beyond the `max-w-md` cap (448px),
which is irrelevant at 375px since the flex parent has `p-4` and the card's own text content
wraps normally (no `whitespace-nowrap`, no tables/grids/forms/buttons on this page at all).

PASS (no mobile issues found)

REDESIGN: no.

## /auth/reset

Live files:
- `/Users/peterpitcher/Cursor/OJ-AMS-mobile/src/app/auth/reset/page.tsx` (server component, auth
  gate, renders `ResetPasswordForm`)
- `/Users/peterpitcher/Cursor/OJ-AMS-mobile/src/app/auth/reset/reset-password-form.tsx`

Uses `Container size="sm"` + `Card` + `Form`/`FormGroup`/`Input`/`Button` from `@/ds`
(`fullWidth` on the submit button). `Container` (`src/ds/compat/Container.tsx`) only ever applies a
`max-width` class plus `px-4 sm:px-6 lg:px-8` — never a fixed px width — so it shrinks correctly
to 375px. Two stacked password fields, no side-by-side inputs, `autoComplete="new-password"` set
correctly, `minLength={8}` enforced with a matching error toast.

PASS (no mobile issues found)

REDESIGN: no.

## /auth/reset-password

Live file: `/Users/peterpitcher/Cursor/OJ-AMS-mobile/src/app/auth/reset-password/page.tsx`
(contains the "request a reset email" `ResetPasswordForm` client component directly — this is the
public-facing forgot-password entry point, distinct from `/auth/reset` which sets the new
password after the emailed link).

Same `Container`/`Card`/`Form`/`FormGroup` pattern as above. Logo wrapper `mx-auto w-64` (256px)
fits comfortably inside a 375px viewport with the `p-4` parent padding (343px available). Submit
button uses `fullWidth size="lg"`. Success state swaps to an `EmptyState` with a single
`LinkButton` back to login. No side-by-side fields, no tables.

PASS (no mobile issues found)

REDESIGN: no.

## /error

Live files:
- `/Users/peterpitcher/Cursor/OJ-AMS-mobile/src/app/error/page.tsx` (server component, maps
  `?code=` to a friendly title/message)
- `/Users/peterpitcher/Cursor/OJ-AMS-mobile/src/app/error/_components/ErrorClient.tsx`

Standard `.auth`/`.auth__card` card, icon circle, two full-width stacked buttons
(`Try again` / `Back to Dashboard`), footer mailto link. Same mobile-safe pattern as
`/auth/login`.

- [L] item#3 — the `REF-{code}` box (`bg-surface-hover ... font-mono text-sm ... text-center`)
  has no `break-words`/`overflow-wrap: anywhere`. `code` is taken verbatim from the `?code=`
  query string (`ErrorClient.tsx` prop, sourced from `page.tsx:45-47`) — an attacker- or
  bookmark-supplied value with no length limit. A long single-token value would be clipped by the
  global mobile `overflow-x:hidden` rule rather than wrapping — `ErrorClient.tsx:25-29`. Low
  severity: real values only ever come from the fixed `FRIENDLY_MESSAGES` key set or Supabase's
  own short auth error codes in practice.

REDESIGN: no.

## /unauthorized

Live file: `/Users/peterpitcher/Cursor/OJ-AMS-mobile/src/app/unauthorized/page.tsx`

Same `.auth`/`.auth__card` pattern, wrapped in `Suspense` for `useSearchParams`. Icon circle,
descriptive text, two full-width stacked buttons (`Go to Dashboard` / `Go Back`).

- [M] item#3 / item#5 — the attempted-path box (`bg-surface-hover ... font-mono text-sm ...
  text-center`, no `break-words`/`overflow-wrap`) renders `attemptedPath` straight from
  `searchParams.get('path') || searchParams.get('from')` — `UnauthorizedContent`,
  `page.tsx:10, 26-28`. This app has genuinely long nested routes (e.g.
  `/private-bookings/<uuid>/communications`, `/employees/<uuid>/details`), and this page's whole
  job is to show the user which URL they were denied. On a 375px `auth__card` (~291px content
  width after 24px mobile padding) a realistic path string in monospace 14px text exceeds that
  width; with no wrap hook it relies entirely on the browser's implementation-defined
  break-after-`/`/`-` behaviour, and the global `overflow-x:hidden` on `body` (globals.css
  line 1235-1239) means overflow is silently clipped rather than causing a scrollbar — so on some
  browsers part of the diagnostic path can be invisible with no affordance to read the rest.
  Severity raised to Medium vs. the `/error` REF-code case because the value is realistically long
  in this specific app and is the core piece of information the page exists to show.

REDESIGN: no — this is a one-line CSS fix (`break-words` / `overflow-wrap: anywhere` on the
path `<div>`), not a structural redesign.

## /privacy

Live file: `/Users/peterpitcher/Cursor/OJ-AMS-mobile/src/app/privacy/page.tsx`

Uses `.public` / `.public__hero` / `.public__main--prose` / `.public__prose` — plain long-form
prose (headings, paragraphs, `<ul>`/`<li>`, `mailto:`/external links). No tables, no forms, no
fixed px widths in `.public__prose` (globals.css lines 822-849) or the hero classes it uses
(percentage/flex based throughout, with the mobile breakpoint reducing hero font-size and
padding at lines 1336-1429). Footer switches to a stacked column layout on mobile
(`.public__footer`, line 1419-1424).

PASS (no mobile issues found)

REDESIGN: no.
