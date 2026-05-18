# Technology Stack — AMS UI Redesign

**Project:** AMS UI Redesign
**Researched:** 2026-05-18
**Focus:** Design tokens, component library, collapsible sidebar, Tailwind v4 migration

## Critical Finding: Tailwind Version Hybrid State

The project is in a transitional state that must be resolved before building the design system:

- **package.json** declares `tailwindcss: "^3.4.0"` (v3 syntax)
- **Installed** via `@tailwindcss/postcss@4.2.1` is `tailwindcss@4.2.1` (v4 engine)
- **globals.css** uses v3 directives (`@tailwind base;`)
- **tailwind.config.js** exists with v3 JS-based configuration
- **postcss.config.mjs** uses the old `tailwindcss: {}` plugin (not `@tailwindcss/postcss`)

**Verdict:** The v4 engine is installed but completely unused. The project runs on v3 syntax. Phase 1 of the redesign MUST migrate to Tailwind v4 properly before establishing design tokens, because v4's `@theme` directive is the correct foundation for a CSS custom property token system. Building tokens on v3's JS config and then migrating later would be double work.

## Recommended Stack

### Design Token System — Tailwind v4 `@theme` (HIGH confidence)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Tailwind CSS v4 | ^4.2.1 | CSS framework + design token system | Already installed; `@theme` directive generates CSS custom properties AND utility classes from a single source of truth |
| `@tailwindcss/postcss` | ^4.2.1 | PostCSS integration | Already installed; replaces the old `tailwindcss` PostCSS plugin |

**Implementation pattern — `globals.css`:**

```css
@import "tailwindcss";

@theme {
  /* === Brand Colors === */
  --color-brand-50: #f0fdf4;
  --color-brand-100: #dcfce7;
  --color-brand-200: #bbf7d0;
  --color-brand-300: #86efac;
  --color-brand-400: #4ade80;
  --color-brand-500: #22c55e;
  --color-brand-600: #006a4e;   /* Bottle Green — primary brand */
  --color-brand-700: #005a42;
  --color-brand-800: #004a36;
  --color-brand-900: #003a2a;
  --color-brand-950: #001f17;

  /* === Sidebar === */
  --color-sidebar-bg: #064e3b;
  --color-sidebar-hover: #065f46;
  --color-sidebar-active: #047857;
  --color-sidebar-text: #d1fae5;
  --color-sidebar-text-active: #ffffff;
  --color-sidebar-border: #065f46;
  --color-sidebar-width-expanded: 232px;
  --color-sidebar-width-collapsed: 64px;

  /* === Semantic === */
  --color-success: #16a34a;
  --color-warning: #f59e0b;
  --color-error: #dc2626;
  --color-info: #3b82f6;

  /* === Surface === */
  --color-surface: #ffffff;
  --color-surface-raised: #f9fafb;
  --color-surface-sunken: #f3f4f6;
  --color-border: #e5e7eb;
  --color-border-strong: #d1d5db;

  /* === Text === */
  --color-text-primary: #111827;
  --color-text-secondary: #6b7280;
  --color-text-tertiary: #9ca3af;
  --color-text-inverse: #ffffff;

  /* === Typography === */
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  /* === Spacing (layout-specific) === */
  --spacing-sidebar-expanded: 232px;
  --spacing-sidebar-collapsed: 64px;
  --spacing-topbar: 56px;

  /* === Shadows === */
  --shadow-card: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
  --shadow-dropdown: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
  --shadow-modal: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);

  /* === Border Radius === */
  --radius-sm: 0.25rem;
  --radius-md: 0.375rem;
  --radius-lg: 0.5rem;
  --radius-xl: 0.75rem;
  --radius-full: 9999px;

  /* === Transitions === */
  --duration-fast: 150ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
}
```

**Why `@theme` (not `@theme inline`):** Use `@theme` (default) so that every token is both a CSS custom property AND generates Tailwind utility classes. Use `@theme inline` only for derived values that reference other tokens. The default `@theme` allows runtime overriding via CSS — essential if dark mode is ever added later.

**Why NOT keep the JS tokens.ts file:** The existing `src/components/ui-v2/tokens.ts` duplicates what `@theme` provides natively. CSS custom properties from `@theme` are available everywhere — in Tailwind utilities (`bg-brand-600`), in CSS (`var(--color-brand-600)`), and in inline styles. A JS object adds an import dependency and can't be used in CSS.

### Migration Steps (HIGH confidence)

The official `@tailwindcss/upgrade` codemod handles ~90% of mechanical changes:

```bash
# 1. Run the upgrade tool (requires tailwindcss <4 in package.json)
npx @tailwindcss/upgrade

# 2. What it does automatically:
#    - Removes tailwind.config.js, moves config to CSS @theme
#    - Replaces @tailwind directives with @import "tailwindcss"
#    - Updates postcss.config.mjs to use @tailwindcss/postcss
#    - Renames deprecated utilities (e.g., flex-shrink-0 → shrink-0)
#    - Updates package.json dependencies

# 3. Manual review needed for:
#    - Dynamic class construction (template literals — grep for backtick+bg-)
#    - tailwindcss-animate plugin (must be replaced with CSS @keyframes)
#    - Custom theme extensions (verify they mapped correctly)
```

**Known breaking changes to watch for:**
- Default `border-*` color changed from gray to `currentColor`
- Default `ring` width changed from 3px to 1px
- `ring` color changed from blue to `currentColor`
- `shadow-*` and `blur-*` renamed
- `tailwindcss-animate` plugin needs manual replacement (custom `@keyframes` in CSS)

### Component Library — Custom Components on Headless UI (HIGH confidence)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @headlessui/react | ^2.2.4 | Accessible primitives (Dialog, Menu, Listbox, Combobox, Popover, Transition) | Already installed; provides accessibility (ARIA, focus trap, keyboard nav) without visual opinions; v2.1+ uses `data-*` attributes for transitions |
| Custom components | — | Button, Card, Stat, Badge, Table, PageHeader, SectionNav, Toolbar | Build on top of design tokens; full control over pixel-perfect match to handoff |
| lucide-react | ^0.522.0 | Icons | Already installed; comprehensive, tree-shakeable |
| tailwind-merge | ^3.3.1 | Class merging in `cn()` | Already installed; v3 supports Tailwind v4 class syntax |
| clsx | ^2.1.1 | Conditional classes | Already installed; used in `cn()` helper |

**Why NOT shadcn/ui:** shadcn/ui would introduce Radix UI primitives as a second headless layer alongside the already-installed Headless UI. The project has 12+ display components, 6 feedback components, 9 layout components, and 17 navigation components already in `src/components/ui-v2/`. Adopting shadcn/ui means either replacing all of those or running two systems. The existing components need restyling to match the design handoff, not replacement.

**Why NOT Radix UI directly:** Same reasoning — Headless UI is already the installed primitive layer. Switching adds migration cost with no functional benefit for this project's needs (Dialog, Menu, Transition are the primary headless requirements).

### Component Structure (HIGH confidence)

```
src/components/
  design-system/           # NEW — the redesign's component library
    tokens/
      index.css            # @theme definitions (imported by globals.css)
    primitives/
      Button.tsx           # Variants: primary, secondary, ghost, destructive
      Badge.tsx            # Variants: default, success, warning, error, info
      Card.tsx             # Container with shadow, optional header/footer
      Input.tsx            # Text input with label, error, description
      Select.tsx           # Wraps Headless UI Listbox
      Modal.tsx            # Wraps Headless UI Dialog
      Dropdown.tsx         # Wraps Headless UI Menu
    composites/
      Stat.tsx             # KPI stat card (value, label, trend, icon)
      DataTable.tsx        # Table with sort, filter, pagination
      PageHeader.tsx       # Title + breadcrumbs + actions
      SectionNav.tsx       # Horizontal pill strip for sub-pages
      Toolbar.tsx          # Filters, search, bulk actions bar
      EmptyState.tsx       # Illustration + message + CTA
    layout/
      AppShell.tsx         # Sidebar + Topbar + content area
      Sidebar.tsx          # Collapsible sidebar (see below)
      Topbar.tsx           # Search, notifications, "New" button
      ContentArea.tsx      # Scrollable content with proper padding
    index.ts               # Barrel export
  ui-v2/                   # EXISTING — deprecate gradually, don't delete
  features/                # EXISTING — feature-specific components
```

**Why this structure:** Separating `design-system/` from `ui-v2/` allows parallel existence during migration. Screens adopt new components incrementally. The old `ui-v2/` stays functional until all screens are migrated, then gets deleted.

### Collapsible Sidebar — CSS Grid + Transition (HIGH confidence)

| Technology | Purpose | Why |
|------------|---------|-----|
| CSS `grid-template-columns` | Sidebar width animation | GPU-accelerated, smooth transition; avoids layout thrashing from `width` animation |
| React `useState` + `localStorage` | Persist collapsed state | Layout-level state persists across page navigations in App Router; `localStorage` persists across refreshes |
| CSS `transition` | Animate collapse/expand | Native CSS transition on `grid-template-columns` with `duration-300 ease-in-out` |
| Headless UI `Transition` | Mobile sidebar overlay | Sheet-style slide-in on mobile; uses `data-closed`/`data-enter`/`data-leave` attributes |

**Implementation approach:**

```tsx
// AppShell.tsx (Client Component in authenticated layout)
'use client';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sidebar-collapsed') === 'true';
  });

  return (
    <div
      className="grid h-screen transition-[grid-template-columns] duration-300 ease-in-out"
      style={{
        gridTemplateColumns: collapsed ? '64px 1fr' : '232px 1fr',
        gridTemplateRows: '56px 1fr',
      }}
    >
      <Sidebar collapsed={collapsed} onToggle={() => {
        setCollapsed(prev => {
          const next = !prev;
          localStorage.setItem('sidebar-collapsed', String(next));
          return next;
        });
      }} />
      <Topbar className="col-start-2" />
      <main className="col-start-2 overflow-y-auto bg-surface-sunken">
        {children}
      </main>
    </div>
  );
}
```

**Why CSS Grid (not flexbox width animation):**
- `grid-template-columns` transitions are GPU-composited — no layout recalculation of child elements during animation
- The content area naturally fills remaining space without JavaScript measurement
- Works with the fixed topbar spanning the content column only

**Why NOT hover-to-expand:** The design spec says "64px collapsed, 232px expanded on hover" but implementing hover-expand creates problems: it fights with click interactions on nav items, causes accidental expansion when mousing past, and is inaccessible for keyboard/touch users. Use a toggle button (pin/unpin) with optional hover-expand as a progressive enhancement, controlled by a `hoverExpand` preference.

**Mobile sidebar:** On screens `<768px`, hide the sidebar entirely and use a Headless UI `Dialog` as a slide-in sheet triggered by a hamburger button in the topbar. This matches the existing pattern in `AuthenticatedLayout.tsx`.

### Fonts (HIGH confidence)

| Font | Weights | Source | Purpose |
|------|---------|--------|---------|
| Inter | 400, 500, 600, 700, 800 | `next/font/google` | All UI text |
| JetBrains Mono | 400, 600 | `next/font/google` | Code snippets, monospace data |

```tsx
// app/layout.tsx
import { Inter, JetBrains_Mono } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

// Apply: <body className={`${inter.variable} ${jetbrainsMono.variable}`}>
```

**Why `next/font`:** Automatic self-hosting, zero layout shift (size-adjust), preloaded, no external requests. The CSS variables (`--font-sans`, `--font-mono`) align with the `@theme` definitions.

### Animation (MEDIUM confidence)

| Technology | Purpose | Why |
|------------|---------|-----|
| CSS transitions | Sidebar collapse, hover states, focus rings | Native, zero-JS, GPU-composited |
| Headless UI `Transition` | Modal enter/exit, dropdown appear/disappear | Already installed; uses `data-*` attributes |
| CSS `@keyframes` | Loading spinners, skeleton pulse | Replace `tailwindcss-animate` plugin |

**Why NOT Framer Motion:** The redesign has simple transitions (slide, fade, scale). Framer Motion adds ~30KB gzipped for capabilities not needed. CSS transitions + Headless UI Transition cover all requirements. If complex orchestrated animations are needed later, reconsider.

## Dependencies to Add

```bash
# No new runtime dependencies needed — everything is already installed

# Migration cleanup (remove after v4 migration):
npm uninstall tailwindcss-animate  # Replace with CSS @keyframes in @theme
# Remove tailwind.config.js after migration
```

## Dependencies to Update

| Package | Current | Action | Reason |
|---------|---------|--------|--------|
| `tailwindcss` | ^3.4.0 (package.json) | Remove from package.json | v4 is provided by `@tailwindcss/postcss` |
| `tailwindcss-animate` | ^1.0.7 | Remove | Incompatible with v4; replace with CSS `@keyframes` |
| `postcss.config.mjs` | Uses `tailwindcss: {}` | Update to `@tailwindcss/postcss: {}` | v4 PostCSS plugin |
| `tailwind-merge` | ^3.3.1 | Keep | v3 supports Tailwind v4 syntax |
| `@headlessui/react` | ^2.2.4 | Keep | v2.1+ fully compatible with v4 |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Design tokens | Tailwind v4 `@theme` CSS custom properties | JS `tokens.ts` object (existing) | Can't be used in CSS; creates import dependency; duplicates what `@theme` provides natively |
| Design tokens | Tailwind v4 `@theme` CSS custom properties | Style Dictionary / design token tooling | Over-engineering for single-brand, light-mode-only project; adds build step |
| Component library | Custom on Headless UI | shadcn/ui | Would introduce Radix alongside existing Headless UI; 40+ existing components would need replacement |
| Component library | Custom on Headless UI | Chakra UI / Mantine | Opinionated styling conflicts with pixel-perfect handoff; large bundle |
| Sidebar animation | CSS `grid-template-columns` | Framer Motion `animate` | 30KB for a single transition; CSS handles this natively |
| Sidebar animation | CSS `grid-template-columns` | CSS `width` transition | `width` triggers layout recalculation; `grid-template-columns` is composited |
| Icons | lucide-react (existing) | @heroicons/react (also existing) | Both are installed; standardize on Lucide for consistency; Heroicons kept for legacy screens |

## Tailwind v4 Migration Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Dynamic class construction breaks | HIGH | Grep for template literal class names before migration; the codemod cannot detect these |
| `tailwindcss-animate` incompatibility | MEDIUM | Manually port 2 keyframe animations (accordion-down, accordion-up) to CSS `@keyframes` |
| Default border/ring color changes | MEDIUM | The codemod handles most; visual regression test key screens after migration |
| `tailwind-merge` edge cases with v4 classes | LOW | v3.3.1 of tailwind-merge supports v4; monitor for edge cases |
| Third-party component libraries using v3 classes | LOW | Only Headless UI (unstyled) and dnd-kit (functional, not visual) |

## Sources

- [Tailwind CSS v4 Theme Variables — Official Docs](https://tailwindcss.com/docs/theme) — HIGH confidence
- [Tailwind CSS v4 Upgrade Guide — Official Docs](https://tailwindcss.com/docs/upgrade-guide) — HIGH confidence
- [Tailwind CSS v4 Release Blog](https://tailwindcss.com/blog/tailwindcss-v4) — HIGH confidence
- [@theme vs @theme inline — GitHub Discussion #18560](https://github.com/tailwindlabs/tailwindcss/discussions/18560) — HIGH confidence
- [Theming best practices in v4 — GitHub Discussion #18471](https://github.com/tailwindlabs/tailwindcss/discussions/18471) — MEDIUM confidence
- [tailwind-merge v4 support — GitHub Discussion #468](https://github.com/dcastil/tailwind-merge/discussions/468) — MEDIUM confidence
- [Headless UI v2.1 — Tailwind CSS Blog](https://tailwindcss.com/blog/2024-06-21-headless-ui-v2-1) — HIGH confidence
- [shadcn/ui Sidebar — Official Docs](https://v3.shadcn.com/docs/components/sidebar) — reviewed but not recommended
- [Design Tokens for Tailwind v4 — MatchKit Guide](https://www.matchkit.io/blog/design-tokens-tailwind-v4) — LOW confidence (blog)
- [Tailwind v4 Migration Best Practices — Digital Applied](https://www.digitalapplied.com/blog/tailwind-css-v4-2026-migration-best-practices) — LOW confidence (blog)

---

*Stack research: 2026-05-18*
