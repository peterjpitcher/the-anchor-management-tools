# Booking Form Holistic Review — the-anchor.pub ↔ Anchor Management Tools

**Date**: 2026-03-21
**Status**: QA validated — ready for implementation
**Scope**: End-to-end booking flow across both the brand website (OJ-The-Anchor.pub) and the management API (OJ-AnchorManagementTools)
**QA**: 5 parallel agents validated all findings (party size, Monday kitchen, UX messages, security, availability gap)

---

## Executive Summary

The booking form on the-anchor.pub is well-designed with a clean 4-step wizard, event cross-promotion, and persistent mobile FAB. However, there are **two live production bugs** causing lost bookings, a **critical UX gap** on kitchen-closed days, and a **systemic availability gap** that will cause false rejections on busy nights.

---

## CRITICAL — Live Production Bugs

### BUG 1: Party Size Input Broken on Mobile

**Severity**: P0 — blocks bookings for users trying to change party size
**Repo**: OJ-The-Anchor.pub
**File**: `components/features/TableBooking/ManagementTableBookingForm.tsx` line 1620
**QA Status**: CONFIRMED by qa-party-size agent

**Root cause**: The onChange handler:
```tsx
onChange={(event) => setPartySize(Math.min(Math.max(Number(event.target.value) || 1, 1), 50))}
```

`Number("") || 1` → `0 || 1` → `1`. The field instantly snaps to 1 when cleared. On mobile there are no spinner arrows, so clearing and retyping is the ONLY way to change the value. Users get stuck on the very first input.

**Fix** (minimal, immediate):
```tsx
onChange={(event) => {
  const raw = event.target.value
  if (raw === '') return  // allow clearing while typing
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed)) return
  setPartySize(Math.min(Math.max(parsed, 1), 50))
}}
```

**Better fix** (follow-up): Replace with a stepper component (- / count / +). No existing stepper in the project's UI primitives — would need to be created.

### BUG 2: "No Tables" on Kitchen-Closed Days (e.g. Monday)

**Severity**: P0 — turns away paying customers
**Repo**: OJ-The-Anchor.pub
**QA Status**: CONFIRMED by qa-monday-kitchen + qa-ux-messages agents

**Root cause**: The kitchen IS intentionally closed on Mondays (common for UK pubs). The `schedule_config` for Monday is `[]` and kitchen hours are null. This is CORRECT configuration. The bug is in the **UX handling**:

1. Form defaults to "Food (kitchen hours)"
2. Availability returns zero food slots for Monday
3. Form shows "No online times available" — sounds like "we're full"
4. **No suggestion to try drinks-only** (confirmed: nowhere in the component)
5. Customer thinks the pub is booked out and goes elsewhere
6. Meanwhile, Monday drinks-only has **12 available slots**

**Fix**: When food returns zero slots but the venue is open:
- Auto-check drinks availability in the background
- Show: "Our kitchen is closed on [day], but we have drinks tables available"
- Add a one-tap "Check drinks availability" button on Step 2
- Add a purpose toggle directly on Step 2 (currently requires going back to Step 1)

---

## HIGH — Systemic Issue

### ISSUE 3: Availability Never Checks Real Table Occupancy

**Severity**: High — will cause false rejections on busy nights
**Repos**: Both
**QA Status**: CONFIRMED by qa-availability-gap agent

**Root cause**: The availability endpoint (`GET /api/table-bookings/availability` on the website) builds time slots from `schedule_config` service windows ONLY. It hardcodes `capacity: 50` and never queries actual table bookings. Every response has `source: 'schedule_fallback'` — there is no primary path.

The real table check only happens at booking submission time (`POST /api/table-bookings` → `create_table_booking_v05` RPC). This means:
- All slots show "available" even when every table is booked
- User fills in 4 steps of the form, gets rejected at the end with "no table"
- Actual venue capacity: 10 tables, 34 covers (not 50)

**Impact**: On a busy Friday/Saturday, the venue could be fully booked with 10 concurrent bookings. The availability endpoint would still show every slot as "available."

**Short-term fix**: Create a read-only RPC `check_slot_availability(p_date, p_time, p_party_size, p_purpose)` that runs the same table-search query from `create_table_booking_v05`. Call it from the availability endpoint.

**Medium-term fix**: Batch RPC `check_slots_availability(p_date, p_slots jsonb[])` for multiple slots in one DB round-trip.

**Long-term fix**: Pre-compute per-slot remaining capacity via cron/materialized view. Show "X tables left" per slot.

---

## MEDIUM — Security & Integration

### ISSUE 4: CORS Wildcard in Production

**Severity**: Medium — security risk
**Repo**: OJ-AnchorManagementTools
**File**: `src/lib/api/auth.ts` line 148
**QA Status**: CONFIRMED — `CORS_ALLOWED_ORIGIN` not set in any env file

`CORS_ALLOWED_ORIGIN` defaults to `'*'`. Any website can make cross-origin requests to the management API.

**Fix**: Add `CORS_ALLOWED_ORIGIN=https://www.the-anchor.pub` to Vercel env vars and `.env.example`.

### ISSUE 5: Stale Redirects

**Repo**: OJ-AnchorManagementTools
**QA Status**: CONFIRMED

- `src/app/table-booking/page.tsx` → redirects to `/whats-on` (should be `/book-table`)
- `src/app/table-booking/success/page.tsx` → redirects to `/whats-on` (should be `/book-table`)

**Fix**: Update both to `https://www.the-anchor.pub/book-table`.

### ISSUE 6: Guest SMS Links on Unfamiliar Domain

**QA Status**: CONFIRMED

SMS booking manage/payment links go to `management.orangejelly.co.uk` — an unfamiliar domain for customers. Guest pages ARE branded for The Anchor (logo, styling), but the domain creates trust friction.

**Fix options**:
- Set up `secure.the-anchor.pub` proxying to management app for `/g/` routes
- Or accept current state (low risk, functioning correctly)

---

## LOWER — UX Improvements

### ISSUE 7: No Deposit Warning Before Step 4

Groups of 7+ discover the £10/person deposit at the review step. Surprise = abandonment.

**Fix**: Show banner in Step 1 when party_size ≥ 7: "Groups of 7+ require a £10 per person deposit."

### ISSUE 8: Excessive Mobile Scrolling

Each step requires 3-4 full scrolls on 390px viewport. Step tabs (2×2 grid), event promotions, and "Need help?" sections consume vertical space.

**Fix**: Compact progress bar (remove duplicate step tabs), auto-collapse event promos, show "Need help?" only on first/last steps.

### ISSUE 9: No Notes/Special Requirements Field Visible

API supports `notes` but it's not prominently offered to new customers.

**Fix**: Add optional "Anything we should know?" textarea in Step 3, always visible.

### ISSUE 10: Date Display Format

`DD/MM/YYYY` format could confuse international Heathrow travellers.

**Fix**: Display date in words after selection: "Saturday, 21 March 2026".

---

## What's Working Well

- 4-step progressive disclosure wizard
- FAB quick actions (Book, Call, WhatsApp, Directions, Menu) — always accessible
- Event cross-promotion during booking
- Phone-first approach — low friction for mobile
- Customer lookup — returning customers skip name/email
- Idempotency keys — prevents duplicate bookings
- "Prefer to call?" with clickable number
- Trust signals: "Free to cancel", "Confirmation in seconds"
- PWA manifest
- Accessibility section
- Alternative slot suggestions when preferred time unavailable
- API key security — properly server-side only, never exposed to browser
- Guest pages branded for The Anchor (not management tool)

---

## Validated Priority Order

| # | Issue | Effort | Impact | Repo |
|---|-------|--------|--------|------|
| 1 | Party size input on mobile | 30 min | P0 — unblocks bookings | Website |
| 2 | Kitchen-closed → suggest drinks | 2-3 hrs | P0 — unblocks Monday+ bookings | Website |
| 3 | Real table availability check | 4-8 hrs | High — prevents busy-night rejections | Both |
| 4 | CORS lock-down | 5 min | Security | Management env vars |
| 5 | Stale redirects | 10 min | UX | Management tools |
| 6 | Deposit warning for 7+ | 30 min | Conversion | Website |
| 7 | Reduce mobile scrolling | 2-3 hrs | Conversion | Website |
| 8 | Notes/special requirements | 30 min | UX | Website |
| 9 | Guest domain trust | 4-8 hrs | UX/Trust | Infrastructure |
| 10 | Date display format | 15 min | UX | Website |
