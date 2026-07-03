# Frontend handoff — Staff Triage Inbox (PR2, review feedback)

## Files created (only these — no other files edited)
1. `src/app/(authenticated)/feedback-inbox/page.tsx` — server component
2. `src/app/(authenticated)/feedback-inbox/FeedbackInboxClient.tsx` — `'use client'`

## What was built
- **page.tsx**
  - `checkUserPermission('feedback','view')` → `redirect('/unauthorized')` on false (matches short-links pattern exactly).
  - `checkUserPermission('feedback','manage')` → passed as `canManage`.
  - Calls `getReviewFeedbackList()`, unwraps `{ success, data }` vs `{ error }`, passes `initialItems`, `canManage`, and `loadError` to the client.
  - Uses DS `PageHeader` (title "Feedback"). Dates formatted with `formatDateInLondon`.
- **FeedbackInboxClient.tsx**
  - Props: `{ initialItems: ReviewFeedbackItem[]; canManage: boolean; loadError?: string | null }`.
  - DS `Table` (semantic `<thead>`/`<th scope="col">` via DS `TableHead`) with columns: Date, Rating, Comments, Contact, Status.
  - Rating rendered as filled/empty stars + `N/5` text, with `role="img"` + `aria-label`.
  - Contact column shows name/email/phone **only when `contactConsent === true`**, else muted "No contact details" (also falls back to that label if consent true but all fields empty). Email/phone are mailto:/tel: links.
  - Comments wrap/break (overrides DS default `whitespace-nowrap`); empty comment shows muted "No comment".
  - `canManage === true`: per-row DS `Select` (new/in_progress/resolved/dismissed) with optimistic update + rollback on failure, and DS `Textarea` + "Save notes" `Button` (disabled until dirty). Both call `updateReviewFeedbackStatus({ id, status, staffNotes })`, toast via `react-hot-toast`, update local state, and `router.refresh()`.
  - `canManage === false`: status is read-only DS `Badge` (tone by status) + read-only notes text. No controls rendered.
  - Empty state: friendly message with DS `message` icon.
  - `loadError` surfaces via DS `Alert tone="danger"`.

## Contract consumed (from backend agent's `src/app/actions/feedback.ts`)
Matched exactly: `ReviewFeedbackItem`, `getReviewFeedbackList()`, `updateReviewFeedbackStatus()`. The backend file now exists and typechecks against my imports.

## Verification
- `npx eslint` on both files with `--max-warnings=0`: **PASS (exit 0, zero warnings)**.
- `npx tsc --noEmit`: **no errors in either of my files** and none in `actions/feedback.ts`.
- Whole-project tsc shows exactly **1 error, unrelated to this feature**: `src/lib/email/event-ticket-emails.ts(154,3)` missing `ticketLines` — that file is part of the separate in-progress "event ticket types" work (item 5 outstanding per memory), not touched by me or the feedback work. It does not block the feedback inbox.

## DS/API notes for reviewers
- DS icon set has **no `star` or `inbox` icon** (`IconName` = keyof iconPaths, 48 names). Stars use Unicode ★/☆ with DS `text-warning`/`text-border`; empty state uses `message` icon.
- `Select`/`Textarea` are `forwardRef` native-prop components — used native `value`/`onChange`. `Alert` uses `tone` (I used `tone="danger"`).

## NOT done / dependencies for the parallel BACKEND agent (per file ownership)
- **RBAC**: the `feedback` module + `view`/`manage` actions must be added to `src/types/rbac.ts` **and seeded** (per lesson `reference_live_nav_file`: new RBAC modules need permission seeding, else `checkUserPermission` returns false and the page 401s for everyone).
- **Navigation**: add a sidebar entry for `/feedback-inbox` in `src/ds/shell/SidebarNav.tsx` (`NAV_GROUPS`) — the live nav file, not `AppNavigation.tsx`. Gate it on the `feedback`/`view` permission. I did not add it (not my file).
- **Migration**: review-feedback table + RLS owned by backend agent.

## Assumptions
- Route path is `/feedback-inbox` (from the mandated file location).
- `router.refresh()` is called after each mutation to keep server data fresh; local optimistic state gives instant UI feedback in case refresh is a no-op without a full server re-render.
