---
title: Environment Variables
aliases:
  - env vars
  - environment config
tags:
  - type/reference
  - section/operations
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

← [[Operations MOC]]

# Environment Variables

All secrets and environment-specific configuration are stored as environment variables. For production and preview deployments these are set in Vercel's environment configuration. For local development they live in `.env.local` (never committed to the repository).

> [!DANGER] Never Commit Secrets
> `.env.local` must remain in `.gitignore`. Never commit API keys, tokens, or secrets to the repository. Rotate any key that is accidentally exposed immediately.

The `.env.example` file in the project root contains a complete template with placeholder values for onboarding new developers.

## Supabase

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL — safe to expose to the client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key — safe to expose; RLS enforces access control |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — bypasses RLS; **server-only, never expose to client** |

> [!WARNING] Service Role Key
> `SUPABASE_SERVICE_ROLE_KEY` must only ever be used in server-side code. It bypasses all Row Level Security policies. Importing the admin Supabase client in a client component is blocked by ESLint rules.

## Application

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Public base URL, e.g. `https://management.theanchor.pub` |
| `CRON_SECRET` | Bearer token required on all `/api/cron/*` requests — see [[Cron Jobs]] |
| `PAYROLL_ACCOUNTANT_EMAIL` | Email address for payroll report delivery |

## Twilio

Used for SMS messaging. See [[Twilio]] and [[SMS Policy]].

| Variable | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account identifier |
| `TWILIO_AUTH_TOKEN` | Twilio auth token — also used to validate inbound [[Webhooks]] signatures |
| `TWILIO_PHONE_NUMBER` | The outbound SMS number in E.164 format |

## Microsoft

Used for sending email via Microsoft 365. See [[Microsoft Graph]].

| Variable | Purpose |
|---|---|
| `MICROSOFT_CLIENT_ID` | Azure AD app registration client ID |
| `MICROSOFT_CLIENT_SECRET` | Azure AD client secret |
| `MICROSOFT_TENANT_ID` | Azure AD tenant ID |
| `MICROSOFT_USER_EMAIL` | The Microsoft 365 mailbox to send from |

## Stripe

Used for card payment processing. See [[Stripe]].

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API secret key — server-only |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for validating inbound [[Webhooks]] from Stripe |

## PayPal

Used for PayPal payment processing. See [[PayPal]].

| Variable | Purpose |
|---|---|
| `PAYPAL_CLIENT_ID` | PayPal app client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal app client secret |
| `PAYPAL_WEBHOOK_ID` | PayPal webhook ID used during signature validation |
| `PAYPAL_ENVIRONMENT` | `sandbox` for development, `production` for live |

## OpenAI

Used for AI-assisted receipt classification.

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key — server-only |

## Related

- [[Operations MOC]]
- [[Cron Jobs]]
- [[Webhooks]]
- [[Twilio]]
- [[Microsoft Graph]]
- [[Stripe]]
- [[PayPal]]
- [[OpenAI]]
- [[Deployment & Infrastructure]]
