# Re-verification of June 2026 correctness/security report (tasks/section-review-findings.md) @ HEAD 76655f69

## CRITICAL items

- **C1 — anon UPDATE on `timeclock_sessions`** — **FIXED** — `supabase/migrations/20260708000014_drop_timeclock_anon_update.sql:4-5` (`DROP POLICY IF EXISTS "anon_clock_out"` + `REVOKE UPDATE ... FROM anon`) — fix exists as a repo migration; live-DB application not verifiable from the repo (prod migrations are applied via MCP per project workflow).

## HIGH items

- **H1 — `/m` missing from middleware allowlist** — **FIXED** — `src/middleware.ts:29` (`'/m'` in `PUBLIC_PATH_PREFIXES`); `middleware.ts.disabled` deleted.
- **H2 — daily-summary PII leak, no RBAC** — **FIXED** — `src/app/actions/daily-summary.ts:19-27` checks view permissions before building the summary.
- **H3 — employees CSV formula injection** — **FIXED** — `src/services/employees.ts:25-31` `escapeCsvCell`.
- **H4 — private-booking refund threshold timezone bug** — **FIXED** — `src/services/private-bookings/financial.ts:113-143` London-aware calendar-day diff.
- **H5 — "Mark as Paid" button always fails** — **FIXED** — button removed; Record Payment is the working path.
- **H6 — invoice VAT divergence screen/stored/PDF** — **FIXED** — `src/lib/invoiceCalculations.ts:66-77` per-line rounding; screen/PDF print persisted values.
- **H7 — recurring-invoice cron orphans draft on email failure** — **FIXED** — `recurring-invoices/route.ts:344-363` draft→sent before email; failures logged with `email_send_failed`.
- **H8 — quote summary £NaN on null totals** — **FIXED** — `quotes.ts:36-39,113,120` `moneyOrZero`; page guards `Number.isFinite`.
- **H9 — `completeReceiptUpload` trusts client path** — **FIXED** — verified against `receipt_upload_intents` row, else object deleted and rejected.
- **H10 — expense VAT can exceed gross** — **FIXED** — `expenses.ts:102-107` superRefine.
- **H11 — fabricated £0 category budgets** — **FIXED** — sidebar removed.
- **H12 — mileage trip create/update non-atomic** — **FIXED** — transactional RPCs (migration `20260708000016`).
- **H13 — parking refund selects non-existent columns** — **FIXED** — `refundActions.ts:102-109`.
- **H14 — parking status audit with no actor** — **FIXED** — auth + user in audit log.
- **H15 — rota settings no audit log** — **FIXED** — `rota-settings.ts:102`.
- **H16 — phantom auto-accept audit rows** — **FIXED** — scoped update + skip when no row transitioned.
- **H17 — AI menu actions unauthenticated OpenAI spend** — **FIXED** — permission checks at `ai-menu-parsing.ts:91,298`.
- **H18 — GP analysis silently drops un-priced ingredients** — **FIXED** — `missingCostItems` warnings surfaced.
- **H20 — deposit-timeout cron cancels valid holds** — **FIXED** — `hold_expires_at` filters + race guard.
- **H21 — BOH delete/cancel no audit** — **FIXED** — `logAuditEvent` on PATCH/DELETE.
- **H22 — `getClientBalance` capped at 50 invoices** — **FIXED** — dedicated unbounded balance query.
- **H23 — `getHolidayUsage` IDOR** — **FIXED** — permission + own-record fallback.
- **H24 — leave counts weekends against allowance** — **FIXED** — `working-days.ts:24-34` excludes weekends + per-employee non-working days.
- **H25 — timeclock kiosk no identity verification** — **FIXED** — 4-digit PIN verified server-side against `timeclock_pin_hash`.
- **H26 — avatar upload no validation** — **FIXED** — size/MIME/magic-byte checks.
- **H27 — GDPR export queries wrong identifier space** — **FIXED** — resolves customers by email first; errors surfaced.
- **H28 — payroll period actions no RBAC** — **FIXED** — `assertPayrollPeriodAccess`.
- **H29 — pay-band/override/budget reads expose pay data** — **FIXED** — gated behind `payroll:view`/`settings:manage`.
- **H30 — candidate cannot rebook after cancel** — **FIXED** — cancel clears `booking_token_used_at`.
- **H31 — orphaned calendar event on cancel** — **FIXED** — deletion pass in `retryRecruitmentCalendarSync`.
- **H32 — role-permission changes don't invalidate caches** — **FIXED** — `revalidateUserPermissionTags` for all holders.
- **H33 — privilege escalation via `assignPermissionsToRole`** — **FIXED** — assignable set restricted to actor's own permissions.
- **H34 — RBAC delete-then-insert wipe risk** — **FIXED** — atomic replace RPCs.
- **H35 — money-moving routes behind read scope** — **FIXED** — all four create/capture routes require `payments:capture`.
- **H37 — parking capture webhook no amount check** — **FIXED** — amount+currency compared, throws on mismatch.
- **H38 — Resend webhook no idempotency** — **FIXED** — `claimResendWebhook` keyed on `svix_id`.
- H19 & H36 — dropped by the original verifier (`isReal: false`); not re-verified.

## Cross-cutting themes

- **1. Server actions missing RBAC** — mostly resolved. Residual: `getCustomerList` (`customers.ts:61`) still has no `checkUserPermission` — RLS-backstopped standards deviation.
- **2. Timezone-incorrect date arithmetic** — money boundaries fixed; ~10 raw `setHours(0,...)` display-path uses persist (`rota/dashboard/page.tsx:21`, `employee-birthdays.ts:35`, `private-bookings/CalendarView.tsx:80`, `cashing-up-pdf-template.ts:34`) — low severity only. `calculateRefundTier` in `src/lib/table-bookings/refunds.ts:19-22` is now dead code (no importers).
- **3. Missing audit logging** — partially resolved. Still open: `saveOnboardingSection` (`employeeInvite.ts`) writes NI/bank/health PII with zero `logAuditEvent` calls.
- **4. Non-atomic multi-step writes** — largely resolved (mileage, RBAC, recruitment RPCs).
- **5. Missing optimistic-concurrency guards** — largely resolved (migration `20260708000027`).
- **6. PayPal correctness gaps** — resolved for cited items; currency parameterised in `src/lib/paypal.ts`.
- **7. Hand-rolled UI bypassing @/ds** — still applies (low): `ExpenseForm.tsx` raw inputs; `window.confirm` in `SquareImageUpload.tsx:110`, `SmsQueueActionForm.tsx:70`.
- **8. Dead duplicate clients** — resolved (all cited files deleted).
- **9. Swallowed errors** — partially resolved (spot check).

## Summary counts

**0 still open / 37 fixed / 0 partial / 0 unverifiable** (1 CRITICAL + 36 live HIGH).

Notes: (1) the `20260708xxxxxx` migration series looks like a deliberate remediation batch. (2) DB-level fixes are verified in repo migrations only — production application should be confirmed against prod migration history. (3) Residual open work: `saveOnboardingSection` audit logging, `getCustomerList` RBAC deviation, display-level raw dates, expense-form UI.
