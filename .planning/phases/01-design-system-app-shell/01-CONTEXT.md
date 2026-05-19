# Phase 1 Context: Design System & App Shell

**Created:** 2026-05-18
**Phase:** 1 — Design System & App Shell
**Requirements:** DS-01..DS-20, SHELL-01..SHELL-06

## Decisions

### 1. Sidebar Navigation Completeness

**Decision:** Show all nav items from day one, including sections not yet redesigned (Events, Performers, Cashing Up, etc.). Clicking unbuilt sections goes to their current (old) pages inside the new shell.

**Nav groups** (match design exactly, plus Quotes added to Finance):

| Group | Items |
|-------|-------|
| Primary | Dashboard, Events (badge), Performers, Customers, Messages (badge) |
| Operations | Menu Management, Table Bookings, Private Bookings, Parking |
| Staff Ops | Employees, Rota |
| Finance | Cashing Up, Invoices, Quotes, OJ Projects, Receipts, Mileage, Expenses, MGD, Short Links |
| Settings | Settings, Design System |

**FOH mode:** Preserve existing FOH nav filtering in the new sidebar. Port the restriction logic from current AppNavigation so FOH users see a restricted nav set.

**Sidebar state:** Always start collapsed (64px). No persistent state / localStorage. Hover to expand to 232px. Mobile: hamburger menu overlay.

### 2. Icon Migration Strategy

**Decision:** Build the full custom icon set (~40 icons) from the design handoff in Phase 1. Extract SVG paths from `icons.jsx`, create an `Icon` component matching the design spec (16px on 24x24 viewBox, strokeWidth 1.75).

**Sidebar icons:** Close match from Lucide/Heroicons is acceptable — exact SVG path matching not required for nav icons. The custom icon set is for ds/ components and new UI.

**Scope:** Port all ~40 icons now. Avoids revisiting the icon component in later phases. Existing pages continue using @heroicons/react and lucide-react until Phase 2 migration.

### 3. Component Migration Boundary

**Decision:** Hard boundary. Phase 1 builds ds/ components as a standalone library. Existing pages keep all ui-v2/ components unchanged until Phase 2 migrates them. No opportunistic swaps.

**Directory structure** (grouped by role):
```
src/ds/
  primitives/     # Button, Badge, Avatar, Alert, Modal, Skeleton, Empty, Toast, form controls (Input, Select, Textarea, Checkbox, Radio, Switch)
  composites/     # Card, Stat, Tabs, Segmented, Table, PageHeader, SectionNav
  icons/          # Icon component + all ~40 SVG icon definitions
  tokens/         # Design token constants for JS access (charts, dynamic styles)
  index.ts        # Barrel re-export
```

**Exports:** Barrel file (`import { Button, Card } from '@/ds'`) plus direct imports also supported (`import { Button } from '@/ds/primitives/Button'`).

### 4. Tailwind v4 Migration

**Decision:** Run the official `@tailwindcss/upgrade` codemod first to handle syntax migration (directives, config conversion), then manually build the `@theme` token block from the design handoff values.

**Token source of truth:** `@theme` block in `globals.css` is the primary source. A `src/ds/tokens/index.ts` file re-exports CSS variable references for cases where JS needs colour values (charts, canvas, dynamic inline styles).

**Existing CSS vars:** Replace entirely with the design's token system. Clean break — rip out current `--primary`, `--secondary`, etc. and replace with the design's semantic token naming. No aliases, no gradual migration.

## Code Context

**Key files to modify:**
- `src/app/globals.css` — Tailwind v4 migration target, @theme block, design tokens
- `tailwind.config.js` — To be converted/removed by codemod
- `postcss.config.mjs` — Already uses @tailwindcss/postcss
- `src/app/(authenticated)/layout.tsx` — AuthenticatedLayout replacement with new AppShell
- `src/components/ui-v2/navigation/AppNavigation.tsx` → logic ported to new Sidebar
- `src/features/shared/AppNavigation.tsx` → FOH mode logic ported

**Key patterns to preserve:**
- AuthenticatedLayout is a Client Component wrapping PermissionProvider
- FOH mode detection and nav restriction logic
- All existing page functionality must continue working

**Key constraints:**
- No ui-v2/ imports in ds/ components — ds/ is self-contained
- No existing page modifications beyond shell swap (Phase 2 handles page internals)
- AuthenticatedLayout swap must be atomic — all authenticated pages move at once

## Deferred Ideas

- Dark mode toggle (v2, not v1)
- Density system comfortable/spacious presets (v2)
- Brand colour switching (v2)
- Persistent sidebar state via localStorage (decided against — always collapsed)
