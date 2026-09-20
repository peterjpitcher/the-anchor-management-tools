# Navigation refresh, 19 September 2026

Status: local branch `codex/navigation-refresh`. No push, merge, deployment or database migration. Orange Jelly colours are waiting for the owner's design system.

## Delivered behaviour

- Explicit menu toggle, automatic close after ordinary destination selection, and an optional remembered pin-open mode. Focus on a selected link no longer holds the rail open.
- Collapsed icons centred in a 64px rail. Expanded icons and labels remain left-aligned. Desktop links use 24px rows with 1px vertical padding; mobile drawer links use 32px rows.
- Related destinations grouped together, with visible headings and remembered collapsed groups. The active group always opens. Settings remain at the bottom. Users and Roles appear when expanded; the profile remains available through the avatar when collapsed.
- Up to four personal shortcuts, remembered per signed-in user in this browser and reused as mobile tabs. No server preference storage or new data collection.
- Permission-filtered page search using the search buttons or Ctrl/Cmd+K. Exact page matches rank ahead of group matches. Native modified link clicks are retained.
- Cashing Up and Checklists remain highlighted on sibling pages. The mobile Tables label names its destination accurately.

## Browser evidence

The local fixture renders the actual AppShell, Sidebar, SidebarNav, mobile components, dialogs and production stylesheet. Only Next routing, permission and count data, and the unused clock band are replaced. It has no credentials and performs no live operations.

- At 1280 x 720, the collapsed scroll region measured 604px client height and 604px content height: no vertical scrolling. All 27 visible navigation/search icon centres had a 0px offset from the rail centre.
- Clicking Table Bookings navigated to `/table-bookings` and left `data-expanded=false` while the selected link retained focus.
- Tab revealed labels for the next link; Enter opened Private Bookings and closed the transient menu.
- Pin-open mode survived navigation and reload. Selected Rota and Messages shortcuts survived reload and appeared in mobile tabs.
- Escape from the shortcut dialog retained the pinned preference. In unpinned mode it returned focus to the visible Choose shortcuts button.
- Mobile drawer selection dismissed the drawer. Searching from an open drawer dismissed both overlays after selection. An unmatched search showed the no-results message.
- At 820px the mobile navigation was visible and the rail hidden. At 821px the rail was visible and mobile navigation hidden. Neither width had horizontal overflow.
- A daily Cashing Up URL retained `aria-current=page` on Cashing Up.
- No warning or error messages appeared in the browser console during the final checked flows.

These checks validate the navigation shell, not authenticated business pages or a production deployment. The live app required sign-in, so production navigation was not tested.

## Automated verification

- ESLint over `src` with zero warnings: passed.
- Full TypeScript check without incremental caching, using Node 20 and an 8GB heap: passed.
- Full Europe/London suite before the final dialog regressions: 901 files passed, 8,584 tests passed, two skipped.
- Full UTC suite including the dialog regressions: 901 files passed, 8,589 tests passed, two skipped.
- Final focused Europe/London navigation suite, including exact search ranking: five files passed, 47 tests passed.
- Production build ran with placeholder Supabase and cron values and `SUSPEND_ALL_COMMS=true`. This checks the build, not live integrations. Final production build passed with exit code 0 and 155 static pages generated.

## Changed files

Production:

- `src/app/(authenticated)/AuthenticatedLayout.tsx`: passes the existing user ID to scope preferences.
- `src/app/globals.css`: compact rail geometry, explicit open-state selectors and group visibility. Colour tokens unchanged.
- `src/ds/shell/AppShell.tsx`: integrates preferences, search and shortcuts.
- `src/ds/shell/Sidebar.tsx`: open/close, pinning, compact header and account area.
- `src/ds/shell/SidebarNav.tsx`: grouping, section matching, group controls and accessible compact links.
- `src/ds/shell/MobileChrome.tsx`: shared matching, compact drawer and chosen mobile shortcuts.
- `src/ds/shell/UserFooter.tsx`: compact footer and profile link.
- `src/ds/shell/NavigationSearch.tsx`: page search dialog.
- `src/ds/shell/ShortcutPicker.tsx`: personal shortcut chooser.
- `src/ds/shell/useNavigationPreferences.ts`: robust browser-local preferences.

Verification and records:

- `src/ds/shell/__tests__/SidebarNav.test.tsx`
- `src/ds/shell/__tests__/NavigationSearch.test.tsx`
- `src/ds/shell/__tests__/NavigationPreferences.test.tsx`
- `tests/components/Sidebar.test.tsx`
- `tests/browser/navigation/index.html`
- `tests/browser/navigation/main.tsx`
- `tests/browser/navigation/stubs.tsx`
- `tests/browser/navigation/vite.config.ts`
- `tasks/todo.md`
- `tasks/lessons.md`
- This review note.

## Deliberately unchanged

- `src/ds/composites/SectionNav.tsx`, `PageHeader.tsx` and `PageLayout.tsx`: no changes to individual page tabs, breadcrumbs or list return state.
- `src/app/layout.tsx`, existing colour tokens and brand assets: Orange Jelly styling awaits the supplied design system.
- `src/actions/get-outstanding-counts.ts` and the count hooks: badge queries and business meanings unchanged.
- Server permissions, business pages, actions, APIs, database files and the paired website: no changes needed for this shell update.
- Existing unrelated work in the original checkout: preserved by using a separate worktree.

## Repeat local browser verification

Run Node 20 and then `node node_modules/vite/bin/vite.js --config tests/browser/navigation/vite.config.ts` from this worktree. The fixture listens on the loopback interface on port 4317. Open its printed URL in a browser and exercise the menu. Its labels clearly identify it as a local fixture.

## Remaining work

Apply the owner's Orange Jelly design system when supplied, then repeat visual checks with those tokens before release. Record search, page-specific return-state work and filtered badge destinations were recommendations for wider application work and are not included in this navigation shell change.
