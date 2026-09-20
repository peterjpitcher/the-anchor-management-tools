# Navigation corrections, 20 September 2026

Owner-requested changes: hover expansion and mouse-out dismissal; no navigation search; original production groups and item order; orange as the dominant application colour; more room between icons.

## Changes

- src/ds/shell/Sidebar.tsx: open on pointer entry, retain selection dismissal and keyboard support, remove search, use the restored Admin footer group and keep the logo beside the venue name.
- src/ds/shell/AppShell.tsx: remove the search dialog and pin-open controls so saved pin state cannot prevent mouse-out dismissal.
- src/ds/shell/MobileChrome.tsx: remove the search button.
- src/ds/shell/SidebarNav.tsx: NAV_GROUPS copied exactly from fetched origin/main, 35fd2fee. Overview, Operations, Staff, Finance and Admin retain their original links and permission gates.
- src/app/globals.css: supplied orange sidebar with dark text and peach highlights; rows increased from 24px to 30px. Primary actions retain the supplied deep orange with white labels.
- src/ds/shell/NavigationSearch.tsx and its co-located test removed with the unwanted feature.
- tests/components/Sidebar.test.tsx: hover entry/exit regression, including focus retained on a link and search absent.
- src/ds/shell/__tests__/SidebarNav.test.tsx: expect restored group labels.

## Deliberately unchanged

Business routes, authorisation, data, guest branding, fonts, main page layouts, user footer and shortcuts. No migration, push or deployment.

## Verification

The actual signed-in Firefox dashboard on port 3000 shows an orange rail with spaced, centred icons. Entering an empty area of the rail opens it; leaving for the main page hides it. The expanded view shows the restored groups, no search and no pin control. Logo and venue name share one row. Served CSS confirms the orange sidebar token and 30px rows.

Focused tests: 101 passed in London. Lint and uncached typecheck passed. Build runs from an isolated source copy so it cannot replace the development server output. The isolated production build exited 0. Full London suite: 1,009 files passed, 9,852 tests passed and two existing skips. Focused UTC suite: 101 passed. The build retains the existing spacing-* CSS warning from a documentation example.

## White foreground on orange

Owner correction: src/app/globals.css now makes both normal and secondary navigation foregrounds white, including headings and footer controls. Orange hover rows keep white foregrounds. SidebarNav.tsx and MobileChrome.tsx retain dark text and icons on pale selected rows; pale count badges also retain dark text. Other files and behaviour are unchanged. Verified the actual Firefox rota navigation after restarting the dev server: white text and icons on orange, dark Rota text on its pale active row. Targeted lint and all 42 shell/guard tests passed. Local main only.

## Admin collapsed by default

Updated useNavigationPreferences.ts to default Admin closed and apply that default to older saved preferences without losing shortcuts or other groups. A version marker preserves explicit choices after the update. NavigationPreferences.test.tsx covers the default, legacy preferences and remembering a later expansion. Verified the actual Firefox booking page shows Expand Admin with the group links hidden. Targeted lint and 41 shell tests passed. No other application files changed.

## Full-width logo and pin control

Sidebar.tsx now gives the supplied white logo the full expanded width, with 8px side padding and its natural aspect ratio. A simple pin below the logo replaces the expanded collapse control. The collapsed rail uses the white logo mark. AppShell.tsx reconnects the saved pin preference so pinning keeps the menu open on mouse-out and navigation, and unpinning returns to hover behaviour. Tests in tests/components/Sidebar.test.tsx cover pin, mouse-out and unpin.

Verified on the actual Firefox booking page: full-width wordmark, Pin menu open changed to Unpin menu, the menu remained open after moving to the page, and unpinning restored Expand menu. Test pin preference restored to unpinned after verification. Targeted lint and the shell/guard suite passed. No other application files, mobile navigation, logos, colours, business logic or data changed. Local main only.

## Remove shortcuts option
Removed the chooser and duplicated shortcut links from desktop and mobile navigation. Mobile tabs use the standard permitted destinations again. Old saved shortcut IDs are ignored; pin and collapsed-group preferences remain intact.

Changed: AppShell.tsx, Sidebar.tsx, MobileChrome.tsx, useNavigationPreferences.ts, globals.css, NavigationPreferences.test.tsx and Sidebar.test.tsx. Deleted ShortcutPicker.tsx. Deliberately unchanged: SidebarNav.tsx (menu ordering and permissions), logo assets, palette tokens and business pages. The pre-existing local logo-padding adjustment in Sidebar.tsx is preserved outside this commit.

Validation: 40 shell, sidebar and design-token tests passed in London and UTC; shell lint and clean TypeScript check passed. In Firefox on port 3000, the expanded orange menu shows Overview immediately beneath the logo and pin. Neither Choose shortcuts nor Your shortcuts appears.
Isolated production build passed using placeholder environment settings and an 8 GB Node heap. No production credentials or deployment were needed.

## Remove pin behaviour
Removed the pin button, persistent pin preference and expanded-width reservation. Old saved pin values are ignored. Hover, keyboard expansion, mouse-out and link-selection dismissal remain.

Changed: Sidebar.tsx, AppShell.tsx, useNavigationPreferences.ts, globals.css, NavigationPreferences.test.tsx and Sidebar.test.tsx. Deliberately unchanged: menu ordering, branding assets, mobile navigation and page spacing. Existing uncommitted logo padding remains outside this commit.

Firefox on port 3000: expanded menu has no pin control; leaving the menu shows the collapsed rail and Expand menu control again.

Spacing inspection: the private-bookings list uses AppShell's standard 28px desktop horizontal inset, with a 20px main content gap. Shared cards default to 14px padding. The individual booking detail page has its own compact override from the previous change. This is not an application-wide spacing standardisation.
Validation: 38 navigation and design-token tests passed in London and UTC; shell lint, clean TypeScript check and isolated production build passed. Build used placeholder settings.
