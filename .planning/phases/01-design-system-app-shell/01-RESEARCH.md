# Phase 1: Design System & App Shell - Research

**Researched:** 2026-05-18
**Domain:** Tailwind v4 migration, design token system, component library, collapsible sidebar shell
**Confidence:** HIGH

## Summary

Phase 1 establishes the canonical design system and deploys a new collapsible sidebar + sticky topbar shell to all authenticated pages. The work divides into four ordered steps: (1) Tailwind v4 migration and design token foundation via `@theme`, (2) 13 primitive components in `src/ds/primitives/`, (3) 7 composite components plus the custom icon set in `src/ds/composites/` and `src/ds/icons/`, and (4) the app shell (Sidebar, Topbar, AppShell) that replaces `AuthenticatedLayout.tsx`.

The project is in a hybrid state: `@tailwindcss/postcss@4.2.1` is installed but unused -- the codebase runs on Tailwind v3.4.19 syntax with `@tailwind base;` directives and a JS config file. The official `@tailwindcss/upgrade` codemod handles ~90% of the mechanical migration. The design handoff provides exact CSS custom property definitions in `styles.css`, 38 SVG icon paths in `icons.jsx`, component specs in `ui.jsx`, and shell layout in `nav.jsx` / `app.jsx`.

**Primary recommendation:** Run the codemod first to get Tailwind v4 working, then replace all existing CSS variables with the design handoff's token set in a single `@theme` block. Build `src/ds/` as an isolated library with zero imports from `ui-v2/`. Deploy the shell by swapping `AuthenticatedLayout.tsx` to wrap `AppShell` around `PermissionProvider` -- auth logic in `layout.tsx` stays untouched.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
1. Sidebar shows ALL nav items from day one (including unbuilt sections). Quotes added to Finance group.
2. FOH mode filtering preserved in new sidebar. Port restriction logic from current AppNavigation.
3. Always start collapsed (64px), no persistent state / localStorage. Hover to expand to 232px. Mobile: hamburger menu overlay.
4. Build full custom icon set (~40 icons) from design handoff. Close match from Lucide/Heroicons acceptable for sidebar.
5. Hard boundary -- no early component swaps. ds/ is self-contained. No ui-v2/ imports in ds/ components.
6. Directory: src/ds/primitives/, src/ds/composites/, src/ds/icons/, src/ds/tokens/ with barrel file.
7. Run @tailwindcss/upgrade codemod + manual @theme token layer.
8. @theme in globals.css as primary source of truth, tokens.ts for JS access.
9. Replace existing CSS vars entirely with design tokens (clean break). No aliases, no gradual migration.

### Claude's Discretion
- Component API details (prop names, variant naming)
- Internal file structure within ds/ subdirectories
- CSS architecture decisions (Tailwind utilities vs. component classes)
- Testing approach for components

### Deferred Ideas (OUT OF SCOPE)
- Dark mode toggle (v2, not v1)
- Density system comfortable/spacious presets (v2)
- Brand colour switching (v2)
- Persistent sidebar state via localStorage (decided against)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DS-01 | Migrate Tailwind from v3 to v4 native | Codemod approach verified; v4.3.0 is latest; hybrid state documented |
| DS-02 | Design tokens via @theme block | Full token set extracted from handoff styles.css; @theme naming conventions verified |
| DS-03 | Inter + JetBrains Mono via next/font | Font weights from handoff: Inter 400-800, JetBrains Mono 400-600 |
| DS-04 | Button (4 variants, 3 sizes, icon, loading) | Exact spec from ui.jsx: primary/secondary/ghost/danger, sm/md/lg, btn-h CSS vars |
| DS-05 | Card (header, body, footer) | Exact spec from ui.jsx and styles.css: card__header, card__body, card__footer |
| DS-06 | Stat tile (label, value, delta, icon, hint) | Exact spec from ui.jsx: delta direction, trend icons, tabular-nums |
| DS-07 | Badge (6 tones, optional dot) | Exact spec: neutral/primary/success/warning/danger/info with dot indicator |
| DS-08 | Tabs (underline style with count pills) | Exact spec from ui.jsx: tab-count, active border-bottom |
| DS-09 | Segmented control (sliding active) | Exact spec from ui.jsx: segmented with active box-shadow |
| DS-10 | Alert (4 tones with icon, title, body) | Exact spec: success/warning/danger/info with color-mix borders |
| DS-11 | Modal (backdrop, card, header/body/footer) | Exact spec from ui.jsx: Headless UI Dialog for accessibility |
| DS-12 | Avatar (initials, deterministic colour, 4 sizes) | Exact spec: 6 named colours, pickColor hash, sm/md/lg/xl sizes, AvatarStack |
| DS-13 | Table (header/body/row/cell, hover, sort, pagination) | Exact spec from styles.css: table-wrap, pad-cell, surface-2 header bg |
| DS-14 | Form controls (Input, Select, Textarea, Checkbox, Radio, Switch) | All 6 controls specified in ui.jsx with Field wrapper |
| DS-15 | PageHeader (breadcrumbs, title, subtitle, actions) | Exact spec from ui.jsx: crumbs with chevron separators |
| DS-16 | SectionNav horizontal pill strip | Exact spec from nav.jsx and styles.css: section-nav__item with count |
| DS-17 | Empty state (icon, title, body, action) | Exact spec from ui.jsx: empty__icon, empty__title, empty__body |
| DS-18 | Toast (colour dot, text, tone) | Exact spec from ui.jsx: toast__dot with tone colours |
| DS-19 | Skeleton shimmer | Exact spec from styles.css: skel-shimmer keyframe animation |
| DS-20 | 38+ SVG icon set (16px on 24x24 viewBox, strokeWidth 1.75) | All 38 icon paths extracted from icons.jsx |
| SHELL-01 | Collapsible sidebar (64px/232px, 200ms transition) | Design spec: hover/focus-within expand, CSS transition with custom ease |
| SHELL-02 | Sidebar nav groups with icons and active indicator | 5 groups from nav.jsx: Primary, Operations, Staff Ops, Finance, Settings |
| SHELL-03 | Sticky topbar (52px, search, bell, New button) | Exact spec from styles.css: topbar height, search input, icon-btn |
| SHELL-04 | Sidebar user footer (avatar, name, role) | Exact spec from nav.jsx: sidebar__user with avatar initials |
| SHELL-05 | Replace AuthenticatedLayout with AppShell | Auth in layout.tsx (server) stays; shell is client component swap |
| SHELL-06 | Backward compatibility -- existing pages work in new shell | Adapter pattern: old PageLayout renders inside new shell content area |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tailwindcss | 4.3.0 | CSS framework + token system | `@theme` directive is the foundation; v4.3.0 is current latest |
| @tailwindcss/postcss | 4.3.0 | PostCSS integration | Already installed at 4.2.1; upgrade to match |
| @headlessui/react | 2.2.4 | Modal, Listbox (accessible headless primitives) | Already installed; v2.1+ compatible with v4 |
| next/font | 15.x | Font loading (Inter, JetBrains Mono) | Built-in, zero-FOUT, auto size-adjust |
| tailwind-merge | 3.3.1 | Class name deduplication in cn() | Already installed; v3 supports Tailwind v4 |
| clsx | 2.1.1 | Conditional class composition | Already installed; used in cn() |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | 0.522.0 | Sidebar nav icons (close-match acceptable) | Only for sidebar icons per user decision; ds/icons/ for everything else |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @theme tokens | Style Dictionary | Over-engineering for single-brand light-mode-only project |
| Custom components | shadcn/ui | Would add Radix alongside Headless UI; 200+ files import ui-v2 already |
| CSS transitions | Framer Motion | 30KB for sidebar collapse; CSS handles this natively |

### Remove
| Package | Reason |
|---------|--------|
| tailwindcss-animate (^1.0.7) | Incompatible with v4; accordion keyframes unused in codebase; replace with CSS @keyframes |
| tailwindcss (^3.4.0 in package.json) | v4 provided by @tailwindcss/postcss; remove the v3 dependency |

**Installation:**
```bash
# Upgrade Tailwind v4 packages
npm install @tailwindcss/postcss@latest

# Remove v3 artifacts
npm uninstall tailwindcss tailwindcss-animate
```

## Architecture Patterns

### Directory Structure
```
src/ds/
  primitives/
    Button.tsx              # 4 variants, 3 sizes, icon, loading
    Badge.tsx               # 6 tones, optional dot
    Avatar.tsx              # Initials, deterministic colour, 4 sizes, AvatarStack
    Alert.tsx               # 4 tones, icon, title, body
    Modal.tsx               # Headless UI Dialog wrapper
    Skeleton.tsx            # Shimmer loading placeholder
    Empty.tsx               # Icon + title + body + optional action
    Toast.tsx               # Colour dot + text + tone
    Input.tsx               # Input with Field wrapper, icon support
    Select.tsx              # Select with chevron
    Textarea.tsx            # Auto-grow textarea
    Checkbox.tsx            # Checkbox + label
    Radio.tsx               # Radio + label
    Switch.tsx              # Toggle switch
    index.ts                # Barrel export
  composites/
    Card.tsx                # Header (title/subtitle/action) + body + footer
    Stat.tsx                # Label + value + delta + icon + hint
    PageHeader.tsx          # Breadcrumbs + title + subtitle + actions
    SectionNav.tsx          # Horizontal pill strip
    Tabs.tsx                # Underline tabs with count pills
    Segmented.tsx           # Inline button group with active state
    Table.tsx               # Table wrapper with header/body/cell styling
    index.ts                # Barrel export
  icons/
    Icon.tsx                # SVG wrapper (16px default, 24x24 viewBox, strokeWidth 1.75)
    paths.ts                # All 38 icon SVG path definitions
    index.ts                # Named exports (HomeIcon, CalendarIcon, etc.)
  tokens/
    index.ts                # JS re-exports of CSS custom properties for charts/dynamic styles
  shell/
    Sidebar.tsx             # Collapsible 64px/232px, nav groups, user footer
    Topbar.tsx              # 52px sticky, search placeholder, bell, New button
    AppShell.tsx            # Sidebar + Topbar + content area
    SidebarNav.tsx          # Navigation groups with items, icons, counts, active state
    UserFooter.tsx          # Avatar + name + role
    index.ts                # Barrel export
  index.ts                  # Top-level barrel: re-export all sub-modules
```

### Pattern 1: Design Tokens via @theme

**What:** All visual tokens defined as CSS custom properties in a single `@theme` block in `globals.css`. The design handoff `styles.css` provides exact values.

**When to use:** Every component references tokens -- never hardcoded hex values.

**Implementation:**
```css
/* globals.css */
@import "tailwindcss";

@theme {
  /* Brand palette -- from design handoff styles.css */
  --color-brand-50: #ecfdf5;
  --color-brand-100: #d1fae5;
  --color-brand-200: #a7f3d0;
  --color-brand-300: #6ee7b7;
  --color-brand-400: #34d399;
  --color-brand-500: #10b981;
  --color-brand-600: #006A4E;
  --color-brand-700: #064e3b;
  --color-brand-800: #043927;
  --color-brand-900: #022c1a;

  /* Semantic -- light theme (v1 only) */
  --color-bg: #fafaf9;
  --color-surface: #ffffff;
  --color-surface-2: #fafaf9;
  --color-surface-hover: #f5f5f4;
  --color-border: #ececea;
  --color-border-strong: #d6d3d1;
  --color-border-focus: #34d399;
  --color-text: #1c1917;
  --color-text-strong: #0c0a09;
  --color-text-muted: #57534e;
  --color-text-subtle: #a8a29e;

  /* Primary */
  --color-primary: #006A4E;
  --color-primary-hover: #064e3b;
  --color-primary-soft: #ecfdf5;
  --color-primary-soft-fg: #043927;
  --color-primary-fg: #ffffff;

  /* Sidebar */
  --color-sidebar-bg: #064e3b;
  --color-sidebar-fg: #ffffff;
  --color-sidebar-fg-muted: rgba(255, 255, 255, 0.72);
  --color-sidebar-active-bg: rgba(255, 255, 255, 0.16);
  --color-sidebar-hover-bg: rgba(255, 255, 255, 0.08);
  --color-sidebar-border: rgba(255, 255, 255, 0.12);

  /* Status */
  --color-success: #16a34a;
  --color-success-soft: #f0fdf4;
  --color-success-fg: #166534;
  --color-warning: #d97706;
  --color-warning-soft: #fffbeb;
  --color-warning-fg: #92400e;
  --color-danger: #dc2626;
  --color-danger-soft: #fef2f2;
  --color-danger-fg: #991b1b;
  --color-info: #0284c7;
  --color-info-soft: #f0f9ff;
  --color-info-fg: #075985;

  /* Typography */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Density -- compact default (v1 only, --density: 0.9) */
  --spacing-row-h: 29px;
  --spacing-row-h-lg: 36px;
  --spacing-input-h: 31px;
  --spacing-btn-h: 31px;
  --spacing-btn-h-sm: 25px;
  --spacing-btn-h-lg: 36px;

  /* Layout */
  --spacing-sidebar-expanded: 232px;
  --spacing-sidebar-collapsed: 64px;
  --spacing-topbar: 52px;
  --spacing-pad-card: 14px;

  /* Radii */
  --radius-sm: 6px;
  --radius-default: 8px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-pill: 9999px;

  /* Shadows */
  --shadow-xs: 0 1px 0 rgba(15, 23, 42, 0.04);
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.06), 0 1px 1px rgba(15, 23, 42, 0.04);
  --shadow-default: 0 2px 4px -1px rgba(15, 23, 42, 0.06), 0 4px 10px -4px rgba(15, 23, 42, 0.08);
  --shadow-lg: 0 12px 28px -8px rgba(15, 23, 42, 0.18);
  --shadow-ring: 0 0 0 3px color-mix(in oklch, var(--color-primary) 30%, transparent);

  /* Easing */
  --ease-default: cubic-bezier(0.2, 0.7, 0.1, 1);
}
```

**Token naming convention:** Tailwind v4 uses prefixes to auto-generate utility classes: `--color-*` creates `bg-*`, `text-*`; `--font-*` creates `font-*`; `--radius-*` creates `rounded-*`; `--shadow-*` creates `shadow-*`. The naming above follows this convention.

### Pattern 2: Component Variant API

**What:** Components use `variant`/`tone`/`size` props with `cn()` for class composition. No raw className overrides for core styling.

```typescript
// src/ds/primitives/Button.tsx
'use client'

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ds/icons'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: string
  iconRight?: string
  loading?: boolean
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg border-primary hover:bg-primary-hover hover:border-primary-hover shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_1px_2px_rgba(0,0,0,0.08)]',
  secondary: 'bg-surface text-text border-border-strong hover:bg-surface-hover',
  ghost: 'bg-transparent text-text border-transparent hover:bg-surface-hover',
  danger: 'bg-danger text-white border-danger hover:brightness-95',
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-[var(--spacing-btn-h-sm)] px-2.5 text-xs rounded-[7px]',
  md: 'h-[var(--spacing-btn-h)] px-3 text-[13px] rounded-[8px]',
  lg: 'h-[var(--spacing-btn-h-lg)] px-4 text-sm rounded-[9px]',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', icon, iconRight, loading, children, className, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 border font-semibold whitespace-nowrap transition-[background,border-color,color,transform,box-shadow] duration-[120ms] select-none tracking-[-0.005em]',
        'focus-visible:outline-none focus-visible:shadow-ring',
        'active:translate-y-[0.5px]',
        variantStyles[variant],
        sizeStyles[size],
        !children && size === 'sm' && 'w-[var(--spacing-btn-h-sm)] px-0',
        !children && size !== 'sm' && 'w-[var(--spacing-btn-h)] px-0',
        (disabled || loading) && 'opacity-50 cursor-not-allowed',
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="animate-spin">...</span> : icon ? <Icon name={icon} /> : null}
      {children}
      {iconRight && <Icon name={iconRight} />}
    </button>
  )
)
Button.displayName = 'Button'
```

### Pattern 3: Server/Client Component Split

**Server Components (no directive):** Badge, Avatar, Stat, Card, Alert, Empty, PageHeader, Icon, Skeleton, Table

**Client Components (`'use client'`):** Button (onClick), Modal (open/close state, Headless UI Dialog), Sidebar (hover state), Topbar (search input), AppShell (sidebar state), Tabs (active tab), Segmented (active option), SectionNav (active item), Input/Select/Textarea/Checkbox/Radio/Switch (onChange), Toast (auto-dismiss)

### Pattern 4: Shell Layout with CSS Flexbox

**What:** The design handoff uses `display: flex` (not CSS Grid) for the app shell. The sidebar is a fixed-width flex column, the main area is `flex: 1`.

```tsx
// src/ds/shell/AppShell.tsx
'use client'

import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar />
        <main className="flex-1 overflow-auto bg-bg p-[22px_28px_40px]">
          {children}
        </main>
      </div>
    </div>
  )
}
```

### Pattern 5: Sidebar Hover-to-Expand (CSS-only)

**What:** The design uses CSS `:hover` and `:focus-within` to expand the sidebar -- NOT JavaScript state. This matches the handoff exactly and avoids managing expand/collapse state.

**Why this approach:** User decided "always start collapsed, no persistent state." The design handoff CSS already implements this pattern purely with CSS transitions on `.sidebar:hover`.

```tsx
// Sidebar uses className-based CSS approach, no useState for collapse
// Width transitions from 64px to 232px on hover via CSS
// Labels, group headings, counts have opacity/max-width transitions
// The sidebar is position: sticky, top: 0, height: 100vh
```

### Pattern 6: AuthenticatedLayout Replacement

**Critical path:** The auth guard in `(authenticated)/layout.tsx` (server component) MUST NOT change. Only `AuthenticatedLayout.tsx` (client component) changes.

```
Current:
  layout.tsx (server) -> AuthenticatedLayout (client) -> PermissionProvider -> children

Target:
  layout.tsx (server) -> AuthenticatedLayout (client) -> PermissionProvider -> AppShell -> children
```

The swap is a single-file change to `AuthenticatedLayout.tsx`: wrap `{children}` in `<AppShell>` and remove the old sidebar/mobile menu JSX. FOH mode detection stays in the same location.

### Anti-Patterns to Avoid

- **Importing from ui-v2/ in ds/ components** -- ds/ is self-contained. No cross-system imports.
- **Modifying layout.tsx auth logic** -- Only touch AuthenticatedLayout.tsx (the client shell).
- **Hardcoded hex colours** -- Always use token CSS variables.
- **`'use client'` on display-only components** -- Badge, Avatar, Stat, Card, Alert, Empty, PageHeader, Icon should be server components.
- **Building full search/New button functionality** -- Phase 1 renders UI-only placeholders.
- **Modifying any existing page content** -- Phase 1 only changes the shell chrome. Page internals are Phase 2.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Modal focus trap + ESC close | Custom focus management | Headless UI Dialog | 100+ a11y edge cases (focus restoration, scroll lock, portal) |
| Accessible dropdown menus | Custom keyboard nav | Headless UI Menu | Arrow key nav, ARIA roles, click-outside |
| Accessible select/combobox | Custom select widget | Headless UI Listbox | Typeahead, multi-select, virtual scroll |
| Class name deduplication | String concatenation | tailwind-merge via cn() | Handles Tailwind specificity rules correctly |
| Font loading without FOUT | External Google Fonts link | next/font/google | Self-hosting, preload, size-adjust, zero layout shift |
| Deterministic avatar colours | Random colour assignment | Hash function from ui.jsx | `pickColor()` -- consistent colour per name string |
| Sidebar active state detection | Manual route mapping | usePathname() + prefix match | Next.js hook; handles nested routes automatically |

## Common Pitfalls

### Pitfall 1: Tailwind v4 Default Border/Ring Changes
**What goes wrong:** v4 changed default `border` color from gray to `currentColor`, default `ring` width from 3px to 1px, `ring` color from blue to `currentColor`. Every component using plain `border` or `ring` looks different after migration.
**Why it happens:** The codemod updates class names but cannot change implicit defaults.
**How to avoid:** After running the codemod, grep for bare `border` and `ring` classes. Add explicit colours: `border-border` instead of bare `border`. The design handoff specifies exact border treatments.
**Warning signs:** Borders suddenly much darker or invisible after migration.

### Pitfall 2: Three Concurrent Token Systems
**What goes wrong:** The codebase has (1) HSL CSS vars in globals.css (`--primary: 142.1 76.2% 36.3%`), (2) JS tokens in `ui-v2/tokens.ts` (`#16a34a`), and (3) the new design handoff tokens (`#006A4E`). All three defining "primary green" differently.
**Why it happens:** The new `@theme` block replaces globals.css vars, but ui-v2/tokens.ts still exports the old green. Components importing from both systems show inconsistent colours.
**How to avoid:** In Plan 01-01 (token foundation), the clean break removes ALL existing `:root` CSS vars and replaces with `@theme`. The old `tokens.ts` stays for ui-v2 components (not removed until Phase 4) but NO new code should import it. New `src/ds/tokens/index.ts` re-exports CSS var references only.
**Warning signs:** Two different greens visible on same page.

### Pitfall 3: AuthenticatedLayout is Historically Fragile
**What goes wrong:** This file handles auth state, sign-out, mobile menu, FOH detection, and permission context. Modifying it has caused production incidents before (middleware was disabled after a Vercel incident).
**Why it happens:** Single file with multiple responsibilities: auth, navigation, and layout.
**How to avoid:** The swap is surgical: replace the sidebar JSX and mobile overlay with `<AppShell>`. Do NOT move auth logic, sign-out handling, or permission context wiring. The `PermissionProvider` wrapper stays exactly where it is. The `isFohOnlyUser` check stays in the same component and gates whether AppShell renders the sidebar.
**Warning signs:** Any change to `createClient()`, `auth.getUser()`, `PermissionProvider`, or `redirect()` in the layout chain.

### Pitfall 4: Sidebar Width Transition Jank
**What goes wrong:** The sidebar expands from 64px to 232px. If the transition is on `width` property, it triggers layout recalculation for the entire page on every frame, causing jank.
**Why it happens:** CSS `width` transitions are not GPU-composited. Content reflows during animation.
**How to avoid:** The design handoff uses CSS `width` transition with its custom ease curve on the `.sidebar` class directly. This is acceptable because: (1) the sidebar is `position: sticky` so it doesn't reflow the main content, (2) the main content area is `flex: 1` which just fills remaining space, (3) the 200ms duration is short enough that any jank is imperceptible. Follow the handoff exactly -- don't over-engineer with `transform: translateX` tricks.
**Warning signs:** Visible stutter during sidebar expand on low-end devices.

### Pitfall 5: postcss.config.mjs Must Change
**What goes wrong:** The current `postcss.config.mjs` uses `tailwindcss: {}` (v3 plugin). After the codemod runs, it must use `@tailwindcss/postcss: {}`. If this file isn't updated, the build uses v3 engine despite v4 being installed.
**Why it happens:** The codemod should handle this, but verify manually.
**How to avoid:** After codemod, confirm postcss.config.mjs contains:
```javascript
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
```
**Warning signs:** Build still works but `@theme` tokens don't generate utility classes.

### Pitfall 6: 200 Files Import from ui-v2
**What goes wrong:** 200 files import from `@/components/ui-v2/`. If any ds/ component inadvertently imports from ui-v2, it creates a circular dependency between the two systems.
**How to avoid:** ESLint rule or manual review: no file under `src/ds/` may import from `src/components/ui-v2/`. The ds/ library is self-contained.

## Code Examples

### Icon Component (from handoff icons.jsx)
```typescript
// src/ds/icons/Icon.tsx
import { iconPaths } from './paths'

type IconName = keyof typeof iconPaths

interface IconProps {
  name: IconName
  size?: number
  className?: string
  style?: React.CSSProperties
}

export function Icon({ name, size = 16, className, style }: IconProps): React.ReactElement | null {
  const paths = iconPaths[name]
  if (!paths) return null

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, display: 'inline-block', ...style }}
    >
      {paths}
    </svg>
  )
}
```

### Sidebar Collapsed/Expanded CSS (from handoff styles.css)
```css
/* Key CSS rules for sidebar collapse/expand */
.ds-sidebar {
  width: 64px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: hidden;
  transition: width 200ms var(--ease-default);
  z-index: 20;
}
.ds-sidebar:hover,
.ds-sidebar:focus-within {
  width: 232px;
  box-shadow: var(--shadow-lg);
  overflow-y: auto;
}
/* Labels fade in on expand */
.ds-sidebar .label {
  opacity: 0;
  max-width: 0;
  overflow: hidden;
  transition: opacity 120ms, max-width 180ms;
}
.ds-sidebar:hover .label,
.ds-sidebar:focus-within .label {
  opacity: 1;
  max-width: 200px;
  transition-delay: 60ms;
}
```

### Nav Group Data Structure
```typescript
// From nav.jsx -- the canonical nav group structure
export const NAV_GROUPS = [
  {
    label: null, // Primary -- no label
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'home', href: '/' },
      { id: 'events', label: 'Events', icon: 'calendar', href: '/events' },
      { id: 'performers', label: 'Performers', icon: 'mic', href: '/performers' },
      { id: 'customers', label: 'Customers', icon: 'users', href: '/customers' },
      { id: 'messages', label: 'Messages', icon: 'message', href: '/messages' },
    ],
  },
  {
    label: null, // Operations
    items: [
      { id: 'menu', label: 'Menu Management', icon: 'grid', href: '/menu-management' },
      { id: 'tables', label: 'Table Bookings', icon: 'table', href: '/table-bookings' },
      { id: 'private-bookings', label: 'Private Bookings', icon: 'building', href: '/private-bookings' },
      { id: 'parking', label: 'Parking', icon: 'truck', href: '/parking' },
    ],
  },
  {
    label: null, // Staff Ops
    items: [
      { id: 'employees', label: 'Employees', icon: 'user', href: '/employees' },
      { id: 'rota', label: 'Rota', icon: 'clock', href: '/rota' },
    ],
  },
  {
    label: null, // Finance (Quotes added per user decision)
    items: [
      { id: 'cashing-up', label: 'Cashing Up', icon: 'cash', href: '/cashing-up/dashboard' },
      { id: 'invoices', label: 'Invoices', icon: 'file', href: '/invoices' },
      { id: 'quotes', label: 'Quotes', icon: 'file', href: '/quotes' },
      { id: 'projects', label: 'OJ Projects', icon: 'briefcase', href: '/oj-projects' },
      { id: 'receipts', label: 'Receipts', icon: 'receipt', href: '/receipts' },
      { id: 'mileage', label: 'Mileage', icon: 'map', href: '/mileage' },
      { id: 'expenses', label: 'Expenses', icon: 'pound', href: '/expenses' },
      { id: 'mgd', label: 'MGD', icon: 'trendUp', href: '/mgd' },
      { id: 'short-links', label: 'Short Links', icon: 'link', href: '/short-links' },
    ],
  },
  {
    label: null, // Settings
    items: [
      { id: 'settings', label: 'Settings', icon: 'cog', href: '/settings' },
      { id: 'system', label: 'Design System', icon: 'palette', href: '/design-system' },
    ],
  },
]
```

### FOH Mode Integration
```typescript
// FOH detection stays in AuthenticatedLayout -- no change needed
// src/lib/foh/user-mode.ts is the existing utility
import { isFohOnlyUser } from '@/lib/foh/user-mode'

// In AuthenticatedLayout, the pattern is:
// if (fohOnlyMode) redirect to /table-bookings/foh
// else render AppShell with sidebar
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| tailwind.config.js (JS) | @theme in CSS | Tailwind v4 (Jan 2025) | All tokens move to CSS; JS config removed |
| @tailwind base/components/utilities | @import "tailwindcss" | Tailwind v4 (Jan 2025) | Single import replaces three directives |
| HSL CSS variables (shadcn pattern) | Direct hex/rgba in @theme | Design handoff decision | Clean break from existing shadcn-style vars |
| `tailwindcss-animate` plugin | CSS @keyframes in @theme | Tailwind v4 (Jan 2025) | Plugins replaced by native CSS |
| bg-sidebar (#005131) | bg-sidebar-bg (#064e3b) | Design handoff | New bottle green palette |
| ui-v2/tokens.ts (#16a34a) | @theme --color-primary (#006A4E) | This phase | Token source of truth moves to CSS |

**Important version note:** Tailwind CSS v4.3.0 is the current latest (verified via npm registry). The project has `@tailwindcss/postcss@4.2.1` installed. Upgrade to 4.3.0 during migration.

## Open Questions

1. **Content file scanning after v4 migration**
   - What we know: Tailwind v4 auto-detects content files (no explicit `content:` config needed). But the project has custom content paths including `src/pages/` (legacy).
   - What's unclear: Whether auto-detection covers all file locations.
   - Recommendation: After codemod, verify build includes all classes. If missing, add `@source` directive.

2. **Mobile sidebar overlay implementation**
   - What we know: User wants hamburger menu overlay on mobile. Current implementation uses a fixed overlay div with `bg-gray-600 bg-opacity-75` backdrop.
   - What's unclear: Whether to use Headless UI Dialog for the mobile sheet (a11y benefits) or a simpler fixed-position overlay.
   - Recommendation: Use Headless UI Dialog for mobile sidebar -- provides focus trap, ESC close, backdrop click, and ARIA attributes for free.

3. **Existing tailwindcss-animate usage**
   - What we know: Package is installed and imported in tailwind.config.js. Grep shows zero usage of accordion-down/accordion-up animations in source code.
   - What's unclear: Whether any v3 CSS class from tailwindcss-animate is used implicitly.
   - Recommendation: Remove the package. The only animation in the codebase is `animate-slide-up` defined manually in globals.css -- this stays as a CSS @keyframes.

## Sources

### Primary (HIGH confidence)
- Design handoff `styles.css` -- complete token set, all component CSS, shell layout CSS
- Design handoff `ui.jsx` -- all 20 component specifications with exact prop APIs
- Design handoff `nav.jsx` -- Sidebar, Topbar, SectionNav specifications
- Design handoff `icons.jsx` -- all 38 SVG icon path definitions
- Design handoff `app.jsx` -- AppShell layout, FOH mode, chromeless mode
- [Tailwind CSS v4 Upgrade Guide](https://tailwindcss.com/docs/upgrade-guide) -- official codemod documentation
- [Tailwind CSS v4 Theme Variables](https://tailwindcss.com/docs/theme) -- @theme directive documentation
- Codebase analysis: `AuthenticatedLayout.tsx`, `AppNavigation.tsx`, `globals.css`, `tailwind.config.js`, `postcss.config.mjs`, `src/lib/foh/user-mode.ts`

### Secondary (MEDIUM confidence)
- [Tailwind v4 Design Tokens Guide](https://seedflip.co/blog/tailwind-v4-theme-directive) -- token naming conventions
- [Tailwind v4 Migration Best Practices](https://www.digitalapplied.com/blog/tailwind-css-v4-2026-migration-best-practices) -- real-world migration timelines
- npm registry version checks -- tailwindcss@4.3.0 confirmed as latest

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed, versions verified against npm registry
- Architecture: HIGH -- based on direct design handoff analysis and codebase audit
- Pitfalls: HIGH -- based on codebase-specific file analysis (200 ui-v2 imports, hybrid Tailwind state, fragile AuthenticatedLayout)
- Token mapping: HIGH -- exact values from design handoff styles.css

**Research date:** 2026-05-18
**Valid until:** 2026-06-18 (stable; Tailwind v4 is released and design handoff is fixed)
