# AMS UI Redesign

## What This Is

A comprehensive UI redesign and feature expansion of The Anchor Management Tools (AMS), implementing pixel-perfect designs from a Claude Design handoff bundle. The redesign covers a new design system, collapsible sidebar navigation, topbar, 20+ redesigned existing screens, 6+ new full-stack sections (Events, Performers, Cashing Up, OJ Projects, Short Links, Design System), and an FOH-only chromeless mode. The target is a production Next.js 15 App Router + React 19 + Tailwind CSS v4 + Supabase application.

## Core Value

Every staff member at The Anchor sees a consistent, modern, professional management interface that matches the design handoff pixel-perfectly — with a collapsible sidebar, unified component library, and seamless navigation across all 34 screens.

## Requirements

### Validated

- ✓ Authentication via Supabase Auth with JWT + HTTP-only cookies — existing
- ✓ RBAC permission system (super_admin, manager, staff) — existing
- ✓ Server actions pattern for all mutations — existing
- ✓ Supabase database with RLS enabled — existing
- ✓ Dashboard with KPI stats — existing
- ✓ Customer CRM — existing
- ✓ Employee directory — existing
- ✓ Private bookings management — existing
- ✓ Parking management — existing
- ✓ Menu management — existing
- ✓ Mileage tracking (HMRC rates) — existing
- ✓ Expenses management — existing
- ✓ MGD quarterly returns — existing
- ✓ Invoice management — existing
- ✓ Quote management — existing
- ✓ Receipt capture — existing
- ✓ SMS messaging via Twilio — existing
- ✓ Table bookings — existing
- ✓ Rota scheduling — existing
- ✓ Timeclock kiosk — existing
- ✓ Staff portal — existing
- ✓ Employee onboarding wizard — existing
- ✓ User management and roles — existing
- ✓ Public booking and parking forms — existing
- ✓ Email via Microsoft Graph — existing

### Active

- [ ] New design system (tokens, shared components, icons) — light mode, compact density
- [ ] Collapsible sidebar navigation (64px collapsed, 232px expanded on hover)
- [ ] Sticky topbar with search, theme toggle placeholder, notifications, "New" button
- [ ] SectionNav horizontal pill strip for sub-page navigation
- [ ] Redesign all existing screens to match handoff designs
- [ ] Events management — full stack (calendar, list, board views, CRUD, categories)
- [ ] Performers directory — full stack (acts, genres, fees, ratings, booking)
- [ ] Cashing Up — full stack (daily till reconciliation, weekly summary, insights)
- [ ] OJ Projects — full stack (time tracking, clients, work types, billing)
- [ ] Short Links — full stack (URL shortener with click analytics)
- [ ] Design System page — internal style guide with live component previews
- [ ] FOH-only chromeless mode for front-of-house managers
- [ ] Consistent page pattern: PageHeader → SectionNav → Stats → Toolbar → Content
- [ ] Settings hub with General, Users, Roles, My Profile sub-pages

### Out of Scope

- Dark mode — light mode only for v1, defer theming to later
- Density system (comfortable/spacious) — ship compact only
- Brand colour switching — fixed to Bottle Green (#006A4E)
- TweaksPanel prototype tooling — not for production
- Database schema redesign — only new tables for new features
- Mobile app — web only
- Real-time features (WebSocket/SSE) — standard request/response

## Context

- Design handoff bundle at: `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/`
- Primary design file: `AMS Redesign.html` with 6 supporting JSX files and 24 screen JSX files
- Design specifies Inter font (400-800) + JetBrains Mono (400-600)
- Brand colour: Bottle Green `#006A4E`, sidebar bg: `#064e3b`
- The app is currently in production on Vercel, used daily by staff
- Current UI uses a `PageWrapper`/`Page` pattern being migrated to `PageLayout` + `HeaderNav` from `src/components/ui-v2/`
- This redesign supersedes the ongoing ui-v2 migration — the new design system replaces both old and ui-v2 patterns
- Codebase map available at `.planning/codebase/` (7 documents, 1,418 lines)

## Constraints

- **Max phases**: 4 — user requirement
- **Tech stack**: Next.js 15 App Router, React 19, Tailwind CSS v4, Supabase — no changes
- **Backwards compatible**: App is in production; each phase must be independently deployable without breaking existing functionality
- **No auth changes**: Existing Supabase Auth + RBAC system stays as-is
- **Existing patterns**: Server actions, `fromDb<T>()` conversion, audit logging — all preserved
- **Node version**: 20 LTS as pinned in `.nvmrc`

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Shell-first approach | Build design system + nav shell first, then migrate screens into it | — Pending |
| Light mode + compact only | Reduce scope; dark mode and density are polish, not core | — Pending |
| Full-stack new sections | Events, Performers, Cashing Up, OJ Projects, Short Links need backend + frontend | — Pending |
| FOH chromeless mode in v1 | FOH managers need a simplified view for daily operations | — Pending |
| 4 phases max | Keep roadmap focused and deliverable | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-18 after initialization*
