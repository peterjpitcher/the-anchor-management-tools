# Design Tokens Programme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the implement-plan skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tick boxes in THIS file as work lands and commit the ticks with the work.

**Goal:** Make every staff screen, guest page, email and PDF use one set of design tokens, fix every defect found by the 18 September 2026 audit, and add a guard so the drift cannot come back.

**Architecture:** Repair the token system first (globals.css `@theme`, `cn()`), then add a ratcheting guard test, then fix the shared design-system components (one change reaches 150+ screens), then run a mechanical codemod for value-equal swaps, then area-by-area passes for the judgement calls, then a shared colour module for emails and PDFs, then docs. Each PR below is independently deployable and ships to production on its own.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS 4.3 (CSS-first `@theme` in `src/app/globals.css`), tailwind-merge 3.5 via `cn()` in `src/lib/utils.ts`, Vitest (jsdom), react-hot-toast, design system barrel `@/ds` (`src/ds/`).

**Spec:** `docs/reviews/2026-09-18-design-tokens-audit.md` (the audit report). Machine-readable findings from every audit agent, with file:line examples, are in `tasks/design-tokens/audit-results.json` (keys: `token-system-inventory`, `tailwind-compile-check`, `audit:<area>`, `verify:canonical-mapping`, `verify:adversarial`). If that JSON is ever missing, regenerate it from the workflow journal at `/Users/peterpitcher/.claude/projects/-Users-peterpitcher-Cursor-OJ-AnchorManagementTools/3bc29337-8060-43ac-be29-d1417ef10626/subagents/workflows/wf_dc45f419-8e5/journal.jsonl` (one `{"type":"result"}` line per agent).

---

## RESUME HERE (read this first after any context reset)

1. Work ONLY in the worktree `/Users/peterpitcher/Cursor/OJ-AMS-design-tokens`. Never edit the primary directory `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`: a parallel session keeps uncommitted work there, and a branch checkout there has destroyed work before.
2. Branch: `refactor/design-tokens` (no upstream on purpose; never `git push` without an explicit refspec). Each PR below is a set of commits on this branch, shipped with procedure P-SHIP (fast-forward push `HEAD:main`).
3. Find the first unticked PR in the **Tracker** and continue from its first unticked step.
4. Load Node 20 in the same Bash call as any gate: `source ~/.nvm/nvm.sh >/dev/null 2>&1 && nvm use >/dev/null 2>&1`. The shell default is Node 26.
5. Use native Bash (not ctx_execute) for greps inside this worktree; the sandbox cannot see worktree files reliably.
6. Never `Write` over `tasks/todo.md` or `tasks/lessons.md`; append with Edit only.
7. Record every assumption in the commit message. No em dashes anywhere (a hook blocks them).

## Tracker

| PR | Title | Status | Commit(s) | Deployment |
|---|---|---|---|---|
| PR-00 | Plan, audit report and findings committed | [x] | 5cfdbea1 | shipped with PR-01 |
| PR-01 | Token system and `cn()` repair | [x] | dc84d8cc, f45155db | dpl_4i8mu8Q23pukm9haq4nYUQJkk2WY, live 18 Sep 12:03 |
| PR-02 | Design-token guard test (ratchet) | [x] | 2a3e7976 | dpl_CkErfQyuuNaakVR5NKycj2yX41gc, live 18 Sep 12:12 |
| PR-03 | Global CSS clean-up and legacy variables | [x] | 119bbd4d | dpl_DithYX9NAWfeJwHmfjfZUXpZivfC, live 18 Sep 12:25 |
| PR-04 | Toasts, JS token accessors, charts, avatars | [x] | 87845543 | dpl_DKe52tLKAs7YikBe4RiZo5iQFN4d, live 18 Sep 13:13 |
| PR-05 | DS primitives and compat wrappers | [x] | see git log | shipped with PR-06 |
| PR-06 | DS composites and app shell | [ ] | | |
| PR-07 | Codemod step A (value-equal swaps) | [ ] | | |
| PR-08 | Codemod step B (secondary greys darken) | [ ] | | |
| PR-09 | Area: guest pages, sign-in, recruitment booking, invoice portal | [ ] | | |
| PR-10 | Area: FOH, BOH, table bookings, vouchers, timeclock, kiosk, parking | [ ] | | |
| PR-11 | Area: employee onboarding and staff portal | [ ] | | |
| PR-12 | Area: private bookings, customers, events, messages, marketing, short links | [ ] | | |
| PR-13 | Area: employees, roles, users, profile, rota, checklists, maintenance, recruitment | [ ] | | |
| PR-14 | Area: invoices, quotes, OJ projects, expenses, mileage, cashing up, receipts, MGD, dashboard | [ ] | | |
| PR-15 | Area: settings and menu management | [ ] | | |
| PR-16 | Brand colour module and staff emails | [ ] | | |
| PR-17 | Guest emails | [ ] | | |
| PR-18 | PDFs, printable HTML, `/auth/confirm`, shared category palette | [ ] | | |
| PR-19 | Living style guide, standards docs, agent rules, tidy-up | [ ] | | |

## Owner decisions (18 September 2026, all answered "yes")

- **D1** Fix everything the audit found, in the order of this plan, shipping each PR when green.
- **D2** One brand green `#006A4E` (`primary`) for every staff primary button, active tab, sub-navigation and link. Blue links become green. The staff portal's black buttons become primary. SectionNav stops using the Anchor guest green and gold.
- **D3** Secondary grey text and labels may get slightly darker app-wide in one release (`text-gray-500` to `text-text-muted`, `text-gray-700` to `text-text`).
- **D4** Booking status colours everywhere (badges, FOH timeline blocks, BOH, booking detail, customer page): Booked = primary, Seated = success, Pending payment = warning, No-show = danger, Cancelled, Left and Completed = neutral.
- **D5** Vouchers use one map everywhere, the ledger's words and colours: "Issued" = info (blue), "Redeemed" = success (green). FOH's "Active" wording goes.
- **D6** FOH, BOH, timeclock and vouchers FOH on the bar iPad: minimum text size 10px and minimum touch target 44px.
- **D7** Dark mode is officially dropped: delete every `dark:` class, ban it in the guard, remove it from the standards doc.
- **D8** Guest emails use the guest pages' Anchor palette (green `#005131`, primary button gold `#8b6914` with hover `#6f5410`, exactly as `GuestButton` primary). Staff emails use the app brand green `#006A4E`.
- **D9** `/recruitment/book/[token]` moves to the guest theme (GuestShell and guest tokens).
- **D10** `/invoice-portal/[token]` carries Orange Jelly branding instead of the Anchor guest shell.

## Design decisions made during planning (assumptions; quote them in the relevant commit messages)

- **A1 Orange Jelly branding (D10).** Orange Jelly has no colour system yet: `docs/design/brief-orange-jelly.md` is a brief asking a designer to create one, and the only asset is `public/logo-oj.jpg`. So the invoice portal gets the OJ logo, the name "Orange Jelly Limited" and the legal line from `src/lib/company-details.ts` on a neutral shell built from staff tokens. No Orange Jelly colours are invented. Revisit when the OJ house style lands.
- **A2 One label style.** DS `Field` (12px, uppercase, `tracking-wider`, `text-text-muted`) is used 607 times against 280 for the 13px sentence-case label built into `Input`/`Select`/`Textarea`. The built-in labels adopt Field's classes.
- **A3 Hint text.** DS hints move from `text-text-subtle` (2.5:1, fails AA) to the new `text-text-soft` (4.8:1).
- **A4 SectionNav keeps its folder-tab shape** (it is section-level navigation, distinct from in-page `Tabs`) but uses staff tokens: inactive `bg-surface border-border text-text-muted hover:bg-surface-hover hover:text-text`, active `bg-primary border-primary text-primary-fg`.
- **A5 One in-page tab style:** DS `Tabs` (brand underline). `src/ds/compat/TabNav.tsx` renders the same look.
- **A6 One table style:** DS `Table` (small uppercase `text-text-muted` header on `bg-surface-2`). `DataTable` is restyled to match it; its internals are not rebuilt.
- **A7 One page chrome:** `PageLayout` adopts `PageHeader`'s look (warm `bg-bg` page, same title size and weight). It keeps a `headerVariant="dark"` style for the FOH kiosk header (`src/app/(authenticated)/table-bookings/foh/page.tsx:67` relies on the grey band today).
- **A8 One focus pattern:** controls use `focus-visible:outline-hidden focus-visible:shadow-ring`, or `focus-visible:shadow-ring-inset` when the control sits in an overflow-hidden or scrolling container that would clip the outer ring (accordion items, tab strips, table headers; added 18 Sep during PR-05); text fields use `focus:border-border-focus focus:shadow-ring` (error state: `focus:border-danger focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-danger)_20%,transparent)]`). `outline-hidden` (not `outline-none`) keeps a visible focus in Windows forced-colours mode.
- **A9 Disabled state:** `disabled:opacity-50` everywhere (60, 40, 30 and 70 normalise to 50). No token.
- **A10 Radius and shadow names stay as they are** (renaming would move 1,000+ uses again). Bare `rounded`, `rounded-2xl`, `rounded-3xl`, bare `shadow`, `shadow-md`, `shadow-xl` and `shadow-2xl` are banned by the guard and codemodded away.
- **A11 Category colours stay data where users pick them** (shift templates, calendar notes, customer labels, event categories). Static app categories (departments, dish groups, booking types in charts) use the new `cat-*` tokens. The shift and calendar option lists become one list.
- **A12 `bg-white` swaps to `bg-surface` (value-equal) but white and black stay allowed** in the guard; `text-white` is not codemodded because its meaning varies.
- **A13 `@theme` becomes `@theme static`** so every token is always emitted to `:root` (JS accessors and inline `var()` never read an empty value).

## Global Constraints

- Tailwind v4.3 CSS-first; no `tailwind.config`. Tokens live only in `src/app/globals.css`.
- Light theme only (D7). No `dark:` variants.
- Text colour on white must be at least 4.5:1: use `text-text`, `text-text-muted`, `text-text-soft`, or the status `-fg` colours. `text-text-subtle` is for placeholders, icons and decoration only. Base status colours (`text-success`, `text-warning`, `text-info`) are for icons, dots, fills and borders, not small text.
- Minimum text size 10px (`text-2xs`) on every staff screen.
- Guest pages (inside `.guest-theme`: `src/components/features/guest/*`, `src/app/g/**` and other GuestShell pages) use only `anchor-*`/`guest-*` tokens. Staff screens never use them.
- Emails and PDFs may contain literal hex, but only through the brand colour module created in PR-16.
- Render every changed email and PDF template with fixture data before shipping and fail on `undefined`, `Invalid Date`, `NaN` or a zero amount (workspace rule).
- `npm run lint` must stay at zero warnings.
- Every Vitest gate runs twice: `npm test` (Europe/London) and `npm run test:utc`.
- Server actions, data, permissions and behaviour do not change in this programme. If a styling change needs a behaviour change, stop and record it under Parked.

---

## Canonical token set (the ONLY new or changed names any task may use)

Existing tokens keep their names except where stated. After PR-01 the `@theme static` block contains, in addition to what is there today:

| Group | Token | Value | Utility examples |
|---|---|---|---|
| Neutral text | `--color-text-soft` | `#78716c` (4.8:1) | `text-text-soft` |
| Focus | `--color-border-focus` | `var(--color-brand-600)` (was `#34d399`, 1.9:1) | `focus:border-border-focus` |
| Primary (now references) | `--color-primary` | `var(--color-brand-600)` | `bg-primary` |
| | `--color-primary-hover` | `var(--color-brand-700)` | `hover:bg-primary-hover` |
| | `--color-primary-soft` | `var(--color-brand-50)` | `bg-primary-soft` |
| | `--color-primary-soft-fg` | `var(--color-brand-800)` | `text-primary-soft-fg` |
| Status borders | `--color-success-border` | `#bbf7d0` | `border-success-border` |
| | `--color-warning-border` | `#fde68a` | `border-warning-border` |
| | `--color-danger-border` | `#fecaca` | `border-danger-border` |
| | `--color-info-border` | `#bae6fd` | `border-info-border` |
| Overlay | `--color-overlay` | `rgb(12 10 9 / 0.5)` | `bg-overlay` |
| Focus ring, inset | `--shadow-ring-inset` | `inset 0 0 0 2px var(--color-border-focus)` | `focus-visible:shadow-ring-inset` (added during PR-05) |
| On dark surfaces | `--color-on-dark` | `#ffffff` | `text-on-dark` |
| | `--color-on-dark-muted` | `rgb(255 255 255 / 0.72)` | `text-on-dark-muted` |
| | `--color-on-dark-subtle` | `rgb(255 255 255 / 0.4)` | |
| | `--color-on-dark-hover` | `rgb(255 255 255 / 0.08)` | `hover:bg-on-dark-hover` |
| | `--color-on-dark-active` | `rgb(255 255 255 / 0.16)` | `bg-on-dark-active` |
| | `--color-on-dark-border` | `rgb(255 255 255 / 0.12)` | `border-on-dark-border` |
| Sidebar (now references) | `--color-sidebar-fg`, `-fg-muted`, `-active-bg`, `-hover-bg`, `-border` | `var(--color-on-dark...)` equivalents | unchanged names |
| Sidebar duplicate removed | `--color-sidebar-bg` | deleted (5 uses become `bg-sidebar`) | |
| Categories | `--color-cat-1` / `-soft` / `-fg` | `#0284c7` / `#e0f2fe` / `#075985` (sky) | `bg-cat-1-soft text-cat-1-fg` |
| | `--color-cat-2` | `#4f46e5` / `#e0e7ff` / `#3730a3` (indigo) | |
| | `--color-cat-3` | `#7c3aed` / `#ede9fe` / `#5b21b6` (violet) | |
| | `--color-cat-4` | `#db2777` / `#fce7f3` / `#9d174d` (pink) | |
| | `--color-cat-5` | `#ea580c` / `#ffedd5` / `#9a3412` (orange) | |
| | `--color-cat-6` | `#d97706` / `#fef3c7` / `#92400e` (amber) | |
| | `--color-cat-7` | `#0d9488` / `#ccfbf1` / `#115e59` (teal) | |
| | `--color-cat-8` | `#57534e` / `#f5f5f4` / `#292524` (stone) | |
| Charts | `--color-chart-1` .. `-6` | `var(--color-brand-600)`, `var(--color-cat-1)`, `var(--color-cat-6)`, `var(--color-cat-3)`, `var(--color-cat-4)`, `var(--color-cat-7)` | `fill-chart-1`, `var(--color-chart-1)` |
| Avatars | `--color-avatar-1` .. `-6` | `#b91c1c`, `#c2410c`, `#a16207`, `#15803d`, `#1d4ed8`, `#6d28d9` (white text passes 4.5:1 on all) | `bg-avatar-1` |
| Type | `--text-2xs` | `10px`, line height `14px` | `text-2xs` |
| | `--text-meta` | `11px`, line height `16px` | `text-meta` |
| | `--text-ui` | `13px`, line height `18px` | `text-ui` |
| Spacing | `--spacing-cell-y` | `10px` (renamed from `--spacing-row-h`) | `py-cell-y` |
| | `--spacing-row-h-lg` | deleted (0 uses) | |
| | `--spacing-touch` | `44px` | `min-h-touch min-w-touch` |
| | `--spacing-shell-pad-top` / `-x` / `-bottom` | `22px` / `28px` / `40px` | `shell:pt-shell-pad-top` |
| Fonts | `--font-sans` | `var(--font-inter), 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` | |
| | `--font-mono` | `var(--font-jetbrains), 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace` | |

Nothing else is added. Parked (deliberately not built): z-index scale, property-specific colour namespaces (`text-muted` instead of `text-text-muted`), staff leading/tracking tokens.

---

## Shared procedures

### P-GATES (run before every commit that changes code)

```bash
cd /Users/peterpitcher/Cursor/OJ-AMS-design-tokens
source ~/.nvm/nvm.sh >/dev/null 2>&1 && nvm use >/dev/null 2>&1 && node --version   # expect v20.x
npm run lint
rm -f tsconfig.tsbuildinfo && NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit
npm test
npm run test:utc
```

Before a ship, also run a cold build (no dev server may be running against this directory):

```bash
ps aux | grep next-server | grep -v grep   # must print nothing for this worktree
rm -rf .next && NODE_OPTIONS="--max-old-space-size=12288" npm run build   # the default heap SIGABRTs after "Compiled successfully"
```

### P-COMMIT

Stage only named files (`git add <path> ...`, never `-A` or `.`), check `git diff --cached --name-only`, commit with a conventional message that explains why and lists assumptions, ending with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

### P-SHIP (each PR, once its gates are green)

```bash
git fetch origin --quiet
git rebase origin/main            # re-run P-GATES in full if this brought new commits
git push origin HEAD:main         # fast-forward only; if rejected, fetch, rebase, gates, retry
git rev-parse HEAD                # note the sha
gh api repos/peterjpitcher/the-anchor-management-tools/commits/$(git rev-parse HEAD)/status --jq '{state, statuses: [.statuses[] | {context, state, target_url}]}'
```

Poll the status until the `Vercel` context is `success` (build takes 6 to 8 minutes). Then prove the alias moved: fetch `https://management.orangejelly.co.uk/auth/login` and the new deployment URL, compare the `dpl_...` id on a `/_next/` asset. Record the sha and `dpl_` id in the Tracker. If no deployment appears after 10 minutes, see memory `reference_vercel_autodeploy_not_firing` (manual `vercel --prod` only from this clean worktree when it equals origin/main).

### P-VISUAL (for any PR that changes how something looks)

Authenticated pages cannot be logged into by Claude. Use the harness technique:

1. Create `src/app/(timeclock)/timeclock/token-preview/page.tsx` (`'use client'`; `/timeclock` is already a public prefix) rendering the real components touched by the PR with mock props (`as unknown as T` casts are fine).
2. `npm run dev -- -p 3005` in this worktree, then in the in-app browser: resize first (`resize_window` preset `mobile`, then desktop), then navigate with `javascript_tool` `location.href = 'http://localhost:3005/timeclock/token-preview'`.
3. Check: no horizontal overflow (`document.documentElement.scrollWidth <= innerWidth`), computed colours match tokens (`getComputedStyle`), screenshot desktop and 375px.
4. DELETE the harness directory before committing, then `rm -rf .next`. The harness is never committed.
5. Anything not rendered in the harness is reported to the owner as "not checked in a browser".

### P-AGENTS (when a Workflow edits files in parallel)

- Give each agent a disjoint file list. Agents never run `npm run build` or `tsc`; the orchestrator runs P-GATES after.
- After the run: `git status --porcelain` and diff every changed file against the owned list. Revert strays with `git checkout -- <file>` after saving their diff to the scratchpad.
- Parallel agents cannot agree on names: they may only use names from the Canonical token set and the shared maps defined in this plan.

### P-SWEEP (before calling any PR done)

For each defect class the PR fixes, grep the whole of `src/` (and `tests/`) for other instances and say in the commit message what the sweep cleared.

---

## PR-00: Plan, audit report and findings

- [x] Commit `tasks/plan-2026-09-18-design-tokens.md`, `tasks/design-tokens/audit-results.json` and `docs/reviews/2026-09-18-design-tokens-audit.md` on `refactor/design-tokens` (P-COMMIT, message `docs: add design token audit and implementation plan`).
- [x] Delete the untracked copy `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/reviews/2026-09-18-design-tokens-audit.md` from the primary directory (created by this session, so it is ours to remove) so a later checkout of main there does not collide.
- [x] Ships together with PR-01 (no deploy for docs alone).

## PR-01: Token system and `cn()` repair

**Files:**
- Modify: `src/app/globals.css` (the `@theme` block, lines 8 to 172)
- Modify: `src/lib/utils.ts:1-10` (`cn`)
- Modify: `src/ds/composites/Table.tsx:167` and `src/app/(authenticated)/employees/_components/EmployeesClient.tsx:235` (row-h rename)
- Modify: the 5 files using `sidebar-bg` (find with `grep -rn "sidebar-bg" src`)
- Create: `tests/lib/cn.test.ts`

**Interfaces:** Produces every token in the Canonical token set and a token-aware `cn(...inputs: ClassValue[]): string`. Every later PR depends on both.

- [x] **Step 1: Write the failing test** `tests/lib/cn.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn knows the design tokens', () => {
  it('lets a later arbitrary shadow override shadow-ring (DS error halo)', () => {
    expect(cn('focus:shadow-ring', 'focus:shadow-[0_0_0_3px_red]')).toBe('focus:shadow-[0_0_0_3px_red]')
  })
  it('treats custom radii as radii', () => {
    expect(cn('rounded-md', 'rounded-pill')).toBe('rounded-pill')
    expect(cn('rounded-pill', 'rounded-md')).toBe('rounded-md')
    expect(cn('rounded-lg', 'rounded-default')).toBe('rounded-default')
  })
  it('treats custom shadows as shadows, not colours', () => {
    expect(cn('shadow-sm', 'shadow-default')).toBe('shadow-default')
    expect(cn('shadow-default', 'shadow-black/10')).toBe('shadow-default shadow-black/10')
  })
  it('treats custom spacing as spacing', () => {
    expect(cn('h-btn-h', 'h-9')).toBe('h-9')
    expect(cn('p-pad-card', 'p-4')).toBe('p-4')
    expect(cn('min-h-touch', 'min-h-10')).toBe('min-h-10')
  })
  it('treats custom text sizes as font sizes, not colours', () => {
    expect(cn('text-sm', 'text-ui')).toBe('text-ui')
    expect(cn('text-ui', 'text-danger')).toBe('text-ui text-danger')
    expect(cn('text-meta', 'text-text-muted')).toBe('text-meta text-text-muted')
    expect(cn('text-2xs', 'text-xs')).toBe('text-xs')
  })
  it('still merges colour tokens', () => {
    expect(cn('text-text-muted', 'text-danger')).toBe('text-danger')
    expect(cn('bg-surface', 'bg-primary')).toBe('bg-primary')
    expect(cn('border-border', 'border-danger-border')).toBe('border-danger-border')
  })
})
```

- [x] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/lib/cn.test.ts`
Expected: FAIL on the shadow-ring, radius, spacing and text-size cases.

- [x] **Step 3: Make `cn` token-aware** in `src/lib/utils.ts` (keep the phone imports and every other export unchanged):

```ts
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge only knows Tailwind's default scale. Without this it reads custom
// tokens such as shadow-ring or rounded-pill as colours, keeps two conflicting classes,
// and lets whichever Tailwind emits last win: that is how every DS field in an error
// state showed the green focus halo instead of the red one (audit, 18 Sep 2026).
// Keep these lists in step with the @theme block in src/app/globals.css.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['2xs', 'meta', 'ui'],
      radius: ['default', 'pill', 'guest-field', 'guest-card'],
      shadow: ['default', 'ring', 'guest-card', 'guest-gold', 'guest-focus'],
      spacing: [
        'cell-y', 'input-h', 'btn-h', 'btn-h-sm', 'btn-h-lg', 'sidebar-expanded', 'sidebar-collapsed',
        'topbar', 'logo-row', 'pad-card', 'page-shell-pad-y', 'touch', 'shell-pad-top', 'shell-pad-x',
        'shell-pad-bottom',
      ],
      ease: ['default'],
      breakpoint: ['shell'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [x] **Step 4: Run the test and see it pass**

Run: `npx vitest run tests/lib/cn.test.ts`
Expected: PASS. If the text-size cases fail, confirm the tailwind-merge 3.5 theme key for font size in `node_modules/tailwind-merge/dist/types.d.ts` (`text`) before changing anything else.

- [x] **Step 5: Rewrite the `@theme` block** in `src/app/globals.css`:
  - change `@theme {` to `@theme static {` (A13);
  - make `--color-primary`, `-primary-hover`, `-primary-soft`, `-primary-soft-fg` reference the brand scale (values in the Canonical table; do not change the brand scale values);
  - set `--color-border-focus: var(--color-brand-600);`;
  - add `--color-text-soft`, the four status borders, `--color-overlay`, the six `--color-on-dark*` tokens, `--color-cat-1..8` with `-soft` and `-fg`, `--color-chart-1..6`, `--color-avatar-1..6`, exactly as in the Canonical table;
  - point `--color-sidebar-fg`, `-fg-muted`, `-active-bg`, `-hover-bg`, `-border` at the `on-dark` equivalents; delete `--color-sidebar-bg`;
  - add type tokens with line heights:

```css
  /* Type sizes the app actually uses. Tailwind's own xs (12px), sm (14px) and base (16px)
     stay; these fill the gaps. 10px is the floor (owner decision, 18 Sep 2026). */
  --text-2xs: 10px;
  --text-2xs--line-height: 14px;
  --text-meta: 11px;
  --text-meta--line-height: 16px;
  --text-ui: 13px;
  --text-ui--line-height: 18px;
```

  - rename `--spacing-row-h` to `--spacing-cell-y` (same 10px) and delete `--spacing-row-h-lg`; add `--spacing-touch: 44px;` and the three `--spacing-shell-pad-*` tokens;
  - point the fonts at next/font's variables (Canonical table);
  - update the comment "Semantic, light theme (v1 only)" to "Semantic, light theme only (dark mode dropped 18 Sep 2026)";
  - update the guest comment: guest tokens are consumed by `src/components/features/guest/*` and every page rendered inside GuestShell, never by staff screens.
- [x] **Step 6: Update the renamed and removed tokens' callers:** `py-[var(--spacing-row-h)]` becomes `py-cell-y` in `Table.tsx:167`; delete the redundant `--spacing-row-h` override in `EmployeesClient.tsx:235`; `bg-sidebar-bg` (5 uses) becomes `bg-sidebar`. Then `grep -rn "row-h\|sidebar-bg" src tests` must return nothing.
- [x] **Step 7: Prove the compiled CSS** with a scratch script in the session scratchpad using `node_modules/@tailwindcss/node` `compile()`: `text-ui`, `text-meta`, `text-2xs`, `bg-overlay`, `border-danger-border`, `bg-cat-3-soft`, `bg-avatar-2`, `min-h-touch`, `py-cell-y`, `max-shell:hidden` all emit CSS, and `:root` contains `--color-brand-600` and `--color-primary` even when no candidate uses them.
- [x] **Step 8:** P-GATES, then P-COMMIT: `fix(design-tokens): add missing tokens and teach cn() the custom scale`. Say in the body: the red error halo on DS fields is fixed by the cn change; focus borders become brand green (was 1.9:1 mint).
- [x] **Step 9: P-VISUAL** with DS `Input`, `Select`, `Textarea` in normal, focused and error states: the error focus halo is red.
- [x] **Step 10:** P-SHIP (includes PR-00). Tick PR-00 and PR-01 in the Tracker.

## PR-02: Design-token guard test (ratchet)

**Files:**
- Create: `tests/guards/design-tokens.test.ts`
- Create: `tests/guards/design-tokens.baseline.json` (generated)

**Interfaces:** Produces the rule ids used in every later PR's acceptance check: `raw-palette`, `hex-colour`, `bare-rounded`, `off-scale-radius`, `off-scale-shadow`, `dark-variant`, `px-text-size`, `legacy-hsl-var`, `raw-820-breakpoint`, `sidebar-outside-shell`.

- [x] **Step 1: Write the guard** `tests/guards/design-tokens.test.ts`, modelled on `tests/guards/row-cap.test.ts` (same `sourceFiles` walker over `src/`, skipping `__tests__`, `__mocks__`, `*.test.*`, `*.spec.*`):

```ts
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * The 18 September 2026 audit found about 4,600 raw Tailwind colour classes, 1,100 hand-typed
 * sizes and 1,250 hand-typed hex values across the app, against a complete token set in
 * src/app/globals.css. Nothing stopped new ones being added. This guard is a ratchet: every
 * file may have at most its baseline count for each rule, and the baseline may only go down.
 *
 * Fixed some? Lower the baseline:
 *   UPDATE_DESIGN_TOKEN_BASELINE=1 npx vitest run tests/guards/design-tokens.test.ts
 * The update refuses to raise any count.
 */
const SRC = join(process.cwd(), 'src')
const BASELINE_PATH = join(process.cwd(), 'tests/guards/design-tokens.baseline.json')

const PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const VARIANTS = '(?:[a-z0-9@\\[\\]=&>*_.-]+:)*'

type Rule = { id: string; pattern: RegExp; applies: (file: string) => boolean; why: string }

const everywhere = () => true
const RULES: Rule[] = [
  { id: 'raw-palette', applies: everywhere, why: 'Use a token (text-text-muted, border-border, bg-danger-soft ...) instead of a raw Tailwind colour.',
    pattern: new RegExp(`(?<![\\w-])${VARIANTS}(?:bg|text|border|border-[trblxy]|ring|ring-offset|divide|from|to|via|fill|stroke|outline|placeholder|accent|decoration|shadow)-(?:${PALETTE})-\\d{2,3}(?:\\/\\d+)?(?![\\w-])`, 'g') },
  { id: 'hex-colour', applies: (f) => !ACCEPTED_HEX.some((a) => a.file === f), why: 'Hex belongs in globals.css or, for emails and PDFs, in src/lib/brand/palette.ts.',
    pattern: /(?<=['"`\[(\s:,])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?=['"`\]),;\s])/g },
  { id: 'bare-rounded', applies: everywhere, why: 'Bare rounded is 4px, below the scale. Use rounded-sm (6px) or a DS component.',
    pattern: new RegExp(`(?<![\\w-])${VARIANTS}rounded(?![\\w\\[-])`, 'g') },
  { id: 'off-scale-radius', applies: everywhere, why: 'rounded-2xl (16px) is smaller than rounded-xl (20px) here. Use sm, default, md, lg, xl or pill.',
    pattern: new RegExp(`(?<![\\w-])${VARIANTS}rounded-(?:2xl|3xl)(?![\\w-])`, 'g') },
  { id: 'off-scale-shadow', applies: everywhere, why: 'Use shadow-xs, shadow-sm, shadow-default, shadow-lg or shadow-ring.',
    pattern: new RegExp(`(?<![\\w-])${VARIANTS}shadow(?:-md|-xl|-2xl)?(?![\\w\\[/-])`, 'g') },
  { id: 'dark-variant', applies: everywhere, why: 'Dark mode was dropped on 18 Sep 2026.',
    pattern: /(?<![\w-])dark:/g },
  { id: 'px-text-size', applies: everywhere, why: 'Use text-2xs (10), text-meta (11), text-xs (12), text-ui (13), text-sm (14) or text-base (16).',
    pattern: /(?<![\w-])(?:[a-z0-9-]+:)*text-\[(?:[0-9]|1[0-6])(?:\.\d+)?px\]/g },
  { id: 'legacy-hsl-var', applies: everywhere, why: 'The shadcn HSL variables are gone. Use token utilities.',
    pattern: /hsl\(var\(--/g },
  { id: 'raw-820-breakpoint', applies: everywhere, why: 'Use max-shell: or shell:, which match the 820px mobile layer exactly.',
    pattern: /(?:max|min)-\[82[01]px\]:/g },
  { id: 'sidebar-outside-shell', applies: (f) => !f.startsWith('src/ds/shell/'), why: 'Sidebar tokens are for the shell. Buttons use Button variant="primary".',
    pattern: new RegExp(`(?<![\\w-])${VARIANTS}(?:bg|text|border|ring)-sidebar(?:\\/\\d+)?(?![\\w-])`, 'g') },
]

/** Files where literal hex is legitimate, each with the reason. */
const ACCEPTED_HEX: Array<{ file: string; reason: string }> = [
  // Populated in Step 2 only for files whose hex is data or required by the medium,
  // e.g. user-selectable colour option lists and the PayPal SDK style prop.
]
```

  Then the counting, comparison and update logic:

```ts
type Counts = Record<string, Record<string, number>>

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === '__mocks__') continue
      sourceFiles(full, found)
    } else if (/\.(tsx?|css)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      found.push(full)
    }
  }
  return found
}

/**
 * Comments are prose ("rounded to the nearest penny", "drop shadow"), not classes, so they
 * are removed before counting. The line-comment pattern skips `://` so URLs survive.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function countAll(): Counts {
  const counts: Counts = {}
  for (const full of sourceFiles(SRC)) {
    const file = relative(process.cwd(), full)
    if (file === 'src/app/globals.css') continue // the token source itself
    const text = stripComments(readFileSync(full, 'utf8'))
    for (const rule of RULES) {
      if (!rule.applies(file)) continue
      const n = (text.match(rule.pattern) ?? []).length
      if (n > 0) (counts[file] ??= {})[rule.id] = n
    }
  }
  return counts
}

function readBaseline(): Counts {
  try { return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Counts } catch { return {} }
}

describe('design tokens are used instead of raw values', () => {
  const actual = countAll()
  const baseline = readBaseline()

  if (process.env.UPDATE_DESIGN_TOKEN_BASELINE === '1') {
    it('writes a lower baseline', () => {
      const raised: string[] = []
      for (const [file, rules] of Object.entries(actual)) {
        for (const [rule, n] of Object.entries(rules)) {
          const allowed = baseline[file]?.[rule] ?? 0
          if (n > allowed && Object.keys(baseline).length > 0) raised.push(`${file} ${rule}: ${allowed} -> ${n}`)
        }
      }
      expect(raised, 'The baseline can only go down. Fix these instead of raising it.').toEqual([])
      const sorted = Object.fromEntries(Object.keys(actual).sort().map((f) => [f, actual[f]]))
      writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + '\n')
    })
    return
  }

  it('adds no new raw values', () => {
    const over: string[] = []
    for (const [file, rules] of Object.entries(actual)) {
      for (const [ruleId, n] of Object.entries(rules)) {
        const allowed = baseline[file]?.[ruleId] ?? 0
        if (n > allowed) {
          const rule = RULES.find((r) => r.id === ruleId)!
          over.push(`${file}: ${ruleId} ${n} (allowed ${allowed}). ${rule.why}`)
        }
      }
    }
    expect(over, 'New raw values were added. Use design tokens (see src/app/globals.css).').toEqual([])
  })

  it('has a baseline no looser than the code', () => {
    const loose: string[] = []
    for (const [file, rules] of Object.entries(baseline)) {
      for (const [ruleId, allowed] of Object.entries(rules)) {
        const n = actual[file]?.[ruleId] ?? 0
        if (n < allowed) loose.push(`${file}: ${ruleId} baseline ${allowed}, now ${n}`)
      }
    }
    expect(loose, 'Values were removed. Lower the baseline: UPDATE_DESIGN_TOKEN_BASELINE=1 npx vitest run tests/guards/design-tokens.test.ts').toEqual([])
  })
})
```

- [x] **Step 2:** Fill `ACCEPTED_HEX` with only permanently legitimate files, each with a reason: `src/lib/brand/palette.ts` (added in PR-16, list it now as the one place for email and PDF hex), the user-selectable option lists (`src/lib/rota/shift-template-colours.ts`, `src/types/event-categories.ts`, the calendar notes and customer label option lists; confirm paths with `grep -rln "#[0-9A-Fa-f]\{6\}" src`), and the PayPal SDK style prop file. Everything else is ratcheted by the baseline, not exempted.
- [x] **Step 3: Generate the first baseline:** `UPDATE_DESIGN_TOKEN_BASELINE=1 npx vitest run tests/guards/design-tokens.test.ts` (an empty baseline accepts everything once). Check the JSON totals roughly match the audit (raw-palette about 4,600).
- [x] **Step 4: Prove it bites:** temporarily add `text-gray-500` to any component, run `npx vitest run tests/guards/design-tokens.test.ts`, see "adds no new raw values" FAIL, remove it, see PASS. Remove one existing violation, see "baseline no looser" FAIL, restore it.
- [x] **Step 5:** P-GATES (both zones), P-COMMIT `test(design-tokens): add a ratcheting guard against raw colours and sizes`, P-SHIP.
- [ ] **From now on, every PR ends with** `UPDATE_DESIGN_TOKEN_BASELINE=1 npx vitest run tests/guards/design-tokens.test.ts` and commits the lowered baseline with the work. The area PRs' acceptance check is "every file in scope has zero counts except the accepted exceptions listed in the PR".

## PR-03: Global CSS clean-up and legacy variables

**Files:** `src/app/globals.css` (below `@theme`), `src/components/foh/DragConfirmationModal.tsx:62-85`, `src/components/foh/DroppableLaneTimeline.tsx:32`, `src/app/(staff-portal)/**` (markup that relied on the `.staff-portal-shell .rounded-xl` override), `src/ds/primitives/Button.tsx`, `LinkButton.tsx`, `Switch.tsx` (`max-[820px]:` to `max-shell:`).

Findings source: `audit-results.json` keys `token-system-inventory.legacy_blocks`, `.globals_css_hardcoded`, `.conflicts`, and `tailwind-compile-check.dynamic_class_hazards`.

- [x] **Default border colour.** Add the Tailwind v4 compatibility rule inside `@layer base`, so colourless borders (76 elements, near-black today) become the border token and any `border-*` colour class still wins:

```css
@layer base {
  *,
  ::after,
  ::before,
  ::backdrop,
  ::file-selector-button {
    border-color: var(--color-border);
  }
}
```

  Before shipping, check print surfaces that may rely on black lines: `grep -rln "print:" src/app` plus the BOH print sheets and table talkers. Give any line that must print black an explicit `border-text` class.
- [x] **Checkbox colour.** In the same base layer add `input[type='checkbox'], input[type='radio'] { accent-color: var(--color-primary); }` for staff screens (the guest theme's own rule at about line 1349 stays and wins inside `.guest-theme`).
- [x] **Remove the grid collapse** at about line 1095 (`[class*="md:grid-cols"] ... grid-template-columns: 1fr !important`). It forces 64 grids to one column on phones, including base `grid-cols-2`. Then fix the workaround it caused at `src/app/(authenticated)/events/[id]/EventDetailClient.tsx:1202-1206` (restore the intended `md:`/`lg:` classes and delete the misleading "Tailwind bug" comment).
- [x] **Remove the rules keyed on utility class names:** the 768px block (about lines 194 to 243: `button.text-sm:not(.sidebar-item)`, `.fixed.bottom-0`, `.flex.items-center.space-x-2`) and `td .text-sm, .employee-email` (about 259 to 278). Keep one touch-target rule tied to the shell breakpoint (the 820px layer at about 1068 to 1075 already does this).
- [x] **Delete dead CSS blocks** (no TSX uses; re-check each with `grep -rn "<class>" src` first): `.mobile-page-padding`, `.mobile-card-margin`, `.mobile-section-padding`, `.mobile-form-input`, `.mobile-form-container`, unused keyframes `toast-slide-up`, `slide-up`, `.animate-slide-up`, utilities `safe-area-pb`, `safe-area-pt`, `container-mobile`, `mobile-hide`, `mobile-only`, `desktop-hide`, `desktop-only`, `.btn-mobile`, `.btn-group-mobile`, `.form-group-mobile`, `.card-mobile`, `.table-mobile-wrapper`, `.text-mobile-base`, `.text-mobile-sm`, `.portal` and `.portal__*`, `.foh-clock*`, `.foh-only*` (first confirm `src/ds/shell/FohClockBand.tsx` and `FohClockWidget.tsx` do not use them). Keep `touch-target` and `scrollbar-hide`.
- [x] **Replace remaining hard-coded colours and sizes in component CSS** with tokens, per `token-system-inventory.globals_css_hardcoded.examples` (for example `.kiosk { color: #fff }` to `var(--color-on-dark)`, `.kstat` backgrounds to `var(--color-on-dark-hover)` and `var(--color-on-dark-border)`, `.auth__logo` and `.onboard__step-bullet` to `var(--color-primary-fg)`, `.kiosk__card--in` to `color-mix(in oklch, var(--color-brand-500) 18%, transparent)`, `.kiosk__dot--out` to `var(--color-on-dark-subtle)`, shell margins to the `--spacing-shell-pad-*` tokens, `calc(100vh - 52px)` to `calc(100vh - var(--spacing-topbar))`, radii 16px, 10px, 8px, 12px to `var(--radius-lg)`, `var(--radius-md)`, `var(--radius-default)`, `var(--radius-md)`, font sizes 13px, 11px, 10px to `var(--text-ui)`, `var(--text-meta)`, `var(--text-2xs)`).
- [x] **Remove `.staff-portal-shell .rounded-xl { border-radius: 12px }`** (about line 1190) and change the portal markup's `rounded-xl` to `rounded-lg`.
- [x] **Remove the dead `--spacing-pad-card: 14px` re-declaration** in the 820px layer (same as the base value).
- [x] **Legacy HSL block:** change `DragConfirmationModal.tsx` (`bg-[hsl(var(--card))]` to `bg-surface`, `text-[hsl(var(--foreground))]` to `text-text`, `text-[hsl(var(--muted-foreground))]` to `text-text-muted`, `hover:bg-[hsl(var(--accent))]` to `hover:bg-surface-hover`, `bg-[hsl(var(--primary))]` plus `text-[hsl(var(--primary-foreground))]` to DS `Button variant="primary"`) and `DroppableLaneTimeline.tsx:32` (`ring-[hsl(var(--primary)/0.3)]` to `ring-primary/30`), then delete the `:root` legacy block (about lines 1014 to 1037) and its comment.
- [x] **`max-[820px]:` to `max-shell:`** in `Button.tsx`, `LinkButton.tsx`, `Switch.tsx` (5 uses).
- [x] P-VISUAL at 375px, 800px and 1280px on a harness containing: a `grid grid-cols-2 md:grid-cols-4` stat grid (two columns on a phone), a raw `border-t` divider (pale), a staff checkbox (brand green), the FOH drag confirmation modal.
- [x] P-SWEEP, baseline update, P-GATES, cold build, P-COMMIT `fix(styles): remove global overrides that fought the tokens`, P-SHIP. Tell the owner: phones now show two-column stat grids where the code asked for them, and dividers on invoice and quote pages are pale instead of black.

## PR-04: Toasts, JS token accessors, charts, avatars

**Files:** `src/ds/primitives/Toast.tsx`, `src/app/layout.tsx:69`, `src/ds/tokens/index.ts`, `src/ds/composites/Chart.tsx:28,88,114`, `src/components/charts/BarChart.tsx:26,117,140,235`, `src/ds/primitives/Avatar.tsx:12-17`, `tests/ds/tokens.test.ts` (create).

- [x] **Toast:** replace `var(--color-success-surface, #f0fdf4)` style fallbacks (lines 27 to 29, 43 to 45, 58 to 60, 73 to 75) with `var(--color-<status>-soft)`, `var(--color-<status>-fg)`, `var(--color-<status>-border)`, and radius `var(--radius-default)`. Info becomes sky (info tokens), matching Alert.
- [x] **Root `<Toaster>`** in `src/app/layout.tsx`: pass `toastOptions` so direct `react-hot-toast` calls (about 70 files) look like the DS toast: `style: { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-default)', boxShadow: 'var(--shadow-lg)', fontSize: 'var(--text-ui)' }`, and `success`/`error` `iconTheme` using `var(--color-success)`/`var(--color-danger)` with `primary`/`secondary` set as the icon theme requires (hex is not needed: react-hot-toast passes these to CSS). Do not migrate the 70 callers.
- [x] **JS accessors** `src/ds/tokens/index.ts`: replace the trailing `export {};` with real exports: `export function getToken(name: string): string` (unchanged behaviour), `export const tokens = { colors, spacing, shadows, radii, easing } as const`, and `export function resolveToken(name: string, fallback: string): string` returning `getToken(name) || fallback` for canvas code. Add the missing entries (`sidebar`, `sidebarFgMuted`, `sidebarActiveBg`, `sidebarHoverBg`, `sidebarBorder`, `textSoft`, the status borders, `overlay`, `chart1`..`chart6`) and delete `sidebarBg`. Write `tests/ds/tokens.test.ts` asserting every `var(--x)` named in `tokens` exists in the `@theme` block of `src/app/globals.css` (read the file, collect `--[a-z0-9-]+:` names).
- [x] **Charts:** `Chart.tsx` `RED = '#ef4444'` becomes `'var(--color-danger)'`, `#1e293b` becomes `'var(--color-text)'`. `BarChart.tsx` canvas colours use `resolveToken('--color-border', ...)`, `'--color-text-muted'`, `'--color-text'`, `'--color-text-subtle'`, and the default bar colour `'--color-chart-1'` (fallbacks are the current token hex values, so SSR and tests behave).
- [x] **Avatar:** `AVATAR_COLORS` becomes `['bg-avatar-1', ..., 'bg-avatar-6']` (all pass 4.5:1 with white initials). `sm` size `text-[10px]` becomes `text-2xs`.
- [x] P-VISUAL (toast of each kind via both the DS toast and a direct `toast.success`, an avatar row, the bar chart), baseline update, P-GATES, P-COMMIT `fix(ds): one toast look, working token accessors, chart and avatar colours`, P-SHIP.

## PR-05: DS primitives and compat wrappers

**Files:** everything under `src/ds/primitives/` and `src/ds/compat/`. Findings: `audit-results.json["audit:ds-foundation"]` (categories, examples, hand_rolled_components) and `tailwind-compile-check.tailwind_merge_issues`.

Acceptance: the guard baseline for every file in `src/ds/primitives/` and `src/ds/compat/` is zero for every rule, except `Avatar.tsx` (none left after PR-04) and hex in `ColorSwatch`-style data props if any exist (list them in the commit).

- [x] **Button** (`Button.tsx`): `text-[13px]` to `text-ui`; `rounded-[7px]`/`rounded-[9px]` to `rounded-sm`/`rounded-default`; inline `rgba(0,0,0,.08)` shadows (line 27) to `shadow-xs`; move `sizeStyles` before `variantStyles` in the `cn()` call (lines 90 and 91) so `variant="link"` stays flush at every size (fixes `/settings/background-jobs` and the role permissions modal); focus pattern A8; `max-shell:min-h-touch` for the touch rule; `disabled:opacity-50`.
- [x] **LinkButton, IconButton, Switch, Checkbox, Radio, Segmented-like controls:** same focus pattern, radius on the scale, `max-shell:`, touch size via `min-h-touch`.
- [x] **Input, Select, Textarea:** text sizes to `text-ui`; built-in label adopts Field's classes (A2); hint text `text-text-soft` (A3); error focus shadow per A8; confirm with `tests/lib/cn.test.ts` style assertion that `cn()` of the base plus error classes keeps only the danger shadow. Implement Input's ignored `rightElement` prop (declared at `Input.tsx:24`, used by `MenuTargetForm.tsx:65` for the % sign): render it absolutely at the right inside the field wrapper with `pr-9` on the input.
- [x] **Field:** hint `text-text-soft`; `(optional)` marker stays `text-text-subtle` only if it is decorative, otherwise `text-text-soft`.
- [x] **Badge:** implement the ignored `icon`, `size` and `title` props (`Badge.tsx:58`): `icon` renders before children at 12px, `size` `sm` uses `text-meta px-1.5` and `md` the current size, `title` sets the `title` attribute. Background jobs status icons on `/settings/background-jobs` then show.
- [x] **Alert:** implement `closable`, `onClose` and `size` (`Alert.tsx:40`): a close `IconButton` with `aria-label="Dismiss"` when `closable`, local dismissed state when no `onClose`; `size="sm"` uses `text-ui` and tighter padding. Messages on `/settings/table-bookings` become dismissible.
- [x] **Modal, Drawer, ConfirmDialog:** scrims `bg-black/50` (`Modal.tsx:62`), `bg-black/30` (`Drawer.tsx:78`) become `bg-overlay`.
- [x] **Pagination** (27 raw classes): to tokens; the page-size select (line 203) gets a width and colour (`border border-border-strong`) or becomes DS `Select size="sm"`.
- [x] **Accordion** (17 raw classes), **Stat** (`fontVariantNumeric` inline style at line 68 becomes `tabular-nums`; hint `text-text-soft`), **Empty**, **Spinner**, **ProgressBar**, **Tooltip**, **Popover**, **Dropdown**, **FileUpload**, **DateTimePicker**, **Stepper**, **SearchInput**: every remaining raw class to tokens per the Canonical mapping; `text-[10px]`/`text-[11px]`/`text-[13px]` to `text-2xs`/`text-meta`/`text-ui`.
- [x] **compat/TabNav** (16 raw classes, green-600 underline): render exactly the DS `Tabs` look (A5). **compat/RadioGroup, SortableHeader, StatGroup, FilterPanel, EmptyState, BackButton, CardParts, PopoverParts, ModalActions, DrawerActions, Form, FormGroup, Container:** tokens only.
- [x] P-VISUAL harness rendering every primitive in every variant, desktop and 375px; baseline update; P-GATES; P-COMMIT `fix(ds): primitives use tokens only and honour their documented props`; P-SHIP.

## PR-06: DS composites and app shell

**Files:** `src/ds/composites/*`, `src/ds/shell/*`, `src/app/(authenticated)/loading.tsx`, `src/app/(authenticated)/error.tsx`, `src/app/(authenticated)/AuthenticatedLayout.tsx`, `src/components/features/shared/*`, `src/app/(authenticated)/table-bookings/foh/page.tsx:67`.

- [ ] **PageLayout** (`PageLayout.tsx:231-259, 297, 329, 341`): page background `bg-bg` (was cool `bg-gray-100` band), header matches `PageHeader` (`PageHeader.tsx:58`: same title size, weight, `text-text-strong`, spacing); add `headerVariant?: 'default' | 'dark'` where `dark` reproduces the current FOH kiosk header using `bg-sidebar text-on-dark` tokens; switch `table-bookings/foh/page.tsx:67` to `headerVariant="dark"` and drop its grey class-name dependency.
- [ ] **DataTable** (`DataTable.tsx:197-224, 311, 366, 369, 414, 473`): header `bg-surface-2 text-meta font-medium uppercase tracking-wider text-text-muted` like `Table.tsx:40,141`; container `shadow-sm` (not black), selection `bg-primary-soft`, focus A8. No change to its props or behaviour.
- [ ] **Table:** header surface stays `bg-surface-2`; cells `py-cell-y` (done in PR-01).
- [ ] **Section** (`section-header`/`section-body` hook classes stay), **Card** (implement ignored `padding` and `variant` props at `Card.tsx:30`: `padding` `none|sm|md|lg` maps to `p-0|p-3|p-pad-card|p-6`; `variant` `default|subtle` maps to `bg-surface|bg-surface-2`), **SectionNav** (A4, replacing `#005131`, `#a57626`, `#004229` at lines 75 and 76; count badge on active uses `bg-on-dark-active text-on-dark`), **Tabs** (focus A8 on tab buttons, line 105), **Segmented**, **Chart**, **CustomerLink**, **RowActions**, **DescriptionList**, **PageHeader**, **PageLoading**: tokens only.
- [ ] **Shell:** `SidebarNav.tsx:215` focus A8 with `focus-visible:shadow-ring`; `MobileChrome.tsx:161` scrim `bg-overlay` and its 28 arbitrary values to tokens where a token exists; `AppShell.tsx:110-111` `shell:p-[22px_28px_40px]` to `shell:pt-shell-pad-top shell:px-shell-pad-x shell:pb-shell-pad-bottom`; `Topbar.tsx:51` `rounded-[var(--radius-default)]` to `rounded-default`; `z-45` stays.
- [ ] **Loading and error:** `(authenticated)/loading.tsx` to tokens; `(authenticated)/error.tsx:36` blue "reload" button to DS `Button variant="primary"` (line 58 already brand).
- [ ] P-VISUAL harness: a PageLayout page and a PageHeader page side by side (same background and title), DataTable next to Table, SectionNav above Tabs, the mobile drawer open at 375px. Baseline update, P-GATES, cold build, P-COMMIT `fix(ds): one page chrome, one table look and one tab look`, P-SHIP. Tell the owner this is the release that changes the most screens and list the routes to glance at: `/invoices`, `/invoices/[id]`, `/private-bookings`, `/settings`, `/rota`, `/vouchers`, `/menu-management`, `/table-bookings/foh`.

## PR-07: Codemod step A (value-equal swaps)

**Files:** create `scripts/design-tokens/codemod.mjs`; modify matching files under `src/app/`, `src/components/`, `src/ds/`, and `src/lib/table-bookings/ui.ts`.

**Never touch:** `src/components/features/guest/**`, `src/app/g/**`, any other page rendered inside GuestShell (`src/app/booking-portal/**`, `src/app/parking/**`, `src/app/invoice-portal/**`, `src/app/privacy/**`, `src/app/(feedback)/**`, `src/app/legacy-link/**`), `src/app/(authenticated)/settings/design-system/**` (class names there are documentation), `src/app/api/**`, and every `src/lib/**` file except `src/lib/table-bookings/ui.ts` (`src/lib/cashing-up-pdf-template.ts` renders with the Tailwind CDN, which has no tokens).

- [ ] **Step 1: Write the codemod** as a plain Node ESM script: dry run by default, `--write` to apply, `--step=a|b`. It matches a class only as a whole token, with any variant prefix (`hover:`, `md:`, `group-hover:`, `focus:` ...) preserved, and only inside string literals or template literal text (not identifiers). It prints per-file and per-mapping counts. Step A table (from `verify:canonical-mapping`, rows marked codemod-safe with visual change none or subtle, plus the approved noticeable ones):

| From | To |
|---|---|
| `text-gray-900`, `text-gray-800` | `text-text` |
| `text-gray-950` | `text-text-strong` |
| `text-gray-600` | `text-text-muted` |
| `text-gray-300` | `text-text-subtle` |
| `placeholder:text-gray-400` (this variant only) | `placeholder:text-text-subtle` |
| `border-gray-200`, `border-gray-100` | `border-border` |
| `border-gray-300` | `border-border-strong` |
| `divide-gray-200`, `divide-gray-100`, `divide-gray-50` | `divide-border` |
| `hover:bg-gray-50` (this variant only) | `hover:bg-surface-hover` |
| `bg-white` | `bg-surface` |
| `bg-gray-50` | `bg-surface-2` |
| `bg-gray-100` | `bg-surface-hover` |
| `bg-gray-200` | `bg-border` |
| `text-red-600`, `text-red-500` | `text-danger` |
| `text-red-800`, `text-red-900` | `text-danger-fg` |
| `bg-red-50`, `bg-red-100` | `bg-danger-soft` |
| `bg-green-50`, `bg-green-100` | `bg-success-soft` |
| `bg-amber-50`, `bg-yellow-50` | `bg-warning-soft` |
| `text-amber-600`, `text-yellow-600` | `text-warning` |
| `text-amber-700`, `text-amber-800`, `text-amber-900`, `text-amber-950`, `text-yellow-700`, `text-yellow-800` | `text-warning-fg` |
| `text-blue-800`, `text-blue-900` | `text-info-fg` |
| `focus:border-green-500`, `focus:border-blue-500` | `focus:border-border-focus` |
| bare `rounded` | `rounded-sm` |
| `rounded-2xl`, `rounded-3xl` | `rounded-xl` |
| `rounded-[8px]`, `rounded-[6px]`, `rounded-[10px]`, `rounded-[9999px]` | `rounded-default`, `rounded-sm`, `rounded-md`, `rounded-pill` |
| `rounded-[var(--radius-X)]` | `rounded-X` |
| bare `shadow` | `shadow-sm` |
| `shadow-md` | `shadow-default` |
| `shadow-xl`, `shadow-2xl` | `shadow-lg` |
| `text-[13px]`, `text-[11px]`, `text-[10px]` | `text-ui`, `text-meta`, `text-2xs` |
| `text-[12px]`, `text-[14px]`, `text-[16px]` | `text-xs`, `text-sm`, `text-base` |
| `text-[9px]`, `text-[8px]`, `text-[7px]`, `text-[9.5px]`, `text-[10.5px]` | `text-2xs` (10px floor, D6) |
| `min-h-[44px]`, `min-h-[48px]`, `min-h-[56px]` | `min-h-touch`, `min-h-12`, `min-h-14` |
| `h-[var(--spacing-btn-h)]` and every other `*-[var(--spacing-NAME)]` | `h-btn-h` (named utility `*-NAME`; `row-h` became `cell-y` in PR-01) |
| `max-[820px]:` | `max-shell:` |
| `disabled:opacity-60`, `-40`, `-30`, `-70` | `disabled:opacity-50` (A9) |
| any `dark:` class | deleted (D7) |

- [ ] **Step 2:** Dry run; read the per-mapping totals against the audit's approximate uses; spot-read 20 random changed lines. Any class that appears in a non-class string (a label, a test fixture, docs) is excluded by path, not by special-casing.
- [ ] **Step 3:** `--write --step=a`; P-GATES; `git diff --stat`; P-VISUAL on 4 or 5 high-traffic components (a raw-class-heavy FOH modal, the private booking detail header, an invoice detail block, TableSetupManager).
- [ ] **Step 4:** Baseline update (expect roughly 2,600 fewer); commit script and changes separately: `chore(design-tokens): add token codemod` then `refactor(styles): swap value-equal raw classes for tokens`. P-SHIP.

## PR-08: Codemod step B (secondary greys darken, D3)

- [ ] `--write --step=b` with exactly two mappings: `text-gray-500` to `text-text-muted` (658 uses), `text-gray-700` to `text-text` (352 uses). Same exclusions as PR-07.
- [ ] P-VISUAL on three dense screens (a table, a form, a detail page); baseline update; P-GATES; P-COMMIT `refactor(styles): move secondary text to the token greys` (body: owner decision D3, text becomes slightly darker and more readable); P-SHIP.

## Area passes: shared method for PR-09 to PR-15

Each area PR removes every remaining guard violation in its scope and fixes the area's findings. Run each area as a Workflow with one agent per disjoint file group, following P-AGENTS, then the orchestrator reviews, runs P-GATES, P-VISUAL and ships.

For every file in scope:
1. Read the area's findings in `audit-results.json["audit:<key>"]` (`categories[].examples`, `visual_inconsistencies`, `hand_rolled_components`, `suspected_dead_classes`, `hotspot_files`) and the verifier's corrections in `verify:adversarial` (drop anything marked refuted; apply corrections to anything overstated).
2. Confirm the file is live (imported by the route's `page.tsx` chain); dead duplicate `*Client.tsx` files are skipped and listed under Parked.
3. Apply the Canonical mapping's manual rows by context (`verify:canonical-mapping`): status meaning goes to status tokens, selection and links to primary, info panels to info, icons to `text-text-subtle`, readable grey text to `text-text-soft` or `text-text-muted`, soft status panel borders to `border-<status>-border`, colourless borders get `border-border`, scrims become DS Modal/Drawer or `bg-overlay`.
4. Replace hand-rolled controls where the swap is a like-for-like visual control: a raw `<button>` styled as a button becomes DS `Button`/`IconButton`; a styled raw `<input>`/`<select>`/`<textarea>` becomes the DS field; a custom status `<span>` becomes DS `Badge`; a bespoke modal becomes DS `Modal`/`ConfirmDialog`. Keep every handler, prop, `name`, `id`, `aria-*`, `data-*` and form behaviour identical. If behaviour would change, leave the raw element tokenised instead and note it.
5. Acceptance: zero guard counts in scope except listed exceptions; the area's `visual_inconsistencies` each resolved or explicitly parked.

## PR-09: Guest pages, sign-in, recruitment booking, invoice portal

Scope: `audit:public-guest`. Files include `src/app/g/**`, `src/components/features/guest/**`, `src/app/auth/**`, `src/app/login/**`, `src/app/recruitment/**`, `src/app/invoice-portal/**`, `src/app/global-error.tsx`, `src/app/error/**`, `src/app/unauthorized/**`, other public pages.

- [ ] Guest type tokens: add to `@theme static` only the guest sizes and leadings that `src/components/features/guest/styles.ts` and the guest pages repeat (source values: `docs/design/guest-pages-2026-08/design_system/tokens/typography.css`), named `--text-guest-*` and `--leading-guest-*`, plus `--container-guest: 560px`, `--color-guest-success-soft`, `--color-guest-success-border`, `--color-guest-notice-soft`, `--color-guest-notice-border`, `--color-guest-problem-soft`, `--color-guest-problem-border` taken from the current opacity arbitraries in `GuestAlert` and `GuestBadge`. Add the new radius/shadow/text names to `cn()`'s lists. Replace the arbitraries.
- [ ] `src/app/g/[token]/confirm-booking/page.tsx:31-45,130`: render inside GuestShell with guest tokens and `GuestButton` (it is live on the SMS "Are you still coming?" link). Same for the retired `card-capture` and `sunday-preorder` pages if their routes still exist (check; if they only redirect, leave them).
- [ ] `src/app/g/[token]/email-capture/page.tsx:223`: `border-guest-line` to `border-guest-border`; bare `rounded` to `rounded-guest-field`.
- [ ] Password reset journey: `/auth/reset-password`, `/auth/reset`, `/auth/recover`, `/auth/confirm` page parts use the same `.auth` card and logo as `/auth/login`; fix the dark text on dark green at `auth/reset-password/page.tsx:57,70-82`; `bg-sidebar` buttons to DS Button primary.
- [ ] D9: `/recruitment/book/[token]` moves into GuestShell with guest tokens and components (keep all booking logic and server calls identical).
- [ ] D10 and A1: `/invoice-portal/[token]` leaves GuestShell for a neutral staff-token shell with `public/logo-oj.jpg`, "Orange Jelly Limited" and the legal line from `src/lib/company-details.ts` (registration and VAT numbers, address). Payment flow, PayPal button and amounts untouched. Check the CSP still allows everything the page loads.
- [ ] `global-error.tsx`: verify whether it renders styled (it does not import globals.css); if unstyled, give it self-contained minimal inline styles using the token hex values, since it cannot rely on the app CSS.
- [ ] P-VISUAL: these pages are public, so render them directly in the in-app browser at 375px and desktop (use a test token only where the page renders a safe error state without one; never submit forms). Baseline update, P-GATES, cold build, P-COMMIT, P-SHIP.

## PR-10: FOH, BOH, table bookings, vouchers, timeclock, kiosk, parking

Scope: `audit:foh-table-bookings`. Hotspots: `FohCreateBookingModal.tsx` (108), `BohBookingsClient.tsx` (102), `FohBookingDetailModal.tsx` (92), `table-bookings/[id]/BookingDetailClient.tsx` (92), `src/lib/table-bookings/ui.ts` (72), `table-bookings/reports/page.tsx` (69), `FohHeader.tsx` (50), `vouchers/foh/components/HandOutPanel.tsx` (46).

- [ ] **Booking status map (D4)** in `src/lib/table-bookings/ui.ts`: one map from status to DS Badge tone (`primary`, `success`, `warning`, `danger`, `neutral`) used by badges AND the timeline block map (today they disagree at lines 152 to 159 against 179 to 189). Booked `primary`, Seated `success`, Pending payment `warning`, No-show `danger`, Cancelled, Left, Completed `neutral`. Any other status keeps its current tone unless it collides with one of these; record each extra status and its tone in the commit message. Timeline blocks use the tone's `-soft` background, `-border` border and `-fg` text.
- [ ] Customer page uses the same map (`src/app/(authenticated)/customers/[id]/page.tsx:1108-1114` shows cancelled as red today): import the map instead of local classes (this file is in PR-12's scope; make only the import change here and note it).
- [ ] **Voucher map (D5):** `src/app/(authenticated)/vouchers/_shared/voucher-ui.tsx` is the single source; `vouchers/foh/components/voucher-status.ts` re-exports or maps to it and uses its words ("Issued", "Redeemed"). Issued `info`, Redeemed `success`, others as the ledger has them.
- [ ] **Buttons:** every `bg-sidebar`, `bg-green-600/700` action (for example `FohCreateBookingModal.tsx:725`, `FohChangeTimeModal.tsx:107`, `FohClockWidget.tsx:119`, `TimeclockClient.tsx:235`) becomes DS `Button variant="primary"`.
- [ ] **D6:** every FOH, BOH, timeclock and vouchers FOH text below 10px raised to `text-2xs`; every tappable control at least `min-h-touch` (the inline confirm steps, the create-booking footer, the clock widget). The kiosk rota label at 7px goes to 10px.
- [ ] `vouchers/[number]/VoucherDetailClient.tsx:463`: `prose prose-sm` produces nothing (plugin not installed). Style the entitlement HTML with explicit descendant utilities (`[&_ul]:list-disc [&_ul]:pl-5 [&_p]:mb-2 [&_h3]:font-semibold ...`) rather than adding a dependency.
- [ ] `table-bookings/reports/page.tsx`: blue selected state to `bg-primary-soft text-primary-soft-fg`; chart colours to `chart-*`.
- [ ] Timeclock: verify the kiosk margins on iPad landscape (1180 by 820 and 1366 by 1024) in the harness; fix overflow if present.
- [ ] Remaining raw classes in scope to zero. P-VISUAL harness with the FOH modals, header and timeline blocks at iPad sizes (768, 820, 1180 wide). Baseline, P-GATES, cold build, P-COMMIT, P-SHIP.

## PR-11: Employee onboarding and staff portal

Scope: `audit:people-ops` entries for `src/app/(employee-onboarding)/**` and `src/app/(staff-portal)/**`.

- [ ] Onboarding: six steps use `bg-green-600` buttons (for example `PersonalStep.tsx:166`) while `TimeOffStep.tsx:208` uses brand: all to DS `Button variant="primary"`. `RightToWorkNoticeStep.tsx:60` `bg-surface-muted` (does not exist) to `bg-surface-2`.
- [ ] Staff portal (0 token classes today): layout `bg-gray-50` (`(staff-portal)/layout.tsx:24`) to `bg-bg`; black "Request holiday" and "Subscribe" buttons (`portal/leave/page.tsx:75` and siblings) to DS `Button variant="primary"` (D2); `portal/shifts/page.tsx` (78 raw) and the rest to tokens; rota status colours from the shared rota map created in PR-13 (if PR-13 has not shipped, create the map here in `src/lib/rota/status-ui.ts` and PR-13 reuses it).
- [ ] P-VISUAL at 375px (staff use phones), baseline, P-GATES, P-COMMIT, P-SHIP.

## PR-12: Private bookings, customers, events, messages, marketing, short links

Scope: `audit:customers-events-comms`. Hotspots: `PrivateBookingDetailClient.tsx` (222 raw, 0 token), `customers/[id]/page.tsx` (109), `customers/insights/page.tsx` (80), `EventCategoryFormGrouped.tsx` (71), `components/private-bookings/CalendarView.tsx` (70), `EventImagePanel.tsx` (53), `private-bookings/[id]/items/page.tsx` (45).

- [ ] **Private booking status map:** one module (extend the existing marketing pattern, `marketing/_shared/marketing-ui.tsx`, as the model) `src/app/(authenticated)/private-bookings/_shared/status-ui.ts` mapping booking status and payment state to Badge tones; used by the list (`PrivateBookingsClient.tsx:764`), detail (`PrivateBookingDetailClient.tsx:3333`), calendar and events views.
- [ ] **Links (D2):** remove caller overrides that force `CustomerLink` back to blue (`PrivateBookingsClient.tsx:717,856`, `EventDetailClient.tsx:1328,1399`); every `text-blue-600/700` link to `text-primary hover:underline` or `Button variant="link"`.
- [ ] **SMS thread:** `customers/[id]` `MessageThread.tsx:173-174,232` bubbles match the inbox `ConversationThread.tsx:421-422` (outbound `bg-primary text-primary-fg`, inbound `bg-surface border border-border`); static min/max heights at `MessageThread.tsx:220` to classes.
- [ ] Near-black lines in `PrivateBookingDetailClient.tsx:762,3030` get `border-border` (PR-03's base rule already softens them; make them explicit).
- [ ] Customer insights chart palette (`customers/insights/page.tsx:117-126`) to `chart-*`; event category option lists stay data (A11).
- [ ] Remaining raw classes to zero. P-VISUAL on the private booking detail header and payment panel, customer detail, SMS thread. Baseline, P-GATES, cold build, P-COMMIT, P-SHIP.

## PR-13: Employees, roles, users, profile, rota, checklists, maintenance, recruitment

Scope: `audit:people-ops` minus PR-11's files. Hotspots: `RightToWorkTab.tsx` (74), `EmployeeStatusActions.tsx` (61), `OnboardingChecklistTab.tsx` (31), `EmployeePayTab.tsx` (29), `rota/RotaGrid.tsx`, `rota/payroll/PayrollClient.tsx`, `roles/components/RoleForm.tsx`.

- [ ] **Fields with no visible border** (`AddEmergencyContactModal.tsx:81,87,100`, `RightToWorkTab.tsx:294-405`, `RoleForm.tsx:50,69`: forms-plugin recipes without the plugin) become DS `Input`/`Select`/`Textarea`.
- [ ] **Hand-built modals** (about 15, listed in `hand_rolled_components`) become DS `Modal`/`ConfirmDialog` with identical actions.
- [ ] **Rota colour maps:** one module `src/lib/rota/status-ui.ts` (or reuse PR-11's) for shift status and leave types; sick ("couldn't work") is `danger` everywhere (`RotaGrid.tsx:324` red is right; `HoursByEmployeeClient.tsx:113-114` blue is wrong); rejected shift keeps a distinct treatment as a danger outline variant, recorded in the commit.
- [ ] **One category palette list (A11):** `src/components/schedule-calendar/appearance.ts` `CALENDAR_COLOUR_OPTIONS` imports `SHIFT_TEMPLATE_COLOURS` from `src/lib/rota/shift-template-colours.ts` instead of duplicating it; one default for a missing note colour (use the first option) in every screen that reads it (grep `colour ??`/`color ||` in calendar code).
- [ ] `RotaGrid.tsx:293` and `OnboardingChecklistTab.tsx:113` inline styles to `tabular-nums` and DS `ProgressBar`; `OnboardingClient.tsx:72` inline `gridTemplateColumns` to a class.
- [ ] Remaining raw classes to zero. P-VISUAL, baseline, P-GATES, cold build, P-COMMIT, P-SHIP.

## PR-14: Invoices, quotes, OJ projects, expenses, mileage, cashing up, receipts, MGD, dashboard

Scope: `audit:money`. Hotspots: `InvoiceDetailClient.tsx` (106), `ExpenseForm.tsx` (101), `mileage/_components/DestinationsClient.tsx` (68), `ExpenseFileViewer.tsx` (35), `quotes/[id]/page.tsx` (28), `invoices/recurring/[id]/page.tsx` (27).

- [ ] **One invoice status helper** replacing the four local copies: `src/lib/invoices/status-ui.ts` mapping draft, sent, part-paid, paid, overdue, void, credit to Badge tones; used by invoices, quotes (quote statuses in the same file), OJ projects and receipts where they show invoice state.
- [ ] **Expenses form:** blue actions to DS primary; all `dark:` classes gone (codemod did it; confirm); fields to DS inputs.
- [ ] **ChasePaymentModal** "Send Reminder" (`src/components/modals/ChasePaymentModal.tsx:159`, orange background with dark text and grey border): DS `Button variant="primary"` (or `danger` if it is destructive; it is not).
- [ ] **Receipts comma grids:** `receipts/monthly/page.tsx:249` `xl:grid-cols-[2fr,2fr,1fr]` to `xl:grid-cols-[2fr_2fr_1fr]`; `ReceiptMobileCard.tsx:273` the same fix. Sweep: `grep -rn "grid-cols-\[[^]]*,[^]]*\]" src`.
- [ ] Charts: `#10B981` bars in expenses, mileage and MGD insights to `var(--color-chart-1)`; canvas via PR-04's `resolveToken`.
- [ ] Remaining raw classes to zero. P-VISUAL on invoice detail, invoice new, expenses form, receipts monthly. Baseline, P-GATES, cold build, P-COMMIT, P-SHIP.

## PR-15: Settings and menu management

Scope: `audit:settings-menu`. Hotspots: `TableSetupManager.tsx` (98), `DishGpAnalysisTab.tsx` (68), `CompositionRow.tsx` (66), `SeasonalPeriods.tsx` (36), `MenuDishesTable.tsx` (32), `PayBandsManager.tsx` (29), `SpecialHoursCalendar.tsx` (28), `BudgetsManager.tsx` (26).

- [ ] `TableSetupManager.tsx`: one form style (DS fields throughout; today three styles on one page, compare `AllocationSettings.tsx:145`).
- [ ] `CompositionRow.tsx`: dish group colours from `cat-*` tokens; the amber group (`:55`, `:69`) must not share classes with the "upgrade" state, so upgrade uses `warning` and the group uses a `cat-*` colour.
- [ ] `SpecialHoursCalendar.tsx:219-238`: state borders lose to the grey border; remove the grey border class when a state border applies (use `cn()` with the state last).
- [ ] Stop passing props DS components ignore (fixed in PR-05 for Badge, Input, Alert, Card; re-check callers here still pass valid values).
- [ ] Remaining raw classes to zero. P-VISUAL, baseline, P-GATES, cold build, P-COMMIT, P-SHIP.

## PR-16: Brand colour module and staff emails

**Files:** create `src/lib/brand/palette.ts`, `tests/lib/brand/palette.test.ts`; modify staff email templates (`src/lib/rota/email-templates.ts` 121 hex, `src/lib/private-bookings/manager-notifications.ts`, `src/app/api/cron/rota-manager-alert/route.ts`, other staff-facing senders found with `grep -rln "#[0-9A-Fa-f]\{6\}" src/lib src/app/api`).

- [ ] **Step 1: Test first.** `tests/lib/brand/palette.test.ts` reads `src/app/globals.css`, parses the `@theme static` block into a name to value map (resolving one level of `var(--color-...)`), and asserts each `STAFF` and `GUEST` entry equals its token, for example `STAFF.primary === theme['--color-brand-600']` and `GUEST.gold === theme['--color-anchor-gold-dark']`.
- [ ] **Step 2: Module.** `src/lib/brand/palette.ts`:

```ts
/**
 * Literal colours for emails and PDFs, which cannot read CSS variables. Every value mirrors a
 * token in src/app/globals.css and tests/lib/brand/palette.test.ts fails if they drift.
 * Staff documents use STAFF; anything a guest or customer receives about The Anchor uses GUEST.
 */
export const STAFF = {
  primary: '#006A4E', primaryHover: '#064e3b', primarySoft: '#ecfdf5', primarySoftFg: '#043927', primaryFg: '#ffffff',
  bg: '#fafaf9', surface: '#ffffff', surface2: '#fafaf9', surfaceHover: '#f5f5f4',
  border: '#ececea', borderStrong: '#d6d3d1',
  text: '#1c1917', textStrong: '#0c0a09', textMuted: '#57534e', textSoft: '#78716c',
  success: '#16a34a', successSoft: '#f0fdf4', successFg: '#166534', successBorder: '#bbf7d0',
  warning: '#d97706', warningSoft: '#fffbeb', warningFg: '#92400e', warningBorder: '#fde68a',
  danger: '#dc2626', dangerSoft: '#fef2f2', dangerFg: '#991b1b', dangerBorder: '#fecaca',
  info: '#0284c7', infoSoft: '#f0f9ff', infoFg: '#075985', infoBorder: '#bae6fd',
} as const

export const GUEST = {
  green: '#005131', greenDeep: '#0c1d11', gold: '#8b6914', goldHover: '#6f5410', goldText: '#8b6914',
  bg: '#faf8f3', surface: '#ffffff', sunk: '#f2ede3', border: '#e2dccf', borderStrong: '#d2c9b4',
  text: '#1a1a1a', textStrong: '#005131', textMuted: '#6f6a61', cream: '#faf8f3', creamText: '#f0e6c6',
  success: '#006b45', danger: '#b1372f',
} as const
```

  (Confirm every value against `globals.css` when writing it; the test is the authority.)
- [ ] **Step 3:** staff emails import `STAFF`: rota emails' `#1F5C2E` (10 places), `#16a34a` buttons and other greens to `STAFF.primary`; greys (`#111827`, `#6b7280`, `#666`, `#999`, `#e5e7eb`) to `STAFF.text`, `STAFF.textMuted`, `STAFF.border`; small print never lighter than `STAFF.textMuted`.
- [ ] **Step 4:** render every changed staff email with fixture data (existing tests under `tests/lib/**` or a scratch script) and fail on `undefined`, `Invalid Date`, `NaN`, `£0.00`. Update snapshot tests deliberately, reading each diff.
- [ ] Baseline, P-GATES, P-COMMIT `refactor(email): staff emails take colours from the brand module`, P-SHIP. Do not send any email to test.

## PR-17: Guest emails (D8)

- [ ] Guest-facing templates (`src/lib/email/private-booking-emails.ts`, `event-ticket-emails.ts`, `table-bookings/guest-emails.ts`, `invoice-payment-emails.ts`, unsubscribe page HTML in `src/app/api/unsubscribe/route.ts`, and the others found by grep) take colours from `GUEST`. Buttons: `GUEST.gold` background, white text, hover not applicable in email. Headings `GUEST.green`. Charcoal, near-black, bright green and PayPal-blue buttons go. Invoice payment emails are Orange Jelly documents: they use `STAFF` neutrals and `STAFF.primary` buttons (A1), not the Anchor gold.
- [ ] Marketing email blocks are already consistent and fixture-tested: switch their literals to `GUEST.*` only where the value is identical (no visual change), and keep their tests green.
- [ ] Render every changed template with fixture data (same rule as PR-16) and look at each rendered HTML in the in-app browser from a local file. Baseline, P-GATES, P-COMMIT `refactor(email): guest emails use the Anchor guest palette`, P-SHIP.

## PR-18: PDFs, printable HTML, `/auth/confirm`, shared category palette

- [ ] `src/lib/pdf/document-chrome.ts` and every Puppeteer or pdfkit template (`invoice-template-compact.ts`, `quote-template-compact.ts`, `oj-statement.ts`, `pnl/report-template.ts`, `menu/allergen-report.ts`, `contract-template.ts`, `worker-agreement-template.ts`, `employee-starter-template.ts`, `recruitment/interview-kit-template.ts`, `oj-work-record.ts`, `oj-timesheet.ts`, `voucher-card-template.ts`, the rota and hours PDF routes, booking sheet templates): colours from `STAFF` (Orange Jelly and staff documents) or `GUEST` (guest-facing Anchor documents such as voucher cards), one grey family.
- [ ] Invoice and quote PDF status badges (`invoice-template-compact.ts:338-345`, `document-chrome.ts:123-130`): soft background, status `-fg` text, status border, not white 8pt text on bright fills.
- [ ] Rota PDF (`src/app/api/rota/pdf/route.ts:108`) colours shifts by template colour like `/rota`, not by department. Hours PDF (`src/app/api/rota/hours/pdf/route.ts:25-37`) sick = `STAFF.danger`; remove the duplicate `#0f766e` entries; series colours from the chart palette values.
- [ ] `src/lib/cashing-up-pdf-template.ts:157` loads the Tailwind CDN while rendering: replace its utility classes with an inline `<style>` block using `STAFF` values so the PDF no longer depends on a network fetch. Keep `tests/lib/cashingUpPdfTemplate.test.ts` green.
- [ ] `src/app/auth/confirm/route.ts:54-58` returns raw HTML with slate and teal: use `STAFF` values (stone and brand green).
- [ ] Delete dead constants `THEME_COLORS` (`src/lib/constants.ts:34`, says primary is blue) and `CHANNEL_COLOURS` (`src/lib/short-links/channels.ts:68`) after `grep -rn` across `src`, `scripts` and `tests` shows no importers (lessons 2026-06-10).
- [ ] Generate every changed PDF with fixture data into the session scratchpad, open each, and check text, totals and dates are present (no `undefined`, `NaN`, `Invalid Date`, `£0.00` where a sum is expected). Baseline, P-GATES, cold build, P-COMMIT `refactor(pdf): one palette for every generated document`, P-SHIP.

## PR-19: Living style guide, standards docs, agent rules, tidy-up

- [ ] `src/app/(authenticated)/settings/design-system/page.tsx`: swatches read `var(--color-*)` instead of 22 hard-coded hex values; show every token group from the Canonical set (neutrals, primary, status with soft, fg and border, overlay, on-dark, categories, charts, avatars, radius ladder with a note that `rounded-md` is 10px, shadows, type sizes, spacing tokens); show the real DS components.
- [ ] Rewrite `docs/standards/UI_UX.md` around the tokens that exist: token table, the contrast rule, the focus pattern (A8), disabled (A9), radius and shadow rules (A10), one label, tab, table and page chrome style, no dark mode (D7), how the guard works and how to lower its baseline. Remove references to `ui-v2`, `tailwind.config.js`, `text-destructive`, react-hook-form.
- [ ] Update `docs/ui-v2-component-catalog-outline.md` with a "superseded by docs/standards/UI_UX.md" line at the top (do not delete history docs).
- [ ] `.claude/agents/ui-standards-enforcer.md`: name the tokens, the banned classes and the guard.
- [ ] Project `CLAUDE.md`: one line under Stack pointing to `docs/standards/UI_UX.md` and the guard `tests/guards/design-tokens.test.ts`.
- [ ] Delete `tasks/design-tokens/audit-results.json` (history keeps it); keep this plan with the Tracker complete.
- [ ] Append a lesson to `tasks/lessons.md` (Edit, not Write) about tokens drifting without enforcement.
- [ ] P-GATES, P-COMMIT, P-SHIP. Remove the worktree only after main contains everything: `git worktree remove ../OJ-AMS-design-tokens` (remove the two symlinks first) and delete the local branch.

---

## Parked (found, deliberately not in this programme)

- Unused DS components flagged by the verifier (`NetworkStatus`, `BackButton`, `FormSubmitButton`, `DescriptionList`): dead-code clean-up belongs in its own change (one concern per changeset). Check with `npm run knip` first.
- Dead duplicate `*Client.tsx` files the area audits listed: same reason. Area passes skip them.
- z-index scale, property-specific colour names, staff leading and tracking tokens: no observed defect.
- Orange Jelly house style (colours, type, logo in vector): waiting on the designer brief `docs/design/brief-orange-jelly.md` (A1).
- Migrating the 70 direct `react-hot-toast` callers to the DS toast: PR-04 makes them look the same, which removes the visible problem.

## Session log

(Add dated one-line entries: what shipped, deployment id, anything surprising.)

- 2026-09-18: plan written; worktree created at 9ebaaff5.
- 2026-09-18 12:03: PR-00 + PR-01 live (f45155db, dpl_4i8mu8Q23pukm9haq4nYUQJkk2WY). Harness proved the DS error focus halo is now red. Cold build needs the 12 GB heap.
- 2026-09-18: PR-02 first baseline: 456 files; raw-palette 4599, hex-colour 1327, px-text-size 405, bare-rounded 207, sidebar-outside-shell 104, dark-variant 62, off-scale-shadow 45, legacy-hsl-var 8, raw-820-breakpoint 5, off-scale-radius 2. Guard ignores comments, which is why shadows count lower than the audit.
- 2026-09-18: PR-03 notes: only 1 responsive grid has a base of 3+ columns (style guide icons), so removing the grid collapse is safe; no fixed bottom-0 elements exist; print sheets are generated HTML, so the pale default border cannot affect them. Harness at 375px: stat grid 2 columns, divider #ececea, checkbox brand green; at 800px 4 columns.
- 2026-09-18: PR-04 notes: resolveToken takes no fallback (a fallback would be hex in a component); canvas ignores an empty colour, and @theme static guarantees the tokens exist in the browser. Harness: direct react-hot-toast error toast now matches the DS error toast exactly; DS info toast is sky like Alert; avatars use avatar-1..6; the canvas bar paints rgb(0,106,78).
- 2026-09-18: PR-05 done by a 4-agent workflow plus a reviewer (5 fixes). Added --shadow-ring-inset because accordion items, tab strips and table headers clip the outer ring. Native radios keep the browser outline (Safari may not draw a box-shadow on them). Parked: SortableHeader renders a button directly in a tr with no th (ExpensesClient, expenses and mileage insights), pre-existing invalid markup.
