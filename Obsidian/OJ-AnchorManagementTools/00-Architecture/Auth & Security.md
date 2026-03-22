---
title: "Auth & Security"
aliases:
  - "Auth"
  - "Authentication"
  - "Security"
  - "Sessions"
tags:
  - type/reference
  - status/active
module: architecture
created: 2026-03-14
updated: 2026-03-14
---

# Auth & Security

← [[Architecture MOC]]

---

## Auth Architecture

Supabase Auth with JWT + HTTP-only cookies. The middleware (`src/middleware.ts`) is currently **disabled** (renamed `.disabled` after a Vercel incident). Auth is enforced in `(authenticated)/layout.tsx` via `supabase.auth.getUser()`.

---

## Three Supabase Clients

| Client | File | Key | Used For |
|---|---|---|---|
| Browser | `src/lib/supabase/client.ts` | Anon | `'use client'` components only |
| Server | `src/lib/supabase/server.ts` | Anon | Server components, server actions, route handlers |
| Admin | `src/lib/supabase/admin.ts` | Service role | System/cron ops only — bypasses RLS |

> [!DANGER] Never Import Admin Client in Client Components
> An ESLint rule prevents this. The admin client bypasses RLS — it must never run in the browser.

---

## Auth Flows

### Sign-In
1. `POST /api/auth/login` — email + password
2. Validate CAPTCHA (Cloudflare Turnstile)
3. `supabase.auth.signInWithPassword()`
4. Create app session record in `app_sessions` table
5. Redirect to `/dashboard` (or validated `?from=` param)

### Sign-Up — Invite Only
- No public registration. Any `/register` or `/signup` route returns 404.
- Admins send invites via Supabase Admin API
- Two-step atomic: (1) create user, (2) set `app_metadata.role`. If step 2 fails, delete user.
- Invite link expiry: **7 days**

### Password Reset
1. `POST /api/auth/forgot-password` — always returns generic success (prevents enumeration)
2. Email sent via Supabase with 60-minute expiry link
3. Link → `/auth/confirm?token_hash=...&type=recovery`
4. Exchange token → redirect to `/auth/update-password`
5. `destroyAllSessionsForUser()` + new session issued

### Sign-Out
- `POST /api/auth/logout` (CSRF-protected)
- Destroys app session record
- `supabase.auth.signOut()`
- Redirect to `/auth/login`

---

## Session Management

Dual-layer sessions on top of the Supabase JWT:

| Setting | Value |
|---|---|
| Absolute timeout | 24 hours |
| Idle timeout | 30 minutes |
| Cookie name | `app-session-id` |
| Cookie flags | `httpOnly`, `sameSite: strict`, `secure` |

`lastActivityAt` is updated by the heartbeat endpoint (`POST /api/auth/heartbeat`) on user activity (debounced to max 1 call/minute).

---

## Security Headers

Applied on every response:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
frame-ancestors: none
```

---

## CSRF Protection

Double-submit cookie pattern. Token: 32 random bytes (hex-encoded).

- Cookie: `csrf-token` (`httpOnly: false` — must be JS-readable)
- Header: `x-csrf-token`
- Applied to: all POST/PUT/PATCH/DELETE on protected routes
- Exempt: `POST /api/auth/login`, `POST /api/auth/forgot-password`, webhook endpoints

---

## Public Path Allowlist

```
/auth/*
/api/auth/login
/api/auth/forgot-password
/api/auth/confirm
/timeclock
/parking/guest
/table-booking
/g/*
/m/*
/r/*
```

---

## Related
- [[RBAC & Permissions]]
- [[Tech Stack]]
- [[Database Schema]]
