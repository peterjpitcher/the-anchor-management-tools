# Domain Pitfalls

**Domain:** Production UI redesign of a Next.js 15 App Router + Tailwind CSS v4 management app
**Researched:** 2026-05-18

## Critical Pitfalls

Mistakes that cause rewrites, regressions, or production outages.

### Pitfall 1: Three-Layer Component System Collision

**What goes wrong:** The codebase currently has TWO UI layers: the legacy `PageWrapper`/`Page` pattern and the in-progress `ui-v2` system (`PageLayout` + `HeaderNav`). The redesign introduces a THIRD design system. Running three systems simultaneously causes style collisions, inconsistent spacing, and developer confusion about which component to import.

**Why it happens:** The ui-v2 migration is incomplete (tokens.ts defines `#16a34a` as primary green, but the design handoff specifies `#006A4E` Bottle Green). Starting the redesign without fully deprecating ui-v2 creates a three-way split.

**Consequences:** CSS specificity wars between old tokens and new tokens. Developers import from the wrong system. Visual inconsistency makes the app look broken rather than "in progress."

**Prevention:**
1. Phase 1 MUST establish a single new design system as the canonical source.
2. Create an explicit deprecation path: new design system replaces ui-v2 which already replaced legacy. No page should ever import from two systems.
3. Use a barrel export (`src/components/ds/index.ts`) that is the ONLY import point. Lint rule to block direct ui-v2 imports in new code.
4. Map every ui-v2 component to its new design system equivalent before starting migration.

**Detection:** More than one `import` from different component systems in a single file. Grep: `grep -r "ui-v2" src/app/ --include="*.tsx" -l` should shrink monotonically per phase.

**Phase:** Must be resolved in Phase 1 (Design System Foundation).

---

### Pitfall 2: Sidebar Navigation Breaking Authenticated Layout

**What goes wrong:** The current auth-enforced layout (`(authenticated)/layout.tsx`) wraps all staff pages. Introducing a collapsible sidebar (64px collapsed, 232px expanded) means replacing or heavily modifying this layout. A bug in the new layout breaks auth for ALL 34 staff screens simultaneously.

**Why it happens:** The authenticated layout is a single point of failure -- it handles auth checking, admin client fallback, AND page wrapping. Changing the visual shell risks breaking the auth guard if the component tree is restructured.

**Consequences:** Production auth bypass or blank screen for all staff users. The CLAUDE.md notes middleware was already disabled once after a Vercel incident -- this area is historically fragile.

**Prevention:**
1. Separate concerns: auth checking stays in the existing layout.tsx server component. The sidebar shell is a NEW nested layout that only handles navigation chrome.
2. Structure: `(authenticated)/layout.tsx` (auth only) > `(authenticated)/(app)/layout.tsx` (sidebar + topbar).
3. Test the auth layout in isolation before deploying the sidebar.
4. Keep a feature flag or gradual rollout mechanism so the sidebar can be disabled if it breaks.

**Detection:** Any modification to `(authenticated)/layout.tsx` that changes more than the rendered JSX (e.g., moving auth logic, changing imports) is a red flag.

**Phase:** Phase 1 (Shell/Navigation). Must be the FIRST thing deployed, before any screen migration.

---

### Pitfall 3: Design Token Mismatch Between Tailwind v4 @theme and Component Code

**What goes wrong:** Tailwind CSS v4 uses `@theme inline` in CSS to define tokens as CSS custom properties. The existing `tokens.ts` defines tokens in JavaScript. If both systems coexist, components reference stale JS tokens while the CSS layer uses different values, creating subtle color and spacing mismatches that only appear at runtime.

**Why it happens:** Tailwind v4's CSS-first configuration (`@theme` directive) replaces the JavaScript config approach. But the project's `ui-v2/tokens.ts` exports JS objects used in inline styles and dynamic logic. These two sources of truth drift apart silently.

**Consequences:** Buttons are one shade of green in one context and another shade elsewhere. Spacing is 4px off in some components. These bugs are invisible in code review and only caught by pixel-perfect visual comparison.

**Prevention:**
1. Single source of truth: define ALL tokens in CSS (`globals.css` via `@theme inline`). Export a typed `tokens` object that reads from CSS custom properties via `getComputedStyle` for the rare cases JS needs token values.
2. Delete `ui-v2/tokens.ts` once the CSS tokens are established.
3. Never hardcode hex values in components -- always reference token classes.
4. Add a visual regression check: screenshot comparison of key pages before/after token changes.

**Detection:** `grep -rn "#[0-9a-fA-F]\{3,6\}" src/components/ --include="*.tsx"` should return zero results (no hardcoded colors).

**Phase:** Phase 1 (Design System Foundation).

---

### Pitfall 4: 'use client' Boundary Creep During Component Library Build

**What goes wrong:** Building a new component library with interactive elements (sidebar hover, search modal, dropdown menus) leads to marking too many components as `'use client'`. This pulls large dependency trees into the client bundle, causing bundle size regression of 30-50%.

**Why it happens:** Interactive components need hooks and browser APIs. Developers mark parent components as client to avoid hydration errors, which forces all children into the client bundle too. The existing codebase already has 153 files with `'use client'` in authenticated routes.

**Consequences:** Slower page loads. Larger JS bundles. Worse Core Web Vitals. Staff on slower connections (e.g., using the app on a phone during service) experience laggy interactions.

**Prevention:**
1. Design the component library with a clear server/client split. Layout components (PageHeader, SectionNav container, Card) stay as server components. Only leaf interactive elements (sidebar toggle button, search input, dropdown) are client components.
2. Use the "client component island" pattern: server component renders structure, passes data as props to small client children.
3. Never mark a layout or page-level component as `'use client'` -- push interactivity down to the smallest possible leaf.
4. Run `npx @next/bundle-analyzer` before and after Phase 1 to detect regression.

**Detection:** `grep -rn "'use client'" src/components/ds/ --include="*.tsx" | wc -l` -- this number should stay below 30% of total files in the design system.

**Phase:** Phase 1 (Design System Foundation). Architectural decision that compounds if wrong.

---

### Pitfall 5: Breaking Public-Facing Routes During Staff UI Migration

**What goes wrong:** The app has public routes (timeclock kiosk, guest booking forms at `/g/`, table booking, parking guest) that share some components or layouts with authenticated routes. A design system change that affects shared components breaks customer-facing pages.

**Consequences:** Customers cannot book tables, make payments, or manage their bookings. Revenue impact is immediate.

**Why it happens:** Shared utility components (buttons, cards, form inputs) are imported by both staff and public pages. Changing their API or styling affects both contexts.

**Prevention:**
1. Audit shared component usage BEFORE starting: `grep -r "from '@/components" src/app/g/ src/app/table-booking/ src/app/timeclock/ src/app/parking/ --include="*.tsx" -l` to identify every public route that imports shared components.
2. Public routes should NOT import from the new design system. They keep their current styling until explicitly migrated (if ever).
3. If a shared component must change, create the new version alongside the old one. Only remove the old one when all consumers have migrated.
4. Add E2E smoke tests for public routes (table booking, guest payment) that run before every deploy.

**Detection:** Any PR that modifies files in `src/components/` should trigger a review of public route consumers.

**Phase:** Phase 1 (Planning) and continuously throughout all phases.

---

### Pitfall 6: Deploying Incomplete Redesign Creates "Frankenstein UI"

**What goes wrong:** Staff see some pages with the new sidebar and design system, and other pages with the old navigation. The inconsistency erodes confidence in the tool and creates confusion about where things are.

**Why it happens:** Incremental migration by definition means the app is in a mixed state. But if the phases are poorly scoped, the mixed state persists too long or affects high-traffic pages differently.

**Consequences:** Staff report bugs that are actually just "this page hasn't been migrated yet." Support burden increases. Staff lose trust in the tool.

**Prevention:**
1. Phase 1 deploys the shell (sidebar + topbar) to ALL authenticated pages at once, even if page content hasn't been redesigned. The shell is the consistent chrome; page internals can vary.
2. Group page migrations by user workflow, not by technical similarity. Migrate all pages a manager uses in sequence, not scattered across phases.
3. Communicate clearly: "Navigation is new, page designs are updating over the next 2 weeks."
4. Never leave a phase boundary where the same workflow (e.g., creating a booking, checking the rota) spans old and new designs.

**Detection:** User complaints about inconsistency. Visual audit at each phase boundary.

**Phase:** Phase planning. The phase structure itself IS the mitigation.

## Moderate Pitfalls

### Pitfall 7: Tailwind v4 Border and Ring Default Changes

**What goes wrong:** Tailwind v4 changed the default border color from `currentColor` to `gray-200`, and the default ring width from `3px` to `1px`. Every component using plain `border` or `ring` classes without explicit color/width looks different after the design system update.

**Prevention:** Audit all uses of `border` and `ring` classes. Add explicit color and width values. The design handoff specifies exact border treatments -- use those, not defaults. Run visual diff after token setup.

**Detection:** Side-by-side screenshot comparison of forms, cards, and tables before and after.

**Phase:** Phase 1 (Design System Foundation).

---

### Pitfall 8: Navigation State Management Regression

**What goes wrong:** The current `AppNavigation.tsx` handles route-based active states. The new collapsible sidebar introduces hover-to-expand behavior, collapsed icon-only mode, and section grouping. If state management is poorly implemented, the sidebar doesn't reflect the current page, expands when it shouldn't, or loses state on navigation.

**Prevention:**
1. Sidebar expanded/collapsed state stored in `localStorage` with a cookie fallback for server-side rendering.
2. Active route detection uses `usePathname()` with prefix matching, not exact match (to handle nested routes).
3. Test with all 34 routes to ensure every page highlights the correct sidebar item.

**Detection:** Navigate to every page and verify the sidebar highlights the correct section. Automated: Playwright test that visits each route and checks for an active CSS class.

**Phase:** Phase 1 (Shell/Navigation).

---

### Pitfall 9: Search and "New" Button Scope Creep

**What goes wrong:** The topbar design includes a global search and a "New" button (quick-create). These features look simple in the design but require significant backend work: search needs to query across customers, bookings, events, and employees. The "New" button needs context-aware creation modals. Building these in Phase 1 delays the shell deployment.

**Prevention:**
1. Phase 1 topbar renders the search input and "New" button as UI-only placeholders. Search shows "Coming soon" on focus. "New" button opens a simple dropdown with links to existing creation pages.
2. Full search implementation deferred to Phase 3 or 4.
3. Do NOT build backend search infrastructure in the design system phase.

**Detection:** Phase 1 scope includes any server action or API route for search -- that's scope creep.

**Phase:** Phase 1 (Shell) for placeholder UI. Phase 3+ for full implementation.

---

### Pitfall 10: Data Table Component Inconsistency

**What goes wrong:** The app uses TanStack React Table v8 extensively. The redesign likely specifies a new table design (row density, header styling, action buttons). Migrating tables is one of the highest-effort, highest-risk UI changes because tables are deeply tied to data fetching, sorting, filtering, and pagination logic.

**Prevention:**
1. Build the new table wrapper component (design system table) as a thin styling layer over TanStack Table, NOT a replacement.
2. Migrate tables one section at a time, starting with simpler tables (mileage, expenses) before complex ones (private bookings, events).
3. Never change the TanStack Table column definitions and styling in the same PR. Separate data changes from visual changes.

**Detection:** A PR that modifies both `columnHelper.accessor()` calls and CSS classes is doing too much.

**Phase:** Phase 2 (Page Migrations), starting with simple tables.

---

### Pitfall 11: 2,991-Line PrivateBookingDetailClient Component

**What goes wrong:** The largest client component (2,991 lines) will be one of the hardest to migrate. Attempting to redesign it in one pass risks introducing regressions in payment flow, SMS dispatch, contract generation, and booking amendments.

**Prevention:**
1. Do NOT redesign this component in the same phase as the shell migration.
2. Before redesigning, decompose it: extract tab contents into separate components, lift data fetching to a server parent.
3. Decomposition PR first (no visual changes), then redesign PR second (visual only).

**Detection:** Any PR touching `PrivateBookingDetailClient.tsx` that exceeds 500 lines changed is too large.

**Phase:** Phase 3 or 4 (Complex Page Migrations). Never Phase 1 or 2.

## Minor Pitfalls

### Pitfall 12: Font Loading Flash (FOUT)

**What goes wrong:** The design specifies Inter (400-800) + JetBrains Mono (400-600). If loaded via Google Fonts or external CDN, there's a flash of unstyled text on initial page load.

**Prevention:** Use `next/font` to self-host both fonts. Define fallback font metrics with `adjustFontFallback`. Load only the weights actually used (400, 500, 600, 700 for Inter; 400, 500 for JetBrains Mono).

**Phase:** Phase 1 (Design System Foundation).

---

### Pitfall 13: Icon System Inconsistency

**What goes wrong:** The design handoff likely uses a specific icon set. The current codebase may use a different one (or inline SVGs). Mixing icon systems creates visual inconsistency and bloats the bundle.

**Prevention:** Choose ONE icon library (Lucide React is the standard for this stack). Create an Icon component wrapper in the design system. Lint rule to prevent importing icons from other sources.

**Phase:** Phase 1 (Design System Foundation).

---

### Pitfall 14: CSS Specificity Conflicts Between Old and New Globals

**What goes wrong:** The existing `globals.css` has base styles. The new design system adds new CSS custom properties via `@theme inline`. If both old and new selectors target the same elements with different specificity, some pages render with a hybrid of old and new styles.

**Prevention:** Namespace new CSS custom properties with a prefix (e.g., `--ds-*`). After migration is complete, remove old unprefixed variables. Never use `!important` to override -- fix the specificity chain instead.

**Phase:** Phase 1 (Design System Foundation).

---

### Pitfall 15: Missing Loading and Error States in New Layouts

**What goes wrong:** The new sidebar + topbar layout is built, but loading states (skeleton loaders) and error boundaries are not adapted to the new layout dimensions. Pages flash with content that doesn't fit the new sidebar margin.

**Prevention:** Build `loading.tsx` and `error.tsx` for the new layout in Phase 1. These must account for sidebar width (64px collapsed, 232px expanded). Test with slow network throttling.

**Phase:** Phase 1 (Shell/Navigation).

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Phase 1: Design System + Shell | Token mismatch (Pitfall 3), auth layout breakage (Pitfall 2), three-system collision (Pitfall 1) | Establish single source of truth FIRST. Nested layout for sidebar. Deprecate ui-v2 imports. |
| Phase 2: Screen Migrations | Frankenstein UI (Pitfall 6), table component regression (Pitfall 10), bundle size creep (Pitfall 4) | Migrate by workflow, not by file. Thin wrapper over TanStack Table. Monitor bundle size. |
| Phase 3: New Full-Stack Sections | Scope creep on search/new button (Pitfall 9), building complex sections before simple ones | Build Events and Performers on the new design system only. Defer global search. |
| Phase 4: Complex Migrations + Polish | PrivateBookingDetailClient (Pitfall 11), public route breakage (Pitfall 5) | Decompose before redesigning. Smoke test public routes. |

## Codebase-Specific Risk Matrix

| Area | Risk Level | Reason | File Count |
|------|-----------|--------|-----------|
| Authenticated layout | HIGH | Single point of failure for auth + navigation | 1 file, all routes |
| Design tokens | HIGH | Three competing systems (legacy, ui-v2, new DS) | ~30 component files |
| Private bookings | HIGH | 2,991-line monolith client component | 3 core files, 5,800+ lines |
| Data tables | MEDIUM | TanStack Table deeply coupled to styling | ~15 table components |
| Public routes | MEDIUM | Shared component imports could break guest pages | ~20 public route files |
| Form components | MEDIUM | 12+ form components in ui-v2 need equivalents | 12 files |
| Cron routes | LOW | Not UI-related, should be unaffected | 5 cron routes |

## Sources

- [Next.js App Router migration: the good, bad, and ugly](https://www.flightcontrol.dev/blog/nextjs-app-router-migration-the-good-bad-and-ugly) - Production migration experience report
- [Tailwind CSS v4 Migration Guide](https://tailwindcss.com/docs/upgrade-guide) - Official upgrade guide with breaking changes
- [Tailwind CSS v4 Breaking Changes](https://medium.com/@mernstackdevbykevin/tailwind-css-v4-0-complete-migration-guide-breaking-changes-you-need-to-know-7f99944a9f95) - Comprehensive breaking changes list
- [Migrate Design Systems Gracefully with Multiple Tailwind CSS Configs](https://medium.com/@teamzorba4/migrate-design-systems-gracefully-with-multiple-tailwind-css-configs-in-next-js-f894f321fc31) - Parallel design system strategy
- [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) - Official client boundary documentation
- [Legacy App UI Redesign Mistakes](https://xbsoftware.com/blog/legacy-app-ui-redesign-mistakes/) - Common redesign pitfalls
- [Incremental Migration Approaches](https://circleci.com/blog/incremental-migration-approaches-for-legacy-applications/) - Parallel implementation strategy

---

*Pitfalls research: 2026-05-18*
