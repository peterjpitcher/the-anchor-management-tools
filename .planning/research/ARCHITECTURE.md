# Architecture Patterns

**Domain:** Design system + incremental UI migration for production Next.js 15 management app
**Researched:** 2026-05-18

## Recommended Architecture

### Design System Directory Structure

```
src/
  ds/                                    # Design system root (NOT under components/)
    tokens/
      colors.ts                          # Brand palette, semantic colours
      typography.ts                      # Font families, sizes, weights, line heights
      spacing.ts                         # Gap, padding, margin scale
      radii.ts                           # Border radius values
      shadows.ts                         # Shadow tokens
      density.ts                         # Compact density scale (row-h, btn-h, input-h, etc.)
      index.ts                           # Barrel export of all tokens
    primitives/
      Button.tsx                         # btn variants: primary, secondary, ghost, danger
      Badge.tsx                          # tone-based: neutral, success, warning, danger, info
      Input.tsx                          # Field + Input + icon support
      Select.tsx                         # Styled select with chevron
      Textarea.tsx                       # Auto-growing textarea
      Checkbox.tsx                       # Checkbox with label
      Radio.tsx                          # Radio with label
      Switch.tsx                         # Toggle switch
      Avatar.tsx                         # Initials + image, deterministic colour
      Stat.tsx                           # Label + value + optional delta/trend
      Alert.tsx                          # Tone-based alert banner
      Skeleton.tsx                       # Loading placeholder
      Empty.tsx                          # Empty state with icon + title + body + action
      Modal.tsx                          # Overlay dialog with header/body/footer
      Toast.tsx                          # Notification toast
      Tooltip.tsx                        # Hover tooltip
      index.ts                           # Barrel export
    composites/
      Card.tsx                           # Card with header/body/footer
      PageHeader.tsx                     # Crumbs + title + subtitle + actions
      SectionNav.tsx                     # Horizontal pill sub-page strip
      Tabs.tsx                           # Tab bar with counts
      Segmented.tsx                      # Segmented control
      DataTable.tsx                      # Table with sort, filter, pagination
      FilterBar.tsx                      # Toolbar with search + filters + view toggle
      index.ts                           # Barrel export
    shell/
      Sidebar.tsx                        # Collapsible sidebar (64px / 232px)
      Topbar.tsx                         # Search + theme toggle + notifications + "New"
      AppShell.tsx                       # Combines Sidebar + Topbar + content area
      SidebarNav.tsx                     # Navigation groups + items + counts
      UserFooter.tsx                     # User avatar + name + role at sidebar bottom
      index.ts                           # Barrel export
    icons/
      Icon.tsx                           # Wrapper component (stroke-based SVG, size prop)
      paths.ts                           # All icon SVG path data (38+ icons from handoff)
      index.ts                           # Named exports: HomeIcon, CalendarIcon, etc.
    hooks/
      useSidebar.ts                      # Collapse/expand state + hover behaviour
      useDensity.ts                      # Density multiplier (compact only for v1)
      useCommandPalette.ts               # Cmd+K search overlay
    utils/
      cn.ts                              # Class name merger (re-export from lib/utils)
      pickColor.ts                       # Deterministic avatar colour from name
    index.ts                             # Top-level barrel: export * from each sub-module
```

**Why `src/ds/` instead of `src/components/ui-v3/`:**
- Clear separation from both legacy `ui/` and transitional `ui-v2/` -- no confusion about which is the target
- Short import paths: `@/ds/primitives` instead of `@/components/ui-v3/primitives`
- Makes the design system a first-class module, not a component subfolder
- Easy to identify in import statements which pattern a file uses (migration tracking)
- Can later be extracted to a shared package if needed across OJ projects

### Component Hierarchy

```
Layer 0: Tokens (colours, spacing, typography, shadows, radii, density)
    |
Layer 1: Primitives (Button, Badge, Input, Avatar, Alert, Modal, Toast, etc.)
    |
Layer 2: Composites (Card, PageHeader, SectionNav, Tabs, DataTable, FilterBar)
    |
Layer 3: Shell (Sidebar, Topbar, AppShell)
    |
Layer 4: Page templates (built per-screen using composites inside AppShell)
```

Each layer only imports from layers below it. No circular dependencies.

### Component Boundaries

| Component | Responsibility | Imports From |
|-----------|---------------|--------------|
| Tokens | CSS custom properties + TypeScript constants | Nothing |
| Icon | Render named SVG icon at given size | Tokens (colours) |
| Button | Interactive element with variants | Tokens, Icon |
| Badge | Status/count indicator | Tokens |
| Input/Select/Textarea | Form field primitives | Tokens, Icon |
| Checkbox/Radio/Switch | Boolean/choice inputs | Tokens |
| Avatar | User identity display | Tokens, `pickColor` utility |
| Stat | KPI metric display | Tokens, Icon |
| Alert | Contextual message banner | Tokens, Icon |
| Modal | Overlay dialog | Tokens, Icon, Button |
| Card | Content container with optional header | Tokens |
| PageHeader | Page title + breadcrumbs + actions | Tokens, Icon, Button |
| SectionNav | Horizontal sub-page navigation | Tokens, Icon |
| Tabs | Tab switcher with counts | Tokens, Icon |
| DataTable | Sortable/filterable data grid | Tokens, Icon, Badge, Button, Checkbox |
| FilterBar | Search + filter controls | Tokens, Icon, Button, Input, Select, Badge |
| Sidebar | Collapsible navigation rail | Tokens, Icon, Badge, Avatar, `useSidebar` |
| Topbar | Global header bar | Tokens, Icon, Button, Input |
| AppShell | Full page chrome (sidebar + topbar + content) | Sidebar, Topbar |

### Data Flow

**Design tokens flow down through CSS custom properties:**
1. `src/ds/tokens/` defines TypeScript constants AND generates CSS custom properties
2. `globals.css` imports the token CSS (replacing current HSL-based vars with design handoff vars)
3. Components reference tokens via `var(--brand-600)`, `var(--surface)`, etc.
4. Tailwind config maps design tokens to Tailwind utilities where beneficial

**Component composition flows via React props:**
1. Pages import `AppShell` from `@/ds/shell` (provides sidebar + topbar chrome)
2. Pages compose content using `PageHeader` + `SectionNav` + `Card` + primitives
3. Client interactivity uses `'use client'` only on components that need it (Sidebar, Topbar, forms, modals)
4. Server Components remain the default for page-level data fetching

## Migration Strategy

### The Three-Pattern Problem

The codebase currently has three UI pattern generations:

1. **Legacy `ui/`**: Only `SortableHeader.tsx` remains. Nearly fully deprecated.
2. **Current `ui-v2/`**: 65+ components across layout/navigation/display/forms/feedback/overlay. Used by all pages. The `PageLayout` + `HeaderNav` + `Card` pattern.
3. **New `ds/`**: The target design system from the handoff bundle.

### Incremental Migration via AppShell Adapter

**Phase 1: Build the design system and shell side-by-side (no pages break)**

The new AppShell replaces `AuthenticatedLayout.tsx`. The key insight is that `AuthenticatedLayout.tsx` is a single Client Component wrapping all `(authenticated)` pages. Replacing it swaps the chrome for every page at once.

```
Current flow:
  (authenticated)/layout.tsx
    -> AuthenticatedLayout.tsx (old sidebar + main content)
      -> children (pages using ui-v2 PageLayout)

Target flow:
  (authenticated)/layout.tsx
    -> AppShell (new sidebar + topbar + content area)
      -> children (pages using ds/ PageHeader + composites)
```

**Migration adapter approach:**
1. Build `AppShell` in `src/ds/shell/` that provides the new sidebar and topbar
2. Create an `AppShellAdapter` that wraps old `PageLayout`-based pages inside the new shell
3. Swap `AuthenticatedLayout.tsx` to use `AppShell` -- all pages immediately get new chrome
4. Old pages still render their `PageLayout` headers inside the new shell's content area (they look "double-headered" temporarily but function correctly)
5. Migrate pages one-by-one: replace `PageLayout` with `PageHeader` + `SectionNav` from `ds/`
6. Remove `ui-v2/` imports from each page as it migrates
7. After all pages migrate, delete `ui-v2/` entirely

**Why this works:**
- Every page continues to function at every step
- The shell swap is a single PR (one file: `AuthenticatedLayout.tsx`)
- Page migrations are independent PRs that can be done in any order
- No "big bang" rewrite that breaks production
- Each page migration is a ~2-3 complexity score change

### Handling the Double-Header Problem

When the AppShell is deployed but pages still use `PageLayout`, pages will show:
- AppShell topbar (new)
- PageLayout header (old, with its own title/subtitle/nav)

**Solution: PageLayout compatibility mode.**

Add a `shell` prop to `PageLayout` that, when the AppShell is detected via React context:
- Hides the PageLayout's outer wrapper styling (border, background)
- Preserves the title, subtitle, nav items, and actions
- Content renders flush with the shell

```typescript
// In PageLayout.tsx -- add AppShell context detection
const isInAppShell = useContext(AppShellContext)

// When inside AppShell, render a stripped-down version
if (isInAppShell) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={headerActions} />
      {navItems && <HeaderNav items={navItems} />}
      {children}
    </>
  )
}

// Otherwise, render the full standalone layout (backwards compatible)
return ( /* current implementation */ )
```

This means the shell swap PR can land without any page changes. Pages automatically adapt.

### Migration Tracking

Track migration status per page. Each page goes through:

| Status | Meaning |
|--------|---------|
| `legacy` | Uses `ui/` components (only `SortableHeader` remains) |
| `ui-v2` | Uses `PageLayout` + `HeaderNav` + `Card` from `ui-v2/` |
| `adapted` | Renders inside AppShell via adapter (functional but not redesigned) |
| `migrated` | Uses `ds/` PageHeader + SectionNav + composites (matches design handoff) |

Create a tracking file at `.planning/migration-status.md` listing all ~34 pages and their current status. Update as each page migrates.

## Build Order for Components

### Tier 1: Foundations (must be built first, everything depends on them)

Build order within tier:

1. **Tokens** (`src/ds/tokens/`) -- CSS custom properties + TypeScript constants from handoff `styles.css`
2. **Icons** (`src/ds/icons/`) -- SVG icon set from handoff `icons.jsx` (38+ icons)
3. **cn utility** (`src/ds/utils/cn.ts`) -- Class name merger (re-export existing `lib/utils.cn`)

**Dependency:** Nothing. These are leaf nodes.

### Tier 2: Primitives (used by composites and pages)

Can be built in parallel once Tier 1 is complete:

4. **Button** -- primary, secondary, ghost, danger variants; sm/md/lg sizes; icon support
5. **Badge** -- tone-based: neutral, success, warning, danger, info; optional dot
6. **Input** -- icon-prefixed input with Field wrapper (label, hint, error)
7. **Select** -- styled select with custom chevron
8. **Textarea** -- auto-growing textarea
9. **Checkbox** -- checkbox + label
10. **Radio** -- radio + label
11. **Switch** -- toggle switch
12. **Avatar** -- initials from name, deterministic colour, image support
13. **Stat** -- label + value + delta/trend indicator
14. **Alert** -- tone-based (success/warning/danger/info) with icon + title + body
15. **Skeleton** -- loading placeholder with configurable dimensions
16. **Empty** -- empty state: icon + title + body + optional action button
17. **Modal** -- backdrop + dialog with header/body/footer
18. **Toast** -- notification with tone dot
19. **Tooltip** -- hover tooltip

**Dependency:** Tokens + Icons only. No inter-primitive dependencies except Modal uses Button.

### Tier 3: Composites (built from primitives)

Requires Tier 2:

20. **Card** -- header (title + subtitle + action) + body + footer
21. **PageHeader** -- breadcrumbs + title + subtitle + action buttons
22. **SectionNav** -- horizontal pill strip for sub-page navigation
23. **Tabs** -- tab bar with icon + label + count
24. **Segmented** -- segmented control
25. **DataTable** -- table with column sort, cell rendering, pagination (wraps or replaces ui-v2 DataTable)
26. **FilterBar** -- search input + filter dropdowns + view toggle

**Dependency:** Primitives. Card depends on nothing extra. PageHeader uses Button + Icon. SectionNav uses Icon + Badge. DataTable uses Badge + Button + Checkbox + Icon.

### Tier 4: Shell (the navigation chrome)

Requires Tier 3 (specifically Icon, Badge, Avatar, Button):

27. **SidebarNav** -- navigation groups with items, icons, counts, active state
28. **UserFooter** -- avatar + name + role at bottom of sidebar
29. **Sidebar** -- brand mark + SidebarNav + UserFooter; collapsible 64px/232px
30. **Topbar** -- search input + theme toggle + notifications bell + "New" button
31. **AppShell** -- combines Sidebar + Topbar + content area; provides `AppShellContext`

**Dependency:** Primitives + composites. AppShell is the final piece that wraps the whole app.

### Tier 5: Page Migration (screen by screen)

Requires Tier 4 (AppShell deployed):

32. **Dashboard** -- first migration target (most visible, proves the pattern)
33. **Events** -- new section (built directly with ds/, no migration needed)
34. **Remaining pages** -- migrate in priority order per roadmap phase

## Patterns to Follow

### Pattern 1: Token-Driven Styling

**What:** All visual properties come from CSS custom properties defined in the token layer.

**When:** Every component, always.

**Example:**
```typescript
// src/ds/tokens/colors.ts
export const colors = {
  brand: {
    50: '#ecfdf5',
    600: '#006A4E',  // Bottle Green
    700: '#064e3b',  // Sidebar bg
    800: '#043927',
  },
  // Semantic
  primary: 'var(--primary)',
  primaryHover: 'var(--primary-hover)',
  surface: 'var(--surface)',
  border: 'var(--border)',
  text: 'var(--text)',
  textMuted: 'var(--text-muted)',
} as const

// In globals.css
:root {
  --primary: #006A4E;
  --primary-hover: #064e3b;
  --surface: #ffffff;
  --border: #ececea;
  --text: #1c1917;
  --text-muted: #57534e;
  /* ... all tokens from handoff styles.css */
}
```

### Pattern 2: Component Variant API

**What:** Components use a `variant`/`tone`/`size` prop pattern, never raw className overrides for core styling.

**When:** Every primitive and composite component.

**Example:**
```typescript
// src/ds/primitives/Button.tsx
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: string
  iconRight?: string
}

export function Button({ variant = 'secondary', size = 'md', icon, iconRight, children, className, ...rest }: ButtonProps) {
  return (
    <button
      className={cn(
        'btn',
        `btn--${variant}`,
        size === 'sm' && 'btn--sm',
        size === 'lg' && 'btn--lg',
        !children && 'btn--icon',
        className
      )}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {children}
      {iconRight && <Icon name={iconRight} />}
    </button>
  )
}
```

### Pattern 3: Server-First Component Design

**What:** Components default to Server Components. Only add `'use client'` when the component needs hooks, event handlers, or browser APIs.

**When:** Deciding the rendering boundary for each component.

**Server Components (no directive needed):**
- PageHeader (static title, breadcrumbs, action buttons as slots)
- Card (structural wrapper)
- Badge (display only)
- Stat (display only)
- Alert (display only)
- Empty (display only)
- Icon (SVG rendering)

**Client Components (need `'use client'`):**
- Sidebar (hover expand, collapse state)
- Topbar (search input, notification interactions)
- AppShell (sidebar state management)
- SectionNav (active tab state, click handlers)
- Tabs (active tab state)
- Modal (open/close state, focus trap)
- All form inputs (onChange handlers)
- DataTable (sort state, pagination)
- FilterBar (search state, filter state)
- Toast (animation, auto-dismiss)

### Pattern 4: Consistent Page Composition

**What:** Every page follows the same compositional pattern from the design handoff.

**When:** Building or migrating any page.

**Example:**
```typescript
// src/app/(authenticated)/events/page.tsx
import { AppShell } from '@/ds/shell'  // provided by layout
import { PageHeader } from '@/ds/composites'
import { SectionNav } from '@/ds/composites'
import { Card, Stat } from '@/ds/primitives'
import { FilterBar, DataTable } from '@/ds/composites'

export default async function EventsPage() {
  const events = await getEvents()

  return (
    <>
      <PageHeader
        crumbs={['Events']}
        title="Events"
        subtitle={`${events.length} total`}
        actions={<Button variant="primary" icon="plus">New Event</Button>}
      />
      <SectionNav
        items={[
          { id: 'upcoming', label: 'Upcoming', count: events.upcoming },
          { id: 'past', label: 'Past' },
          { id: 'calendar', label: 'Calendar', icon: 'calendar' },
        ]}
        active="upcoming"
      />
      <div className="stats-row">
        <Stat label="This Week" value={events.thisWeek} />
        <Stat label="This Month" value={events.thisMonth} />
      </div>
      <FilterBar />
      <DataTable data={events.rows} columns={columns} />
    </>
  )
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Importing from Multiple UI Libraries

**What:** A page imports from both `@/components/ui-v2` and `@/ds/`.

**Why bad:** Creates confusion about which design system is canonical, leads to visual inconsistency, and makes it impossible to know when `ui-v2` can be deleted.

**Instead:** During migration, a page is either fully `ui-v2` (not yet migrated) or fully `ds/` (migrated). The AppShell adapter handles the chrome transition. When migrating a page, replace ALL `ui-v2` imports with `ds/` equivalents in one PR.

### Anti-Pattern 2: Hardcoded Colours in Components

**What:** Using `bg-green-700` or `#006A4E` directly in component code.

**Why bad:** Breaks theming capability, makes the brand colour change a multi-file search-and-replace.

**Instead:** Always reference design tokens: `var(--primary)`, `var(--sidebar-bg)`, `bg-primary-600` (via Tailwind config mapping).

### Anti-Pattern 3: Building the Shell Last

**What:** Migrating individual pages before the AppShell exists.

**Why bad:** Each page would need its own chrome, creating inconsistency and double work. The shell must come first because it defines the content area dimensions that all pages render within.

**Instead:** Build Tokens -> Primitives -> Composites -> Shell -> then migrate pages into the shell.

### Anti-Pattern 4: Big-Bang PageLayout Replacement

**What:** Modifying `PageLayout.tsx` to match the new design system.

**Why bad:** Breaks all 100+ pages that depend on it simultaneously. Any bug affects the entire app.

**Instead:** Build new `PageHeader` in `ds/composites`, use the adapter pattern, migrate page by page. `PageLayout` stays untouched until all pages have migrated away from it.

### Anti-Pattern 5: Creating a ui-v3 Directory

**What:** Putting the new design system in `src/components/ui-v3/`.

**Why bad:** Perpetuates the pattern of versioned component directories. Creates confusion about which version to use. Deep import paths.

**Instead:** Use `src/ds/` as a clean break. It is not a version of `ui-v2`; it is the design system.

## CSS Architecture

### Token Integration with Tailwind

The design handoff uses CSS custom properties extensively. Rather than duplicating tokens in both CSS and Tailwind config, use a single source:

1. Define all tokens as CSS custom properties in `globals.css` (ported from handoff `styles.css`)
2. Map key tokens to Tailwind in `tailwind.config.js` using `var()` references
3. Component-specific styles use CSS classes (`.btn`, `.card`, `.nav-item`) defined in a `ds.css` file
4. Utility overrides use Tailwind classes

```javascript
// tailwind.config.js additions
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: 'var(--brand-50)',
          600: 'var(--brand-600)',
          700: 'var(--brand-700)',
          800: 'var(--brand-800)',
        },
        surface: 'var(--surface)',
        'surface-hover': 'var(--surface-hover)',
        border: 'var(--border)',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        DEFAULT: 'var(--r)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
      },
    },
  },
}
```

### Component CSS Strategy

The design handoff uses BEM-like class names (`.btn`, `.btn--primary`, `.card__header`). Two options:

**Recommended: Tailwind classes with design tokens.**
- Components use Tailwind utilities referencing CSS custom properties
- No separate `.css` files per component
- Consistent with existing codebase pattern
- Example: `className={cn('inline-flex items-center gap-1.5 rounded-[var(--r)] h-[var(--btn-h)] px-3 text-sm font-medium', variantClasses[variant])}`

**Alternative: Port BEM classes from handoff CSS.**
- Create `src/ds/ds.css` with all component classes from `styles.css`
- Components use these class names directly
- Faster initial port but creates a parallel styling system alongside Tailwind

Use Tailwind classes because the entire codebase already uses Tailwind. Adding a parallel BEM system creates confusion about which to use and bloats the CSS bundle.

## Scalability Considerations

| Concern | Current (20 pages) | After Migration (34 pages) | Future (50+ pages) |
|---------|--------------------|-----------------------------|---------------------|
| Token consistency | CSS vars in globals.css | Single ds/tokens source | Same -- tokens scale linearly |
| Component reuse | ui-v2 barrel export | ds/ barrel export | Same pattern |
| Build times | ~30s | +0s (no new dependencies) | Add component lazy loading if needed |
| Bundle size | Heroicons (large) | Custom icons (smaller SVGs) | Tree-shake unused icons |
| Migration surface | N/A | 34 pages to migrate | New pages built directly with ds/ |

## FOH Chromeless Mode

The current codebase already has FOH detection (`isFohOnlyUser` in `AuthenticatedLayout.tsx`). The new AppShell must preserve this:

```typescript
// In AppShell.tsx
const fohOnly = useFohMode()

if (fohOnly) {
  // Render without sidebar or topbar
  return <main className="foh-shell">{children}</main>
}

return (
  <div className="app-shell">
    <Sidebar />
    <div className="app-shell__main">
      <Topbar />
      <main className="app-shell__content">{children}</main>
    </div>
  </div>
)
```

## Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| `src/ds/` as root location | Clean break from versioned `ui/` / `ui-v2/` directories |
| Tokens as CSS custom properties | Matches handoff format; works with Tailwind; themeable later |
| AppShell adapter for migration | Swap chrome once, migrate pages independently |
| Server-first component defaults | Matches Next.js 15 best practices; reduces client JS |
| Custom icon set from handoff | Smaller than Heroicons; visually consistent; stroke-based |
| Tailwind classes (not BEM port) | Consistent with existing 600-file codebase |
| No `ui-v3/` naming | Breaks the versioning cycle; design system is a first-class module |

## Sources

- Design handoff: `ui.jsx` (17 primitives), `nav.jsx` (Sidebar + Topbar + SectionNav), `icons.jsx` (38+ icons), `styles.css` (full token set)
- Current codebase: `AuthenticatedLayout.tsx`, `ui-v2/index.ts` (65+ components), `globals.css`, `tailwind.config.js`
- Next.js 15 App Router patterns (Server Components, Client Components, route groups)
- Confidence: HIGH -- based on direct codebase analysis and design handoff files

---

*Architecture analysis: 2026-05-18*
