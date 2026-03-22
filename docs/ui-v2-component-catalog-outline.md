# UI-v2 Component Catalog — Outline

_Last updated: 2025-10-18_

This outline captures the sections we plan to document in the upcoming ui-v2 component catalog / Storybook. Each section will land in MDX with live examples and code snippets pulled from production usage.

## 1. Layout Shells

- **Page / PageHeader** — gradient backgrounds, breadcrumb patterns, loading states.
- **PageWrapper + PageContent** — authenticated shell usage, spacing guidelines, nested grid examples.
- **DomainCard Pattern** — hero/metrics cards for dashboards and public flows (props, tone variants, badge usage).
- **Hero Metrics Row** — reusable KPI tiles (dashboard, payments, bookings).

## 2. Navigation & Actions

- **Navigation sidebar** — grouped nav items, glass buttons, unread badge handling.
- **NavGroup / NavLink** — inline action bars for headers.
- **QuickActionsCard** — compact action rail in dashboards/public flows (icon support, disabled states).

## 3. Display & Data

- **MetricGrid** — KPI pairs with warning tone support.
- **SignalsCard** — status callouts (tone mapping, text length guidance).
- **SimpleList** — link lists with metadata + badges.
- **DataTable** — column configuration patterns (bookings, quotes, invoices).

## 4. Forms & Inputs

- **Button** — primary/secondary gradients, loading behaviour, icon placement.
- **Input / Select / Textarea** — glass field styling, inline validation.
- **FormGroup / Form** — label alignment, spacing, server-action patterns.

## 5. Feedback & Overlays

- **Alert** — tonal usage for success/warning/error across dashboards and guest flows.
- **Badge** — semantics, size, usage in DomainCards, tables, nav.
- **Modal / ConfirmDialog** — updated emerald styling (private-bookings modals roadmap).
- **Spinner & Skeleton** — loading placements for hero cards and detail pages.

## 6. Public-Facing Patterns

- **Guest payment hero** — table booking deposit flow hero + metrics.
- **Order summary card** — flexible list for booking items (quantity, notes, price).
- **Support sidebar** — call-to-action blocks (phone/time, location map pin).

## 7. Tokens & Utilities

- **Color & gradient tokens** (`emeraldChrome`, `emeraldHero`, etc.).
- **Shadow tokens** — `emeraldGlow` usage and elevation guidelines.
- **Radius & spacing** — `rounded-[32px]`, `space-y-*` conventions.

## Next Steps

1. Capture MDX examples for each section (code + preview) using the latest command-centre implementations.
2. Publish Storybook stories for `DomainCard`, `HeroMetricsRow`, and `QuickActionsCard` so teams can test variations.
3. Link this catalog from the UI-v2 playbook once the first batch of MDX pages ships.
