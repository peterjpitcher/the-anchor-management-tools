---
phase: 01-design-system-app-shell
plan: 01
subsystem: ui
tags: [tailwind-v4, design-tokens, css-custom-properties, next-font, inter, jetbrains-mono]

requires: []
provides:
  - "Tailwind v4 native build pipeline via @tailwindcss/postcss"
  - "@theme block with 50+ design tokens generating Tailwind utility classes"
  - "Inter and JetBrains Mono fonts configured via next/font/google"
  - "JS token re-exports in src/ds/tokens/index.ts"
  - "src/ds/ directory structure with barrel files for primitives, composites, icons"
affects: [01-02, 01-03, 01-04, all-phase-2, all-phase-3, all-phase-4]

tech-stack:
  added: ["tailwindcss@4.3.0", "@tailwindcss/postcss@4.3.0"]
  removed: ["tailwindcss@3.4.0", "tailwindcss-animate@1.0.7", "autoprefixer"]
  patterns: ["@theme for design tokens", "@utility for custom CSS utilities", "next/font for font loading"]

key-files:
  created:
    - src/ds/tokens/index.ts
    - src/ds/index.ts
    - src/ds/primitives/index.ts
    - src/ds/composites/index.ts
    - src/ds/icons/index.ts
  modified:
    - src/app/globals.css
    - src/app/layout.tsx
    - postcss.config.mjs
    - package.json
  deleted:
    - tailwind.config.js

key-decisions:
  - "Preserved legacy HSL CSS vars (:root block) for backward compatibility with existing hsl(var(--primary)) patterns"
  - "Converted @layer utilities @apply rules to @utility directives for Tailwind v4 compatibility"
  - "Converted @layer components @apply rules to plain CSS to avoid v4 @apply restrictions with responsive prefixes"
  - "Manual migration after codemod partial failure -- codemod migrated packages but failed on template migration"

patterns-established:
  - "@theme block in globals.css is single source of truth for all design tokens"
  - "@utility directive replaces @layer utilities with @apply for custom utilities"
  - "Component CSS classes use plain CSS instead of @apply with responsive prefixes"
  - "next/font CSS variables (--font-inter, --font-jetbrains) applied on html element"

requirements-completed: [DS-01, DS-02, DS-03]

duration: 8min
completed: 2026-05-18
---

# Phase 01 Plan 01: Tailwind v4 Migration & Design Token Foundation Summary

**Tailwind v4 native build with @theme-based design token system (50+ tokens), Inter + JetBrains Mono fonts via next/font, and scaffolded src/ds/ directory structure**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-18T16:01:48Z
- **Completed:** 2026-05-18T16:10:30Z
- **Tasks:** 2
- **Files modified:** 10 (5 created, 4 modified, 1 deleted)

## Accomplishments
- Migrated Tailwind from v3.4 to v4.3 with native @tailwindcss/postcss build pipeline
- Established complete design token system via @theme block: brand palette (10 shades), semantic colors (11), primary (5), sidebar (6), status colors (12), typography (2 font stacks), density spacing (6), layout spacing (4), radii (6), shadows (5), easing (1)
- Configured Inter (weights 400-800) and JetBrains Mono (weights 400-600) via next/font/google with zero layout shift
- Created src/ds/ directory structure with tokens, primitives, composites, and icons sub-modules

## Task Commits

Each task was committed atomically:

1. **Task 1: Tailwind v3 to v4 migration** - `b80b719e` (chore)
2. **Task 2: @theme tokens, fonts, ds/ structure** - `8f9e5faa` (feat)

## Files Created/Modified
- `src/app/globals.css` - @import "tailwindcss", @theme token block, @utility directives, legacy :root compat vars
- `postcss.config.mjs` - Updated to @tailwindcss/postcss plugin, removed autoprefixer
- `package.json` - tailwindcss v4.3, removed tailwindcss-animate and autoprefixer
- `src/app/layout.tsx` - Inter and JetBrains Mono font declarations via next/font/google
- `src/ds/tokens/index.ts` - getToken() function, colors/spacing/shadows/radii/easing exports
- `src/ds/index.ts` - Top-level barrel re-exporting tokens
- `src/ds/primitives/index.ts` - Empty barrel (populated by Plan 01-02)
- `src/ds/composites/index.ts` - Empty barrel (populated by Plan 01-03)
- `src/ds/icons/index.ts` - Empty barrel (populated by Plan 01-03)
- `tailwind.config.js` - Deleted (v3 config replaced by @theme in CSS)

## Decisions Made
- Preserved legacy HSL CSS vars (:root block) so existing components using `hsl(var(--primary))` continue to work during the migration period. Updated --primary HSL to match new #006A4E brand color.
- Manual migration after codemod partial failure -- the @tailwindcss/upgrade codemod upgraded packages and attempted stylesheet migration but failed on template migration due to @apply with responsive prefixes in globals.css. Completed the remaining steps manually.
- Converted @apply-based utility and component classes to either @utility directives (simple utilities) or plain CSS (responsive component classes) since Tailwind v4 does not support @apply with responsive prefixes inside @layer blocks.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Codemod partial failure required manual migration**
- **Found during:** Task 1 (Tailwind v4 codemod)
- **Issue:** `npx @tailwindcss/upgrade` failed mid-execution because globals.css used `@apply sm:px-6` inside `@layer utilities` which is unsupported in v4
- **Fix:** Completed migration manually: updated postcss.config.mjs, converted globals.css @tailwind directives to @import, converted @apply utilities to @utility directives, converted @apply components to plain CSS
- **Files modified:** postcss.config.mjs, src/app/globals.css
- **Verification:** `npm run build` and `npm run lint` both pass
- **Committed in:** b80b719e (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Manual migration achieved the same result as the codemod. No scope creep.

## Issues Encountered
None beyond the codemod failure documented above.

## Known Stubs
None -- all files are either fully implemented (globals.css, layout.tsx, tokens/index.ts) or intentionally empty barrels that will be populated by subsequent plans (primitives/, composites/, icons/).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Tailwind v4 build pipeline is active and verified
- All design tokens are available as utility classes (bg-primary, text-text-muted, shadow-sm, rounded-default, etc.)
- Fonts configured and ready for use via font-sans and font-mono classes
- src/ds/ directory structure ready for Plan 01-02 (primitive components) and Plan 01-03 (composites + icons)
- Legacy CSS vars preserved for backward compatibility during the transition

---
*Phase: 01-design-system-app-shell*
*Completed: 2026-05-18*
