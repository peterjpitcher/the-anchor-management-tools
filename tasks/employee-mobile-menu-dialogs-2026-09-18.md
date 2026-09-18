# Employee page mobile "More" menu opens no dialog, 18 September 2026

At phone width the employee detail page tucks Begin Separation, Mark as Former and Delete
Employee into a "More" menu. Choosing any of them opened nothing. The menu closes on the same
click, and because it was rendered with `{open && ...}` its children unmounted, taking the
dialog (owned by the action component) with them. The bug predates the design-token work and
survived it: main at `0b996f72`, with the dialogs already rebuilt as DS Modals, still failed.

Complexity 2 (S): one source file and one test, no schema, no integrations.

## Plan

- [x] Write a failing test first: open each action from the mobile menu and expect its dialog.
- [x] Reproduce in a browser at 375px with a throwaway probe page rendering the real components.
- [x] `EmployeeHeaderActions`: keep the menu's items mounted when it closes (hidden attribute,
      not unmounted). The dialogs are DS Modals, which render on the body, so the hidden menu
      does not hide them. Server actions, permission checks and confirmation steps unchanged.
- [x] Sweep the app for other menus whose items own their own dialogs.
- [x] Gates: lint, tsc, `npm test`, `npm run test:utc`, cold production build.
- [x] Browser check at 375px (all three dialogs) and at desktop width (no regression).
- [x] Remove the probe page and the dummy `.env.local`; commit on the branch.

## Results

- First built on `6e6a8be0`, when the dialogs were hand-built inline overlays and also needed
  `createPortal`. The design-token commit `8caeacd3` landed on main mid-task and rebuilt all three
  as DS Modals, so the branch was moved onto `0b996f72` and the fix re-applied: only the menu
  change is needed now.
- Test `tests/components/EmployeeHeaderActionsMobileMenu.test.tsx` fails on `0b996f72` for all
  three actions ("Unable to find role=dialog") and passes with the fix. On the old base it also
  failed on a half fix that kept the menu mounted but left an inline dialog inside it.
- Browser, 375x812, probe page with the real shell, PageLayout and action components: before the
  fix, choosing an action left zero dialogs in the page. After it, all three open as bottom
  sheets in the Headless UI portal, above the top bar, with the menu closed; Cancel and Escape
  close them. Desktop 1280x800: all three still open. Console: only the probe's signed-out nav
  count 401s.
- Sweep: every DS Dropdown user (RowActions, employees export, events list, messages, quotes,
  recruitment), the rota feed popover, the private-bookings filter drawer and the FOH avatar menu
  keep dialog state in the parent or hold no dialog. Only this menu had the fault.
- Gates on Node 20.19.5 at `0b996f72` plus the fix: lint 0 warnings; clean `tsc --noEmit` 0 (the
  new test file checked separately, since tsconfig excludes `tests/`); `npm test` and
  `npm run test:utc` each 999 files, 9,793 passed, 2 skipped; cold `next build` exit 0,
  150/150 static pages.
- Found, not fixed (separate task): the open menu sits 17px past the left edge at 375px. It did
  before this change too.
