# Phase 3: New Sections - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-18
**Phase:** 03-new-sections
**Areas discussed:** Performers schema, Events multi-view, Design System page, Cashing Up, OJ Projects, Short Links

---

## Performers Schema

### Performer-Event relationship
| Option | Description | Selected |
|--------|-------------|----------|
| One performer per event | Simple FK on events table — each event has one performer | ✓ |
| Many performers per event | Junction table (event_performers) — supports multi-act nights | |
| You decide | Claude picks based on what makes sense | |

**User's choice:** One performer per event

### Rating system
| Option | Description | Selected |
|--------|-------------|----------|
| Simple star rating | 1-5 stars per gig, averaged on performer profile | ✓ |
| Star + written review | 1-5 stars plus optional text notes | |
| Multi-criteria rating | Rate on multiple dimensions | |

**User's choice:** Simple star rating

### Genre tags
| Option | Description | Selected |
|--------|-------------|----------|
| Predefined list | Fixed set of genres — consistent filtering, no duplicates | ✓ |
| Free-form tags | Staff type whatever tags they want | |
| Predefined + custom | Standard list but allow adding new genres via settings | |

**User's choice:** Predefined list

### Contact log
| Option | Description | Selected |
|--------|-------------|----------|
| Booking comms only | Log when you contacted a performer about a specific gig | |
| Full interaction log | Any interaction — availability checks, negotiations, etc. | |
| Skip contact log | Don't build it now — defer to backlog | |

**User's choice:** "Can we just remove the performer function completely? I don't need it anymore"

### Remove from navigation
| Option | Description | Selected |
|--------|-------------|----------|
| Remove from nav | Take it out of the sidebar completely | ✓ |
| Keep existing page | Leave the current performers page accessible | |

**User's choice:** "Remove the nav, page, everything"
**Notes:** Performers section removed entirely from the project. PERF-01 through PERF-04 dropped. This eliminates the only full-stack section with schema risk from Phase 3.

---

## Events Multi-View

### View navigation pattern
| Option | Description | Selected |
|--------|-------------|----------|
| Segmented control | Single page with Segmented control at top | |
| SectionNav tabs | Horizontal pill navigation — each view is a sub-page | |
| You decide | Claude picks based on ds/ components and design handoff | ✓ |

**User's choice:** You decide (Claude's Discretion)

### Board/kanban columns
| Option | Description | Selected |
|--------|-------------|----------|
| Lifecycle stages | Idea → Planned → Confirmed → Promoted → Completed → Cancelled | ✓ |
| Simple statuses | Upcoming → Live → Past → Cancelled | |
| Match existing data | Use whatever status field already exists | |

**User's choice:** Lifecycle stages

### Board drag-and-drop
| Option | Description | Selected |
|--------|-------------|----------|
| Yes, drag to change status | Drag card between columns updates status | |
| No, click to update | Board is read-only — click to open, change status in detail view | ✓ |

**User's choice:** No, click to update

### Calendar cell content
| Option | Description | Selected |
|--------|-------------|----------|
| Compact dot/pill | Small coloured pill with event name only | |
| Mini event card | Shows name + time + category badge in each cell | ✓ |
| You decide | Claude picks based on design handoff | |

**User's choice:** Mini event card

### CRUD flow pattern
| Option | Description | Selected |
|--------|-------------|----------|
| Keep nested routes | Preserve /events/new, /events/[id], /events/[id]/edit as separate pages | |
| Modal/drawer flow | Create/edit opens in a side drawer or modal over the list | ✓ |
| You decide | Claude picks based on design handoff and existing patterns | |

**User's choice:** Modal/drawer flow

### Checklist/todo placement
| Option | Description | Selected |
|--------|-------------|----------|
| Inside event detail | Checklist appears as a tab/section within the event drawer | |
| Separate todo page | Keep /events/todo as standalone view showing all incomplete tasks | |
| Both | Per-event checklist inside drawer AND cross-event todo overview page | ✓ |

**User's choice:** Both

### List view filters
| Option | Description | Selected |
|--------|-------------|----------|
| Category + date range | Filter by event category and date range | |
| Category + date + status | Add status filter alongside category and date | |
| Full filter panel | Category, date range, status, plus search by name | ✓ |

**User's choice:** Full filter panel

### AI content and images
| Option | Description | Selected |
|--------|-------------|----------|
| Yes, include both | Wire up AI content generation and image upload in event drawer | ✓ |
| Images only | Include image upload but skip AI content generation | |
| Skip both for now | Focus on core CRUD and views | |

**User's choice:** Yes, include both

---

## Design System Page

### Interactivity level
| Option | Description | Selected |
|--------|-------------|----------|
| Static showcase | Rendered examples of each component in all variants | |
| Interactive playground | Props controls to see components change live | |
| You decide | Claude picks based on effort vs value | ✓ |

**User's choice:** You decide (Claude's Discretion)

### Sections included
| Option | Description | Selected |
|--------|-------------|----------|
| Components only | Just the component library with examples | |
| Full design system | Colour palette, typography, spacing, icons, AND all components | ✓ |
| Components + tokens | Components plus colours and typography only | |

**User's choice:** Full design system

### Page navigation
| Option | Description | Selected |
|--------|-------------|----------|
| SectionNav tabs | Horizontal pill navigation across sections | |
| Single scrollable page | Everything on one long page with anchor links | ✓ |
| You decide | Claude picks based on content volume | |

**User's choice:** Single scrollable page. Don't link from main navigation — add to /settings page instead.

---

## Cashing Up

### Sub-page scope
| Option | Description | Selected |
|--------|-------------|----------|
| All 5 sub-pages | Redesign Dashboard, Daily, Weekly, Insights, Import | ✓ |
| Core 3 only | Dashboard + Daily + Weekly — defer Insights and Import | |
| You decide | Claude determines priority | |

**User's choice:** All 5 sub-pages

### Daily form approach
| Option | Description | Selected |
|--------|-------------|----------|
| Reskin only | Same form structure — swap to ds/ components | |
| Redesign per handoff | Follow cashing-up.jsx design handoff exactly | ✓ |
| You decide | Claude matches handoff where specified, reskins where not | |

**User's choice:** Redesign per handoff

---

## OJ Projects

### Backend status
| Option | Description | Selected |
|--------|-------------|----------|
| Backend exists | Server actions exist somewhere | |
| Needs backend too | Needs server actions built alongside UI | |
| Not sure | Need to check | ✓ |

**User's choice:** Not sure
**Notes:** Investigation revealed comprehensive backend at `src/app/actions/oj-projects/` with entries, projects, work-types, clients, recurring charges, vendor settings, client statements/balances. Backend confirmed — UI-only rebuild.

### Sub-section scope
| Option | Description | Selected |
|--------|-------------|----------|
| Full redesign all | Redesign every sub-section per design handoff | ✓ |
| Core sections only | Projects + Entries + Overview — defer admin config pages | |
| You decide | Claude determines priority | |

**User's choice:** Full redesign all

---

## Short Links

### Approach
| Option | Description | Selected |
|--------|-------------|----------|
| Reskin with ds/ | Same structure — swap imports | |
| Redesign per handoff | Follow short-links.jsx design exactly | ✓ |
| You decide | Claude matches handoff, reskins otherwise | |

**User's choice:** Redesign per handoff

---

## Claude's Discretion

- Events view-switching pattern (Segmented control vs SectionNav)
- Design System page interactivity level (static vs interactive)
- Section build ordering and plan grouping
- Responsive breakpoints, loading/error/empty states per section

## Deferred Ideas

- Performers section — removed entirely (user decision)
- Event board drag-and-drop — could add in future
- Dark mode for Design System page — v2 scope
