# Frontend handoff — Review feedback funnel (PR1, wave 1)

Branch: `feat/review-feedback-funnel`

## Files created

1. `src/app/(feedback)/feedback/page.tsx` — Screen 1 landing (server component). Uses `GuestPageShell` (Anchor branding). Heading "Did you enjoy your visit with us?" + two ≥48px full-width buttons:
   - **Yes** → `<a href="https://g.page/r/CXmhY3UO3834EBM/review">` (green `bg-sidebar` primary).
   - **No** → `<Link href="/feedback/tell-us">` (neutral bordered secondary).
2. `src/app/(feedback)/feedback/tell-us/page.tsx` — server wrapper rendering `<TellUsClient />`.
3. `src/app/(feedback)/feedback/tell-us/TellUsClient.tsx` — `'use client'` Google-review-composer lookalike, **no Google marks** (grey "A" avatar, "The Anchor" / "Rate your visit", gold stars, blue "Post" button).
4. `src/app/(feedback)/feedback/thanks/page.tsx` — Screen 3 thank-you (server, `GuestPageShell`).
5. `src/components/features/feedback/StarRating.tsx` — `'use client'` star input (custom inline SVG; gold/grey; keyboard arrows; `aria-label`/`aria-pressed`; ≥40px hit area).

## Also changed

- `src/app/privacy/page.tsx` — added ONE sentence at the end of section 4 ("How We Use Your Information"): *"If you choose to leave your name, email or phone number with feedback, we'll only use it to contact you about that feedback."* Privacy page found and edited (did not create a new one).

## API contract I POST to (unchanged from brief)

- `POST /api/feedback`
- Headers: `Content-Type: application/json`, `Idempotency-Key: <uuid>` (generated once per mount via `crypto.randomUUID()` in client, reused on retry).
- Body (camelCase, only filled optional fields included):
  ```json
  {
    "rating": 1-5,
    "comments": "optional string",
    "customerName": "optional string",
    "customerEmail": "optional string",
    "customerPhone": "optional string",
    "contactConsent": true|false,
    "honeypot": "string (hidden field 'company'; empty for humans)"
  }
  ```

## Success / error handling

- **Success**: `res.ok` (any 2xx) → `router.push('/feedback/thanks')`.
- **Error**: non-2xx → parse JSON `{ success:false, error:{ code, message } }`, show `error.message` inline; fallback "Something went wrong, please try again." Button re-enabled on error. Network/parse failures logged via `console.error` (never `console.log`).
- **Client validation before POST**: rating ≥ 1 required (Post disabled until a star chosen); if email filled, basic shape check `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`.

## Assumptions / notes

- Route group `(feedback)` has **no** `layout.tsx` — inherits the root layout (which sets robots noindex, as desired). Did not create one.
- Screen 2 deliberately does **not** use `GuestPageShell` (no big Anchor logo) so it reads as a neutral composer. Screens 1 and 3 do use it.
- Honeypot input is field `name="company"`, visually hidden (off-screen container, `tabIndex={-1}`, `autoComplete="off"`) but its value is submitted as `honeypot`.
- Blue "Post" button and the composer are hand-styled with Tailwind palette classes (`bg-blue-600`, `text-gray-*`, `text-yellow-400`) rather than `@/ds` primitives, because the DS Button/Input are green/neutral-tokened and can't produce the Google look. No raw hex, no dynamic class construction.
- `contactConsent` is sent on every submit (true/false) regardless of whether the contact section is expanded; defaults false.

## Backend dependency

- Endpoint `POST /api/feedback` is owned by the backend agent. Until it exists, submissions will return non-2xx and show the inline error — expected during parallel dev.
