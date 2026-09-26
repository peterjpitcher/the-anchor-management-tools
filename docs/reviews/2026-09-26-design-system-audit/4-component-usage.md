# Audit 4: design-system component adoption

Read-only audit of `src/app` and `src/components` (763 non-test files, `src/app/api` and `src/ds` excluded) in OJ-AnchorManagementTools, 26 September 2026. Counts come from a scripted scan (`a scratch script`, raw data not kept); nothing in the repo was edited.

## Headline

Adoption is already high. 414 of the 763 in-scope files import `@/ds`, and DS tags dominate: Button 1,188, Input 836, Card 512, Badge 444, Table parts about 1,000, Modal 114, ConfirmDialog 80. The debt is concentrated, not spread:

| Class | Count | Where it bites |
|---|---|---|
| compat components still rendered | 577 JSX uses in 90 files | `FormGroup` alone is 445 uses in 49 files; it is a pure alias of `Field` |
| Icon libraries outside the DS | 95 files on Heroicons (352 imports), 40 files on Lucide (121 imports) | DS `Icon` is used in only 35 files; about 62% of the third-party icons already have a DS equivalent |
| Raw `<label>` not in Field style | 243 of 251 raw labels (147 are the old `text-sm font-medium` style) | invoices, private bookings, events category form, recruitment |
| Raw `<table>` | 38 in 29 files (plus 1 email template) | invoices detail, receipts, menu GP analysis, mileage, rota hours and payroll |
| Raw `<button>` | 165 in 81 files (158 on staff screens) | private booking detail (13), recruitment (9), rota grid (7), BOH bookings (7) |
| Native `confirm()` | 23 calls in 20 files | invoices, expenses, settings; the DS `ConfirmDialog` is already used 80 times elsewhere |
| Ad hoc status colour maps | 47 declarations in 36 files | leave status map copied 4 times; OJ Projects 4 times; parking and refunds twice |
| Direct `react-hot-toast` imports | 68 files, against 106 on the DS `toast` helper | two toast APIs; one `Toaster` only (compliant) |
| Duplicate DS roles built locally | 24 components (Stat x5, menus x3, modals and Headless UI x4, sort headers x3, refund table and dialog each copied twice) | see section 3 |
| Unused DS pieces | `FormSubmitButton` 0 uses; compat `Container` and `FormActions` 0 uses; `BackButton` imported in 2 files but never rendered | delete or adopt |

Not found: `<dialog>` elements (0), `alert()` calls (0; the one regex hit in `src/app/actions/payroll.ts` is an email subject), `react-icons` (0), `sonner` (0), a second `Toaster` (0), a parallel generic component folder such as `src/components/ui` (none exists).

## Adoption by section

Sections with at least five raw controls or compat uses. "DS control tags" counts JSX uses of Button, IconButton, LinkButton, Input, Select, Textarea, Checkbox, Radio, Switch, Table, DataTable, Modal, Drawer, ConfirmDialog, Spinner, Badge, SearchInput, FileUpload, DateTimePicker and Dropdown from `@/ds`. "Raw controls" counts raw button, non-hidden input, select, textarea, table, overlay, spinner, hand pill and native confirm. Guest sections (`app/g`, feedback, guest-preview) are meant to use the `Guest*` kit, not the DS, so their 0% is expected.

| Section | Files | DS control tags | Raw controls | DS share | Compat tags | Files w/ Heroicons | Files w/ Lucide |
|---|---|---|---|---|---|---|---|
| private-bookings | 26 | 269 | 31 | 90% | 133 | 10 | 0 |
| menu-management | 25 | 183 | 12 | 94% | 83 | 7 | 0 |
| settings | 49 | 389 | 21 | 95% | 59 | 13 | 0 |
| rota | 27 | 162 | 46 | 78% | 28 | 10 | 1 |
| invoices | 16 | 208 | 10 | 95% | 63 | 0 | 12 |
| employees | 13 | 92 | 3 | 97% | 48 | 3 | 1 |
| components/private-bookings | 9 | 111 | 7 | 94% | 37 | 5 | 0 |
| table-bookings | 27 | 154 | 34 | 82% | 5 | 0 | 1 |
| receipts | 27 | 191 | 27 | 88% | 5 | 7 | 0 |
| recruitment | 2 | 152 | 26 | 85% | 0 | 1 | 0 |
| quotes | 6 | 60 | 0 | 100% | 25 | 0 | 4 |
| customers | 5 | 53 | 0 | 100% | 17 | 2 | 0 |
| events | 29 | 173 | 12 | 94% | 5 | 2 | 0 |
| vouchers | 23 | 143 | 17 | 89% | 0 | 0 | 0 |
| expenses | 6 | 26 | 5 | 84% | 11 | 0 | 1 |
| components/features/catering | 2 | 26 | 1 | 96% | 15 | 2 | 0 |
| app/g | 27 | 0 | 15 | 0% | 0 | 0 | 5 |
| components/schedule-calendar | 16 | 14 | 9 | 61% | 5 | 2 | 0 |
| components/features/employees | 21 | 97 | 8 | 92% | 5 | 8 | 2 |
| short-links | 12 | 38 | 11 | 78% | 0 | 0 | 1 |
| components/features/customers | 8 | 23 | 11 | 68% | 0 | 6 | 1 |
| mileage | 11 | 66 | 4 | 94% | 6 | 5 | 0 |
| checklists | 28 | 111 | 6 | 95% | 2 | 0 | 0 |
| app/(feedback)/feedback | 4 | 0 | 8 | 0% | 0 | 0 | 1 |
| components/features/events | 10 | 84 | 6 | 93% | 1 | 3 | 1 |
| components/features/shared | 6 | 1 | 7 | 13% | 0 | 2 | 0 |
| components/modals | 5 | 31 | 0 | 100% | 7 | 0 | 2 |
| app/(dev)/guest-preview | 1 | 0 | 5 | 0% | 0 | 0 | 1 |

## 1. Raw HTML controls where a DS primitive exists

| Control | Total | Files | Staff screens | Guest pages | DS replacement |
|---|---|---|---|---|---|
| `<button>` | 165 | 81 | 158 | 7 | `Button`, `IconButton`, `LinkButton` |
| `<input>` (not hidden) | 99 | 45 | 80 | 19 | `Input`, `Checkbox` (40 raw), `Radio` (13 raw), `FileUpload` (13 raw), `SearchInput` |
| `<select>` | 11 | 7 | 7 | 4 | `Select` |
| `<textarea>` | 6 | 6 | 0 | 6 | `Textarea` (all six are guest or dev pages) |
| `<table>` | 38 | 29 | 38 | 0 | `Table` / `DataTable` (plus one HTML email table in `src/app/actions/employee-birthdays.ts`, which is correct as raw HTML) |
| `<dialog>` | 0 | 0 | | | |
| `fixed inset-0` overlays | 6 | 5 | 6 | 0 | `Modal`, `Drawer`, `Dropdown` |
| `animate-spin` spinners | 17 | 12 | 15 | 2 | `Spinner` or `Button loading` |
| Hand-rolled pills (`rounded-full px-2 text-xs`) | 17 | 15 | 17 | 0 | `Badge` with a tone |
| Hand-rolled cards (`bg-surface border rounded-lg shadow`) | 48 | 37 | 48 | 0 | `Card` (the token recipe is allowed by UI_UX.md, so low priority) |
| `window.confirm` / `confirm()` | 23 | 20 | 23 | 0 | `ConfirmDialog` |
| `alert()` | 0 | 0 | | | |

**Top offenders (staff screens)**

| File | Raw controls | What |
|---|---|---|
| `src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx` | 26 | 9 buttons, 17 inputs, a local `Field` clone, 17 unstyled labels |
| `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` | 15 | 13 buttons, 2 inputs, 15 non-Field labels |
| `src/app/(authenticated)/rota/timeclock/TimeclockManager.tsx` | 12 | 2 buttons, 7 inputs, 2 selects, 1 table |
| `src/app/(authenticated)/rota/RotaGrid.tsx` | 10 | 7 buttons, 3 inputs (grid cells; some raw buttons are legitimate here) |
| `src/app/(authenticated)/rota/payroll/PayrollClient.tsx` | 9 | 2 buttons, 5 inputs, 1 select, 1 table |
| `src/app/(authenticated)/table-bookings/boh/BohBookingsClient.tsx` | 9 | 7 buttons, 1 table, 1 spinner |
| `src/app/(authenticated)/table-bookings/foh/components/FohCreateBookingModal.tsx` | 9 | 2 buttons, 7 inputs, 7 unstyled labels |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptMobileCard.tsx` and `ReceiptTableRow.tsx` | 7 and 6 | 5 buttons each |
| `src/app/(authenticated)/receipts/vendors/_components/VendorSummaryGrid.tsx` | 6 | 3 tables, local `SegmentedControl` |
| `src/app/(authenticated)/rota/AddShiftsModal.tsx` | 6 | hand-built modal overlay, 2 pills, select |
| `src/app/(authenticated)/short-links/_components/ShortLinksClient.tsx` and `ShortLinkActionsMenu.tsx` | 6 and 4 | 6 buttons; 4 Lucide `Loader2` spinners and a private `PortalMenu` |
| `src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx` | 5 | 3 preview tables, 2 `window.confirm` |
| `src/app/(authenticated)/vouchers/all/LedgerClient.tsx`, `vouchers/handout/HandoutClient.tsx` | 5 each | raw buttons |
| `src/components/features/events/EventCategoryFormGrouped.tsx` | 5 | 5 buttons, 30 old-style labels |

By section, the most raw controls are in rota (46), table bookings (34), private bookings (31), receipts (27) and recruitment (26, one file).

**Overlays (6 in 5 files).** Two real hand-built modals: `rota/AddShiftsModal.tsx:354` and `(timeclock)/timeclock/_components/TimeclockClient.tsx:199`. One Headless UI dialog: `events/_components/ArtworkBrandingModal.tsx:661`. Two click-catcher menus: `employees/[employee_id]/_components/EmployeeHeaderActions.tsx:42` (also the only non-DS `role="menu"`) and `rota/RotaFeedButton.tsx:94`.

**Native confirms (23 calls, 20 files).** `window.confirm`: `invoices/[id]/InvoiceDetailClient.tsx` (2, including a forced-void follow-up), `settings/business-hours/HoursVersionStrip.tsx` (2), `checklists/_components/TaskRow.tsx`, `checklists/manage/_components/TodosClient.tsx`, `events/_components/EventDrawer.tsx`, `settings/calendar-notes/CalendarNotesManager.tsx`. Bare `confirm()`: `invoices/recurring/page.tsx` (2), `invoices/catalog/page.tsx`, `invoices/vendors/page.tsx`, `expenses/_components/ExpensesClient.tsx`, `ExpenseForm.tsx`, `ExpenseFileViewer.tsx`, `roles/components/RoleCard.tsx`, `rota/templates/ShiftTemplatesManager.tsx`, `settings/background-jobs/BackgroundJobsClient.tsx`, `settings/budgets/BudgetsManager.tsx`, `settings/categories/CategoriesClient.tsx`, `src/components/features/catering/CateringPackageModal.tsx`, `src/components/features/invoices/VendorDeleteButton.tsx`, `src/components/features/private-bookings/VenueSpaceDeleteButton.tsx`. Most guard deletes; native dialogs are unstyled, block the thread and are suppressed after "prevent this page from creating dialogs".

**Recommended fix.** Work section by section, starting with rota, table bookings, private bookings, receipts and recruitment. Swap native `confirm()` for `ConfirmDialog` first (small, self-contained, 20 files). Replace the two hand-built modals with `Modal` (it already applies the 44px touch floor needed for the timeclock kiosk). Replace raw `<select>`, text `<input>` and checkbox/radio inputs with the DS fields. Leave raw buttons that act as grid or calendar cells (RotaGrid, ScheduleCalendarMonth) unless a DS cell primitive is added. Replace `animate-spin` with `Spinner` or `Button loading`. The file-level list is in Appendix A.

## 2. compat/ usage (migration debt)

`src/ds/compat/index.ts` re-exports these from the `@/ds` barrel, so imports look like DS imports. No file imports `@/ds/compat` directly.

| compat component | What it is | JSX uses | Files | Main sections |
|---|---|---|---|---|
| `FormGroup` | pure alias of `Field` (6-line file) | 445 | 49 | settings 10, private bookings 8, invoices 7, menu 6, rota 5 |
| `EmptyState` | pure alias of `Empty` | 42 | 31 | settings 7, private bookings 5, invoices 4 |
| `ModalActions` | footer wrapper | 17 | 16 | table bookings 3, components/modals 3 |
| `CardTitle` / `CardDescription` | card heading parts | 13 / 10 | 3 / 3 | customers, roles, settings |
| `SortableHeader` | table sort header | 13 | 3 | expenses 2, mileage 1 |
| `Form` / `FormSection` | form wrapper with its own error and spinner | 10 / 10 | 6 / 3 | settings 4; menu management 3 |
| `StatGroup` | stat row | 5 | 5 | customers, expenses, menu, mgd, mileage |
| `TabNav` | tabs (169 lines) | 3 | 3 | expenses, mgd, mileage |
| `DrawerActions`, `FilterPanel` | drawer footer, filter panel | 3 each | 3 each | menu management only |
| `RadioGroup`, `PopoverHeader`, `PopoverContent` | | 1 each | 1 each | employees, menu management |
| `BackButton` | | 0 | 2 imports, never rendered | `settings/customer-labels/CustomerLabelsClient.tsx`, `quotes/[id]/edit/page.tsx` |
| `Container`, `FormActions` | | 0 | 0 | dead |

Total: 577 JSX uses in 90 files.

**Recommended fix.**
1. Codemod `FormGroup` to `Field` and `EmptyState` to `Empty` (both are aliases, so the rename is behaviour-neutral): 487 uses in up to 80 files, one PR each.
2. Delete the unused `Container`, `FormActions` and `BackButton` (after removing the two dead imports).
3. Migrate the small remainder by hand: `TabNav` to `Tabs` or `SectionNav`, `StatGroup` to a grid of `Stat`, `SortableHeader` to `DataTable` sortable columns (or promote it into composites if raw tables stay), `CardTitle`/`CardDescription` to `CardHeader`, `ModalActions`/`DrawerActions` to the Modal/Drawer footer slot, `Form`/`FormSection` to a plain `<form>` with DS fields.
4. Then remove `export * from './compat'` from `src/ds/index.ts` so the barrel stops offering them.

## 3. Parallel component libraries

There is no parallel generic library: `src/components` holds 107 feature files, and no `components/ui` folder exists. The `src/components/features/guest` kit (GuestButton, GuestCard, GuestBadge, GuestAlert, GuestField and others, 54 importers) is sanctioned by UI_UX.md rule 7 for guest pages. The duplication is local, one-off components that rebuild a DS role:

| Duplicate | File | Still used | DS equivalent | Recommendation |
|---|---|---|---|---|
| `ConfirmDialog` (same name as the DS one; wraps DS Modal and Button) | `src/app/(authenticated)/vouchers/foh/components/ConfirmDialog.tsx` | yes, 2 importers | `ConfirmDialog` | replace; if the kiosk needs bigger targets, add that to the DS one |
| `Stat` | `checklists/manage/_components/TodayAdminClient.tsx:206` | yes | `Stat` | replace |
| `CompactStat` | `short-links/_components/ShortLinksClient.tsx:122` | yes | `Stat` | replace |
| `StatCard` | `receipts/monthly/page.tsx:376` | yes | `Stat` | replace |
| `MetricCard` | `receipts/_components/PnlClient.tsx:63` | yes | `Stat` or `Card` | replace |
| `MetricCard` | `private-bookings/reports/_components/PrivateBookingGrowthReportClient.tsx:76` | yes | `Stat` | replace |
| `Field` (local clone, off-style label) | `recruitment/_components/RecruitmentDashboardClient.tsx:546` | yes | `Field` | replace |
| `Empty` (local, name clash) | `checklists/manage/_components/ProblemsClient.tsx:195` | yes | `Empty` | replace |
| `SegmentedControl` | `receipts/vendors/_components/VendorSummaryGrid.tsx:298` | yes | `Segmented` | replace |
| `PortalMenu` | `short-links/_components/PortalMenu.tsx` | yes, 1 importer | `Dropdown` | replace, or fold into Dropdown if it solves a clipping problem |
| hand-built menus | `employees/[employee_id]/_components/EmployeeHeaderActions.tsx`, `rota/RotaFeedButton.tsx` | yes | `Dropdown` | replace |
| hand-built modals | `rota/AddShiftsModal.tsx`, `(timeclock)/timeclock/_components/TimeclockClient.tsx` | yes | `Modal` | replace |
| Headless UI `Dialog`, `Popover` | `events/_components/ArtworkBrandingModal.tsx`, `rota/hours/HoursByEmployeeClient.tsx` | yes (the only 2 users of `@headlessui/react`) | `Modal`/`Drawer`, `Popover` | replace, then drop the `@headlessui/react` dependency |
| `RefundHistoryTable` x2 (166 lines each, 36 lines differ) | `parking/_components/RefundHistoryTable.tsx`, `src/components/features/invoices/RefundHistoryTable.tsx` | yes | `Table` | merge into one shared component built on `Table` |
| `RefundDialog` x2 (217 and 344 lines) | `parking/_components/RefundDialog.tsx`, `src/components/features/invoices/RefundDialog.tsx` | yes | `Modal` | merge |
| sort headers x3 | `menu-management/_components/MenuDishesTable.tsx` (`SortHeader`), `mileage/_components/MileageTripTable.tsx` (`SortHeader`), `receipts/_components/ui/ReceiptList.tsx` (`SortHeaderButton`) | yes | `DataTable` sortable columns | replace |
| `GuestSubmitButton` (raw button and own spinner) | `src/components/features/shared/GuestSubmitButton.tsx` | yes, 2 importers | `GuestButton` | make it wrap `GuestButton` |
| thin Badge wrappers on the deprecated `variant` prop | `StatusBadge` in `src/components/private-bookings/WorkflowPanels.tsx:88` | yes | `Badge tone` | inline `Badge tone=` |
| `BarChart` (canvas) | `src/components/charts/BarChart.tsx` | yes, 5 importers | DS `Chart` (RevenueChart, Sparkline); `recharts` is also used in 4 files | decide one chart approach; three coexist |

**Dead code to delete:** `src/components/features/shared/NetworkStatus.tsx` (0 importers, 92 lines); compat `Container` and `FormActions` (0 consumers).

## 4. Icon libraries

| Library | Files | Named imports | Distinct icons | With a DS equivalent |
|---|---|---|---|---|
| `@heroicons/react` | 95 | 352 | 84 | 222 (63%) |
| `lucide-react` | 40 | 121 | 50 | 73 (60%) |
| `react-icons` | 0 | 0 | 0 | |
| DS `Icon` | 35 | | 38 names in the set | |

Heroicons sub-sets in use: `24/outline` 82 files, `20/solid` 10, `24/solid` 3. Only one file mixes libraries (`src/components/features/customers/CustomerLabelSelector.tsx`, Heroicons and Lucide). Heroicons lead in settings (13 files), private bookings (10), rota (10), components/features/employees (8). Lucide leads in invoices (12 of 16 files), guest pages `app/g` (5) and quotes (4).

Most common with a DS match: TrashIcon 34 (`trash`), PlusIcon 24 (`plus`), CheckIcon 16 (`check`), PencilIcon 15 and PencilSquareIcon 10 (`edit`), XMarkIcon 13 (`x`), ClockIcon 11 (`clock`), ArrowDownTrayIcon 10 (`download`); Lucide Trash2 14, Clock 9, Plus 8, Check 8, Download 7. Most common with no DS match: ExclamationTriangleIcon 12, CheckCircleIcon 12, SparklesIcon 12, chevrons (Down 7, Right 6, Up 5, Left 3), PaperAirplaneIcon 4, PhoneIcon 4, StarIcon 4; Lucide Loader2 5 (a spinner, should be `Spinner`), Save 3, Send 3.

**Recommended fix.** Add the missing high-frequency glyphs to `src/ds/icons/paths.tsx` (warning, check-circle, x-circle, sparkles, chevron up/down/left/right, send, phone, star), then codemod the 295 imports that map one-to-one, section by section. Lucide can probably leave `package.json` once invoices and quotes move; Heroicons will take longer. Guest pages may keep their own icons if the guest kit wants them, but should pick one library.

## 5. Toasts and notifications

- One `Toaster`, in `src/app/layout.tsx:72`. `(timeclock)/timeclock/page.tsx` only has a comment explaining why it has none. Compliant with UI_UX.md.
- Two toast APIs: 106 files use the DS `toast` helper from `@/ds` (`success`, `error`, `warning`, `info`, `loading`), 68 files import `toast` from `react-hot-toast` directly. No file mixes them. They look the same (`src/ds/primitives/Toast.tsx` says the root Toaster uses the same values), but only the DS helper offers `warning` and `info`. Appendix D lists the 68 files.
- No `alert()`, no `sonner`, no custom toast system.
- 20 files hold an inline success or notice message in state (`const [message, ...] = useState`). On kiosk and guest screens that is right (voucher FOH panels, event check-in kiosk, invoice portal, recruitment booking). Staff screens that use inline state instead of a toast: `checklists/_components/ChecklistScreen.tsx`, `messages/holding/_components/HoldingQueueActions.tsx`, `settings/maintenance/MaintenanceAreasClient.tsx`, `settings/menu-target/MenuTargetForm.tsx`, `settings/table-bookings/TableSetupManager.tsx`, `table-bookings/foh/FohScheduleClient.tsx`, `src/components/private-bookings/PrivateBookingBilling.tsx`, `src/components/private-bookings/PrivateBookingReceiptPanel.tsx`. Five more do both (`events/[id]/RefundBookingDialog.tsx`, `invoices/[id]/payment/page.tsx`, `messages/bulk/BulkMessagesClient.tsx`, `table-bookings/boh/MessageGuestsModal.tsx`, `src/components/features/customers/WinBackCampaign.tsx`).

**Recommended fix.** Codemod the 68 direct imports to `import { toast } from '@/ds'`. Of their 415 calls, 405 are `toast.success` or `toast.error`, which match the DS helper; 10 bare `toast(...)` calls in 6 files (`checklists/_components/TaskRow.tsx`, `rota/AddShiftsModal.tsx`, `rota/RotaGrid.tsx`, `settings/business-hours/SpecialHoursModal.tsx`, `settings/table-bookings/AllocationSettings.tsx`, `table-bookings/boh/BohBookingsClient.tsx`) need `toast.info` by hand. Then add a lint rule (`no-restricted-imports` on `react-hot-toast` outside `src/ds` and `src/app/layout.tsx`). Leave the inline messages alone unless a screen is being reworked; state them as a pattern in UI_UX.md (inline `Alert` for persistent form results, toast for transient confirmations).

## 6. Status colour maps

The named maps in UI_UX.md exist and are used: `invoiceStatusTone` 6 importers, `privateBookingStatusTone` 4, `rotaDepartmentClasses` 6, `ROTA_SHIFT_STATUS_CLASSES` 4 (plus `rotaShiftStatusClasses` 3), `eventStatusTone` 3, `quoteStatusTone` 3, `getTableBookingStatusBadgeClasses` 5 (it reads `TABLE_BOOKING_STATUS_TONE` internally; the constant itself has no direct importer). `eventBookingStatusTone`, `VOUCHER_STATUS_TONES` and `ROTA_HOLIDAY_CLASSES` have one importer each.

Outside them, 47 status-to-colour declarations sit in 36 files. The ones that matter:

| Problem | Files | Fix |
|---|---|---|
| Leave (holiday) status tone copied 4 times, with `danger` in two and `error` in two | `rota/HolidayDetailModal.tsx:33` (`STATUS_TONES`), `rota/leave/LeaveManagerClient.tsx:18` (`STATUS_BADGE`), `src/app/(staff-portal)/portal/leave/page.tsx:24` (`STATUS_TONE`), `src/components/features/employees/EmployeeHolidaysTab.tsx:40` (`statusVariant`) | add a leave tone map beside `ROTA_HOLIDAY_CLASSES` in `src/lib/rota/status-ui.ts` and use it in all four |
| OJ Projects status tone copied 4 times | `oj-projects/_components/ProjectsOverview.tsx`, `oj-projects/entries/_components/EntriesClient.tsx`, `oj-projects/projects/[id]/_components/ProjectDetailClient.tsx`, `oj-projects/projects/_components/ProjectsClient.tsx` | one `oj-projects/_shared/status-ui.ts` |
| Parking and refund status tones copied | `parking/_components/ParkingClient.tsx` (`statusBadgeTone`, `paymentBadgeTone`), `parking/_components/RefundHistoryTable.tsx`, `src/components/features/invoices/RefundHistoryTable.tsx` | one parking map and one refund map (falls out of the refund table merge) |
| Message delivery status tone in 3 places | `events/[id]/EventDetailClient.tsx` (`getMessageStatusTone`), `src/components/private-bookings/CommunicationsTab.tsx` (`statusVariant`, `emailStatusVariant`), `marketing/_shared/marketing-ui.tsx` (`RECIPIENT_STATUS_TONES`) | one shared delivery-status map |
| Domain maps that follow the pattern but are not in UI_UX.md | `marketing/_shared/marketing-ui.tsx`, `maintenance/_components/maintenanceDisplay.ts`, `vouchers/foh/components/voucher-status.ts` (delegates to `VOUCHER_STATUS_TONES`, fine) | list them in UI_UX.md |
| One-off maps | `cashing-up/daily` and `weekly` (`statusTone`), `checklists/manage/_components/WeeklyReviewClient.tsx` (`STATE_STYLE`), `feedback-inbox/FeedbackInboxClient.tsx`, `mgd/_components/MgdClient.tsx`, `recruitment/_components/RecruitmentDashboardClient.tsx` (`cvStatusTone`), `rota/RotaGrid.tsx` (`weekStatusTone`), `rota/RotaPublishStatus.tsx`, `settings/audit-logs` and `settings/background-jobs` (`getStatusVariant`), `employees/_components/EmployeesClient.tsx` and `employees/[employee_id]/page.tsx` (employee status, 2 copies), `receipts/utils.ts` | move each into its domain's `status-ui` file when the screen is next touched; merge the two employee copies now |

Call-site signals: `Badge tone=` 358 uses; the deprecated `Badge variant=` 56 uses in 31 files (top: `rota/timeclock/TimeclockManager.tsx` 5, `src/components/features/menu/SmartImportModal.tsx` 4, `src/components/private-bookings/CommunicationsTab.tsx` 4); inline ternaries choosing a tone at the call site 66 in 51 files; `Badge className=` overrides 49 (mostly table bookings and rota, where the named helpers return class strings by design). 17 hand-rolled pills in 15 files (Appendix A, column "pill"), for example `rota/AddShiftsModal.tsx` (2), `receipts/_components/ui/ReceiptRules.tsx` (2), `messages/_components/ConversationList.tsx`, `table-bookings/foh/components/FohHeader.tsx`, `src/components/schedule-calendar/CalendarFilterBar.tsx` (`Chip`).

**Recommended fix.** Codemod `variant=` to `tone=` on `Badge` (the mapping table is in `src/ds/primitives/Badge.tsx`), then remove the prop. Consolidate the duplicated maps above. Replace hand-rolled pills with `Badge`.

## 7. Forms

| Measure | Count |
|---|---|
| DS `Field` | 190 uses, 30 files |
| compat `FormGroup` (alias of Field) | 445 uses, 49 files |
| DS `Input` / `Select` / `Textarea` / `Checkbox` | 836 / 294 / 187 / 112 uses |
| raw `<label>` | 251 in 85 files: 147 old `text-sm font-medium` style, 96 other (many wrap a checkbox or radio, which is fine), 7 `sr-only`, 1 in Field style |
| `<form>` layouts | 126 forms: 94 stacked (`space-y` or `flex-col`), 5 grid, 3 flex, 24 with no class |
| submit buttons | 113 DS `<Button type="submit">` in 84 files; 2 raw submit buttons, both in the guest kit; `FormSubmitButton` 0 uses |

Worst label files: `src/components/features/events/EventCategoryFormGrouped.tsx` (30 old-style labels), `recruitment/_components/RecruitmentDashboardClient.tsx` (17, plus the local Field clone), `private-bookings/[id]/PrivateBookingDetailClient.tsx` (15), `receipts/_components/ReceiptBulkReviewClient.tsx` (9), `src/components/features/employees/RightToWorkTab.tsx` (9), `messages/bulk/BulkMessagesClient.tsx` (7), `table-bookings/foh/components/FohCreateBookingModal.tsx` (7), and the invoice pages `invoices/[id]/edit`, `invoices/new`, `invoices/vendors` (5 each) and `invoices/catalog` (4). By section: components/features/events 34, invoices 27, private bookings 27, components/features/employees 20, recruitment 17.

Layout is mostly consistent (stacked). Grid-at-form-level only in `marketing/page.tsx`, `recruitment/_components/RecruitmentDashboardClient.tsx` and `settings/table-bookings/TableSetupManager.tsx`.

**Recommended fix.** Wrap each old-style label and its control in `Field` (or use the `label` prop of `Input`, `Select`, `Textarea`), starting with the files above. Decide whether `FormSubmitButton` should replace the 113 `Button type="submit"` uses (it would give one pending state through `useFormStatus`) or be deleted; today it is dead weight.

## 8. Tables, pagination and empty states

| Measure | Count |
|---|---|
| DS `Table` | 42 files |
| DS `DataTable` | 12 files (customers detail, invoice catalog and recurring, menu dishes, ingredients and recipes, audit logs, background jobs, business hours, event categories, catering) |
| raw `<table>` | 38 in 29 files; one file mixes raw and DS (`oj-projects/clients/_components/ClientsClient.tsx`) |
| DS `Pagination` | 8 files |
| DS `TablePagination` | 12 files |
| hand-rolled pagination | 4: `receipts/_components/ReceiptsClient.tsx:211`, `receipts/_components/ui/ReceiptRules.tsx:640`, `cashing-up/import/_components/ImportClient.tsx:267`, `marketing/page.tsx:267` |
| "Load more" / "Show more" | 3: `insights/_components/InsightsReportView.tsx`, `feedback-inbox/FeedbackInboxClient.tsx`, `maintenance/_components/MaintenanceListClient.tsx` |
| sorting | DataTable sortable columns; compat `SortableHeader` in 3 files; 3 hand-built sort headers (section 3) |
| empty states | `Empty` in 32 files, compat `EmptyState` in 31; of the 29 raw-table files, 8 draw a `colSpan` "no rows" row, 4 use Empty, 17 do neither (their empty handling is either elsewhere or missing; heuristic, check per file) |

Raw tables by file: `invoices/[id]/InvoiceDetailClient.tsx` (3 preview tables), `menu-management/dishes/_components/DishGpAnalysisTab.tsx` (3), `receipts/vendors/_components/VendorSummaryGrid.tsx` (3), `mileage/_components/DestinationsClient.tsx` (2), `oj-projects/clients/_components/ClientsClient.tsx` (2), `rota/hours/HoursByEmployeeClient.tsx` (2), and one each in checklists weekly review, employees reliability, expenses insights, insights report, menu dishes table, mileage insights, parking and invoices refund history, PB invoice modal, PB growth report, receipts list, missing-expense and monthly, payroll, timeclock manager, calendar notes, pay bands, SMS failures, table booking detail, BOH bookings, roles, employee pay tab, PB receipt panel.

**Recommended fix.** Move raw tables to `Table` (same markup, token header) or `DataTable` where sorting or empty handling is wanted; the DataTable `emptyMessage` prop then gives a consistent empty row. Pick one pagination component (two DS APIs exist: `Pagination` and `TablePagination`) and move the four hand-rolled pagers to it. Codemod `EmptyState` to `Empty`.

## Suggested order

1. Mechanical codemods, no visual change: `FormGroup` to `Field`, `EmptyState` to `Empty`, `Badge variant` to `tone` (543 JSX call sites), and direct `react-hot-toast` to DS `toast` (68 import lines). Each is a single PR with the existing tests.
2. Native `confirm()` to `ConfirmDialog` (20 files) and the three hand-built modals/Headless UI dialog to `Modal` (then drop `@headlessui/react`).
3. Consolidate duplicated status maps (leave, OJ Projects, parking/refunds, message delivery, employee status) and merge the two refund tables and dialogs.
4. Section passes on the top offenders (rota, table bookings, private bookings, receipts, recruitment, invoices labels) for raw inputs, selects, tables and labels.
5. Icon set extension, then icon codemod; retire Lucide first.
6. Delete dead pieces: `NetworkStatus.tsx`, compat `Container`, `FormActions`, `BackButton`, and the compat barrel export once empty. Decide `FormSubmitButton` (adopt or delete).

A guard in the style of `tests/guards/design-tokens.test.ts` (count per file, baseline, never rise) would stop new raw `<button>`, `<select>`, `<table>`, `confirm()`, compat imports and third-party icon imports while the migration runs.

## Method and limits

- Scope: `src/app` and `src/components`, excluding tests, `src/app/api` and `src/ds`. Comments stripped before matching.
- Pills and cards are detected from class-list string literals, so a pill whose classes are split across `cn()` arguments may be missed, and a token-based card is allowed by UI_UX.md.
- Status-map detection is name and pattern based; it will miss a map with an unrelated name and may list a helper that only delegates.
- Label "other" includes labels wrapping checkboxes, which are correct.
- Empty-state and pagination checks are heuristics; confirm per file before changing.
- Raw buttons used as grid or calendar cells are counted but may be legitimate.

## Appendix A: per-file raw control counts

Every in-scope file with at least one raw control, native confirm or hand-rolled pill/card, grouped by section. Columns: btn = <button>, inp = <input> excluding hidden, sel = <select>, ta = <textarea>, tbl = <table>, ovl = fixed inset-0 overlay, spin = animate-spin, pill = hand-rolled pill class string, card = hand-rolled card class string, conf = native confirm().

| File | btn | inp | sel | ta | tbl | ovl | spin | pill | card | conf |
|---|---|---|---|---|---|---|---|---|---|---|
| (auth)/cashing-up/daily/_components/DailyClient.tsx | 1 | 1 |  |  |  |  |  |  |  |  |
| (auth)/cashing-up/insights/_components/InsightsClient.tsx |  |  |  |  |  |  |  |  | 1 |  |
| (auth)/checklists/manage/_components/WeeklyReviewClient.tsx | 1 |  |  |  | 1 |  |  | 1 |  |  |
| (auth)/checklists/_components/AttributionPicker.tsx | 1 |  |  |  |  |  |  |  | 1 |  |
| (auth)/checklists/_components/ChecklistScreen.tsx |  |  |  |  |  |  |  |  | 1 |  |
| (auth)/checklists/_components/TaskRow.tsx |  |  |  |  |  |  |  |  |  | 1 |
| (auth)/checklists/manage/_components/TodosClient.tsx |  |  |  |  |  |  |  |  |  | 1 |
| (auth)/customers/insights/page.tsx |  |  |  |  |  |  |  |  | 1 |  |
| (auth)/dashboard/_components/DashboardClient.tsx |  |  |  |  |  |  |  |  | 1 |  |
| (auth)/employees/[employee_id]/_components/EmployeeHeaderActions.tsx |  |  |  |  |  | 1 |  |  | 1 |  |
| (auth)/employees/new/NewEmployeeOnboardingClient.tsx |  |  |  |  |  |  | 1 |  |  |  |
| (auth)/employees/reliability/page.tsx |  |  |  |  | 1 |  |  |  |  |  |
| (auth)/error.tsx | 2 |  |  |  |  |  |  |  |  |  |
| (auth)/events/_components/ArtworkBrandingModal.tsx | 1 | 1 |  |  |  | 2 |  |  |  |  |
| (auth)/events/_components/branding/BrandingControls.tsx | 1 | 2 |  |  |  |  |  |  |  |  |
| (auth)/events/[id]/EventDetailClient.tsx |  | 1 |  |  |  |  |  |  |  |  |
| (auth)/events/_components/EventCard.tsx | 1 |  |  |  |  |  |  |  |  |  |
| (auth)/events/_components/EventDrawer.tsx |  |  |  |  |  |  |  |  |  | 1 |
| (auth)/events/_components/EventImagePanel.tsx |  | 1 |  |  |  |  |  |  |  |  |
| (auth)/events/_components/EventListView.tsx | 1 |  |  |  |  |  |  |  |  |  |
| (auth)/expenses/_components/ExpenseForm.tsx |  | 1 |  |  |  |  |  |  |  | 1 |
| (auth)/expenses/_components/ExpenseFileViewer.tsx |  |  |  |  |  |  |  |  |  | 1 |
| (auth)/expenses/_components/ExpensesClient.tsx |  |  |  |  |  |  |  |  |  | 1 |
| (auth)/expenses/insights/_components/ExpensesInsightsClient.tsx |  |  |  |  | 1 |  |  |  |  |  |
| (auth)/insights/_components/InsightsReportView.tsx |  |  |  |  | 1 |  |  |  | 3 |  |
| (auth)/invoices/[id]/InvoiceDetailClient.tsx |  |  |  |  | 3 |  |  |  |  | 2 |
| (auth)/invoices/recurring/page.tsx |  |  |  |  |  |  |  |  | 1 | 2 |
| (auth)/invoices/new/page.tsx | 1 |  |  |  |  |  |  |  | 1 |  |
| (auth)/invoices/catalog/page.tsx |  |  |  |  |  |  |  |  |  | 1 |
| (auth)/invoices/vendors/page.tsx |  |  |  |  |  |  |  |  |  | 1 |
| (auth)/maintenance/_components/MaintenancePhotos.tsx |  | 2 |  |  |  |  |  |  |  |  |
| (auth)/menu-management/_components/MenuDishesTable.tsx | 2 |  |  |  | 1 |  |  |  |  |  |
| (auth)/menu-management/_components/MenuManagementClient.tsx | 3 |  |  |  |  |  |  |  |  |  |
| (auth)/menu-management/dishes/_components/DishGpAnalysisTab.tsx |  |  |  |  | 3 |  |  |  |  |  |
| (auth)/menu-management/_components/EditableCurrencyCell.tsx | 1 | 1 |  |  |  |  |  |  |  |  |
| (auth)/menu-management/dishes/_components/CompositionRow.tsx |  |  |  |  |  |  |  |  | 2 |  |
| (auth)/menu-management/dishes/_components/DishExpandedRow.tsx |  |  |  |  |  |  |  |  | 2 |  |
| (auth)/menu-management/_components/StatusToggleCell.tsx | 1 |  |  |  |  |  |  |  |  |  |
| (auth)/menu-management/dishes/_components/DishMenusTab.tsx |  |  |  |  |  |  |  |  | 1 |  |
| (auth)/menu-management/ingredients/_components/IngredientExpandedRow.tsx |  |  |  |  |  |  |  |  | 1 |  |
| (auth)/menu-management/recipes/_components/RecipeExpandedRow.tsx |  |  |  |  |  |  |  |  | 1 |  |
| (auth)/menu-management/recipes/_components/RecipeIngredientRow.tsx |  |  |  |  |  |  |  |  | 1 |  |
| (auth)/messages/_components/ConversationList.tsx | 1 |  |  |  |  |  |  | 1 |  |  |
| (auth)/messages/_components/ConversationThread.tsx |  |  |  |  |  |  |  | 1 |  |  |
| (auth)/mileage/_components/DestinationsClient.tsx |  |  |  |  | 2 |  |  |  | 4 |  |
| (auth)/mileage/_components/MileageTripTable.tsx | 1 |  |  |  |  |  |  |  |  |  |
| (auth)/mileage/insights/_components/MileageInsightsClient.tsx |  |  |  |  | 1 |  |  |  |  |  |
| (auth)/oj-projects/clients/_components/ClientsClient.tsx |  |  |  |  | 2 |  |  |  |  |  |
| (auth)/parking/_components/ParkingClient.tsx | 1 |  |  |  |  |  |  |  |  |  |
| (auth)/parking/_components/RefundDialog.tsx | 1 |  |  |  |  |  |  |  |  |  |
| (auth)/parking/_components/RefundHistoryTable.tsx |  |  |  |  | 1 |  |  |  |  |  |
| (auth)/private-bookings/[id]/PrivateBookingDetailClient.tsx | 13 | 2 |  |  |  |  |  |  | 1 |  |
| (auth)/private-bookings/reports/_components/PrivateBookingGrowthReportClient.tsx | 2 |  |  |  | 1 |  |  | 1 | 2 |  |
| (auth)/private-bookings/[id]/items/page.tsx | 4 |  |  |  |  |  |  |  |  |  |
| (auth)/private-bookings/[id]/InvoiceBookingModal.tsx |  | 2 |  |  | 1 |  |  |  |  |  |
| (auth)/private-bookings/_components/PrivateBookingsClient.tsx |  |  | 2 |  |  |  |  |  |  |  |
| (auth)/private-bookings/[id]/edit/page.tsx |  | 1 |  |  |  |  |  |  |  |  |
| (auth)/private-bookings/[id]/messages/PrivateBookingMessagesClient.tsx | 1 |  |  |  |  |  |  |  |  |  |
| (auth)/private-bookings/new/page.tsx |  | 1 |  |  |  |  |  |  |  |  |
| (auth)/profile/_components/ProfileClient.tsx |  | 1 |  |  |  |  |  |  |  |  |
| (auth)/receipts/_components/ui/ReceiptMobileCard.tsx | 5 | 1 |  |  |  |  |  | 1 | 1 |  |
| (auth)/receipts/_components/ui/ReceiptTableRow.tsx | 5 | 1 |  |  |  |  |  |  |  |  |
| (auth)/receipts/vendors/_components/VendorSummaryGrid.tsx | 2 |  |  |  | 3 |  |  | 1 |  |  |
| (auth)/receipts/_components/ui/ReceiptRules.tsx |  | 1 |  |  |  |  |  | 2 |  |  |
| (auth)/receipts/bank-balance/BankBalanceClient.tsx | 1 |  |  |  |  |  |  |  | 2 |  |
| (auth)/receipts/_components/ui/ReceiptList.tsx | 1 |  |  |  | 1 |  |  |  |  |  |
| (auth)/receipts/missing-expense/page.tsx |  |  |  |  | 1 |  |  |  |  |  |
| (auth)/receipts/monthly/page.tsx |  |  |  |  | 1 |  |  |  |  |  |
| (auth)/recruitment/_components/RecruitmentDashboardClient.tsx | 9 | 17 |  |  |  |  |  |  |  |  |
| (auth)/roles/components/RoleCard.tsx |  |  |  |  |  |  |  |  |  | 1 |
| (auth)/rota/timeclock/TimeclockManager.tsx | 2 | 7 | 2 |  | 1 |  |  |  | 1 |  |
| (auth)/rota/RotaGrid.tsx | 7 | 3 |  |  |  |  |  |  |  |  |
| (auth)/rota/payroll/PayrollClient.tsx | 2 | 5 | 1 |  | 1 |  |  |  | 1 |  |
| (auth)/rota/AddShiftsModal.tsx |  | 2 | 1 |  |  | 1 |  | 2 | 1 |  |
| (auth)/rota/RotaFeedButton.tsx |  | 1 |  |  |  | 1 |  |  | 2 |  |
| (auth)/rota/hours/HoursByEmployeeClient.tsx | 1 |  |  |  | 2 |  |  |  |  |  |
| (auth)/rota/templates/ShiftTemplatesManager.tsx | 2 |  |  |  |  |  |  |  |  | 1 |
| (auth)/rota/leave/LeaveManagerClient.tsx | 1 |  |  |  |  |  |  |  |  |  |
| (auth)/settings/business-hours/HoursVersionStrip.tsx | 2 |  |  |  |  |  |  |  |  | 2 |
| (auth)/settings/background-jobs/BackgroundJobsClient.tsx |  |  |  |  |  |  | 1 |  |  | 1 |
| (auth)/settings/budgets/BudgetsManager.tsx | 1 |  |  |  |  |  |  |  |  | 1 |
| (auth)/settings/calendar-notes/CalendarNotesManager.tsx |  |  |  |  | 1 |  |  |  |  | 1 |
| (auth)/settings/customer-labels/CustomerLabelsClient.tsx | 2 |  |  |  |  |  |  |  |  |  |
| (auth)/settings/design-system/page.tsx | 1 |  |  |  |  |  |  | 1 |  |  |
| (auth)/settings/pay-bands/PayBandsManager.tsx | 1 |  |  |  | 1 |  |  |  |  |  |
| (auth)/settings/table-bookings/TableSetupManager.tsx |  | 2 |  |  |  |  |  |  |  |  |
| (auth)/settings/business-hours/SpecialHoursCalendar.tsx | 1 |  |  |  |  |  |  |  |  |  |
| (auth)/settings/categories/CategoriesClient.tsx |  |  |  |  |  |  |  |  |  | 1 |
| (auth)/settings/sms-failures/page.tsx |  |  |  |  | 1 |  |  |  |  |  |
| (auth)/short-links/_components/ShortLinksClient.tsx | 6 |  |  |  |  |  |  |  | 1 |  |
| (auth)/short-links/_components/ShortLinkActionsMenu.tsx |  |  |  |  |  |  | 4 |  |  |  |
| (auth)/short-links/_components/PortalMenu.tsx | 1 |  |  |  |  |  |  |  | 1 |  |
| (auth)/short-links/legacy-domain/page.tsx |  |  |  |  |  |  |  |  | 1 |  |
| (auth)/table-bookings/boh/BohBookingsClient.tsx | 7 |  |  |  | 1 |  | 1 |  |  |  |
| (auth)/table-bookings/foh/components/FohCreateBookingModal.tsx | 2 | 7 |  |  |  |  |  |  |  |  |
| (auth)/table-bookings/foh/components/FohHeader.tsx | 2 | 1 |  |  |  |  |  | 1 |  |  |
| (auth)/table-bookings/foh/FohClockWidget.tsx | 2 |  |  |  |  |  |  | 1 |  |  |
| (auth)/table-bookings/foh/components/FohOutsideBookings.tsx | 1 |  |  |  |  |  | 1 |  | 1 |  |
| (auth)/table-bookings/[id]/BookingDetailClient.tsx |  | 1 |  |  | 1 |  |  |  |  |  |
| (auth)/table-bookings/foh/components/FohChangeTimeModal.tsx | 2 |  |  |  |  |  |  |  |  |  |
| (auth)/table-bookings/foh/components/FohUnassignedBookings.tsx | 1 |  |  |  |  |  |  |  | 1 |  |
| (auth)/table-bookings/foh/components/FohBookingDetailModal.tsx | 1 |  |  |  |  |  |  |  |  |  |
| (auth)/table-bookings/foh/components/FohTimeline.tsx |  |  |  |  |  |  | 1 |  |  |  |
| (auth)/table-bookings/reports/page.tsx |  |  |  |  |  |  |  |  | 1 |  |
| (auth)/users/_components/RolesContent.tsx | 1 |  |  |  | 1 |  |  |  |  |  |
| (auth)/vouchers/all/LedgerClient.tsx | 5 |  |  |  |  |  |  |  |  |  |
| (auth)/vouchers/handout/HandoutClient.tsx | 5 |  |  |  |  |  |  |  |  |  |
| (auth)/vouchers/foh/components/HandOutPanel.tsx | 3 |  |  |  |  |  |  |  |  |  |
| (auth)/vouchers/foh/components/CustomerAttach.tsx | 2 |  |  |  |  |  |  |  |  |  |
| (auth)/vouchers/[number]/VoucherDetailClient.tsx | 1 |  |  |  |  |  |  |  |  |  |
| (auth)/vouchers/foh/components/NumberSearch.tsx | 1 |  |  |  |  |  |  |  |  |  |
| src/app/(dev)/guest-preview/page.tsx |  | 4 |  | 1 |  |  |  |  |  |  |
| src/app/(employee-onboarding)/onboarding/success/page.tsx |  |  |  |  |  |  |  |  | 1 |  |
| src/app/(feedback)/feedback/tell-us/TellUsClient.tsx | 1 | 5 |  | 1 |  |  | 1 |  |  |  |
| src/app/(timeclock)/timeclock/_components/TimeclockClient.tsx | 1 | 1 |  |  |  | 1 |  |  |  |  |
| src/app/auth/login/_components/LoginClient.tsx | 1 |  |  |  |  |  |  |  |  |  |
| src/app/g/[token]/private-feedback/page.tsx |  |  | 3 | 1 |  |  |  |  |  |  |
| src/app/g/[token]/table-manage/PreorderSection.tsx |  | 3 | 1 |  |  |  |  |  |  |  |
| src/app/g/[token]/email-capture/page.tsx |  | 2 |  |  |  |  |  |  |  |  |
| src/app/g/[token]/table-manage/page.tsx |  | 1 |  | 1 |  |  |  |  |  |  |
| src/app/g/[token]/event-payment/EventPayPalPaymentClient.tsx | 1 |  |  |  |  |  |  |  |  |  |
| src/app/g/[token]/manage-booking/page.tsx |  | 1 |  |  |  |  |  |  |  |  |
| src/app/g/[token]/table-payment/TablePaymentClient.tsx | 1 |  |  |  |  |  |  |  |  |  |
| src/app/global-error.tsx | 2 |  |  |  |  |  |  |  |  |  |
| src/app/legacy-link/[code]/LegacyLinkClient.tsx | 1 | 1 |  | 1 |  |  |  |  |  |  |
| src/app/recruitment/book/[token]/RecruitmentBookingClient.tsx |  | 1 |  |  |  |  |  |  |  |  |
| src/components/features/catering/CateringPackageModal.tsx |  |  |  |  |  |  |  |  |  | 1 |
| src/components/features/customers/CustomerLabelSelector.tsx | 2 |  |  |  |  |  | 2 | 1 | 1 |  |
| src/components/features/customers/CustomerSearchInput.tsx | 2 |  |  |  |  |  | 1 |  | 2 |  |
| src/components/features/customers/CustomerImport.tsx |  | 1 |  |  |  |  |  |  |  |  |
| src/components/features/customers/CustomerLabelDisplay.tsx |  |  |  |  |  |  |  | 1 |  |  |
| src/components/features/customers/WinBackCampaign.tsx | 1 |  |  |  |  |  |  |  |  |  |
| src/components/features/employees/OnboardingChecklistTab.tsx | 1 |  |  |  |  |  | 2 |  |  |  |
| src/components/features/employees/AddEmployeeAttachmentForm.tsx |  | 1 |  |  |  |  |  |  | 1 |  |
| src/components/features/employees/EmployeeStatusActions.tsx |  | 2 |  |  |  |  |  |  |  |  |
| src/components/features/employees/EmployeePayTab.tsx |  |  |  |  | 1 |  |  |  |  |  |
| src/components/features/employees/RightToWorkTab.tsx |  | 1 |  |  |  |  |  |  |  |  |
| src/components/features/events/EventCategoryFormGrouped.tsx | 5 |  |  |  |  |  |  |  |  |  |
| src/components/features/events/EventChecklistCard.tsx |  |  |  |  |  |  | 1 |  |  |  |
| src/components/features/feedback/StarRating.tsx | 1 |  |  |  |  |  |  |  |  |  |
| src/components/features/guest/GuestButton.tsx | 1 |  |  |  |  |  |  |  |  |  |
| src/components/features/invoices/RefundHistoryTable.tsx |  |  |  |  | 1 |  |  |  |  |  |
| src/components/features/invoices/VendorDeleteButton.tsx |  |  |  |  |  |  |  |  |  | 1 |
| src/components/features/messages/MessageThread.tsx | 1 |  |  |  |  |  |  | 1 |  |  |
| src/components/features/private-bookings/VenueSpaceDeleteButton.tsx |  |  |  |  |  |  |  |  |  | 1 |
| src/components/features/shared/GuestCancelBooking.tsx | 1 | 1 |  | 1 |  |  |  |  |  |  |
| src/components/features/shared/SquareImageUpload.tsx | 1 | 1 |  |  |  |  |  |  | 1 |  |
| src/components/features/shared/GuestSubmitButton.tsx | 1 |  |  |  |  |  | 1 |  |  |  |
| src/components/features/table-bookings/ChristmasCourseFields.tsx |  |  | 1 |  |  |  |  |  |  |  |
| src/components/foh/DraggableBookingBlock.tsx | 1 |  |  |  |  |  |  |  |  |  |
| src/components/private-bookings/EventDetailsRiskSection.tsx |  | 4 |  |  |  |  |  |  |  |  |
| src/components/private-bookings/PrivateBookingBilling.tsx |  | 1 |  |  |  |  |  |  |  |  |
| src/components/private-bookings/PrivateBookingReceiptPanel.tsx |  |  |  |  | 1 |  |  |  |  |  |
| src/components/private-bookings/WorkflowPanels.tsx |  | 1 |  |  |  |  |  |  |  |  |
| src/components/schedule-calendar/ScheduleCalendarMonth.tsx | 4 |  |  |  |  |  |  |  |  |  |
| src/components/schedule-calendar/CalendarFilterBar.tsx | 1 |  |  |  |  |  |  | 1 |  |  |
| src/components/schedule-calendar/ScheduleCalendarList.tsx | 1 |  |  |  |  |  |  |  | 1 |  |
| src/components/schedule-calendar/CalendarEntryTooltip.tsx |  |  |  |  |  |  |  |  | 1 |  |
| src/components/schedule-calendar/ScheduleCalendar.tsx | 1 |  |  |  |  |  |  |  |  |  |
| src/components/schedule-calendar/VenueCalendar.tsx | 1 |  |  |  |  |  |  |  |  |  |

## Appendix B: compat importers

- **FormGroup** (49 files): (auth)/employees/new/NewEmployeeOnboardingClient.tsx, (auth)/invoices/[id]/edit/page.tsx, (auth)/invoices/[id]/payment/page.tsx, (auth)/invoices/export/page.tsx, (auth)/invoices/new/page.tsx, (auth)/invoices/recurring/[id]/edit/page.tsx, (auth)/invoices/recurring/new/page.tsx, (auth)/invoices/vendors/page.tsx, (auth)/menu-management/dishes/_components/CompositionRow.tsx, (auth)/menu-management/dishes/_components/DishMenusTab.tsx, (auth)/menu-management/dishes/_components/DishOverviewTab.tsx, (auth)/menu-management/ingredients/_components/IngredientDrawer.tsx, (auth)/menu-management/recipes/_components/RecipeDrawer.tsx, (auth)/menu-management/recipes/_components/RecipeIngredientRow.tsx, (auth)/private-bookings/[id]/ConfirmDepositPanel.tsx, (auth)/private-bookings/[id]/PrivateBookingDetailClient.tsx, (auth)/private-bookings/[id]/edit/page.tsx, (auth)/private-bookings/[id]/items/page.tsx, (auth)/private-bookings/[id]/messages/PrivateBookingMessagesClient.tsx, (auth)/private-bookings/new/page.tsx, (auth)/private-bookings/settings/spaces/page.tsx, (auth)/private-bookings/settings/vendors/page.tsx, (auth)/profile/change-password/page.tsx, (auth)/quotes/[id]/edit/page.tsx, (auth)/quotes/new/page.tsx, (auth)/rota/BookHolidayModal.tsx, (auth)/rota/CreateShiftModal.tsx, (auth)/rota/MarkSickModal.tsx, (auth)/rota/ShiftDetailModal.tsx, (auth)/rota/templates/ShiftTemplatesManager.tsx, (auth)/settings/audit-logs/AuditLogsClient.tsx, (auth)/settings/background-jobs/BackgroundJobsClient.tsx, (auth)/settings/budgets/BudgetsManager.tsx, (auth)/settings/calendar-notes/CalendarNotesManager.tsx, (auth)/settings/customer-labels/CustomerLabelsClient.tsx, (auth)/settings/import-messages/ImportMessagesClient.tsx, (auth)/settings/menu-target/MenuTargetForm.tsx, (auth)/settings/message-templates/MessageTemplatesClient.tsx, (auth)/settings/pay-bands/PayBandsManager.tsx, (auth)/settings/rota/RotaSettingsManager.tsx, src/app/(employee-onboarding)/onboarding/[token]/steps/TimeOffStep.tsx, src/app/(staff-portal)/portal/leave/LeaveRequestForm.tsx, src/components/features/catering/CateringPackageModal.tsx, src/components/features/employees/EmployeeHolidaysTab.tsx, src/components/features/employees/EmployeePayTab.tsx, src/components/modals/EmailQuoteModal.tsx, src/components/private-bookings/EventDetailsRiskSection.tsx, src/components/private-bookings/WorkflowPanels.tsx, src/components/schedule-calendar/VenueCalendar.tsx
- **EmptyState** (31 files): (auth)/employees/birthdays/page.tsx, (auth)/events/[id]/EventDetailClient.tsx, (auth)/events/[id]/EventTicketTypesCard.tsx, (auth)/invoices/catalog/page.tsx, (auth)/invoices/new/page.tsx, (auth)/invoices/recurring/page.tsx, (auth)/invoices/vendors/page.tsx, (auth)/menu-management/dishes/page.tsx, (auth)/menu-management/ingredients/page.tsx, (auth)/menu-management/recipes/page.tsx, (auth)/private-bookings/[id]/PrivateBookingDetailClient.tsx, (auth)/private-bookings/[id]/items/page.tsx, (auth)/private-bookings/settings/spaces/page.tsx, (auth)/private-bookings/settings/vendors/page.tsx, (auth)/private-bookings/sms-queue/page.tsx, (auth)/quotes/new/page.tsx, (auth)/receipts/bank-balance/BankBalanceClient.tsx, (auth)/receipts/monthly/MonthlyCharts.tsx, (auth)/receipts/monthly/page.tsx, (auth)/settings/audit-logs/AuditLogsClient.tsx, (auth)/settings/background-jobs/BackgroundJobsClient.tsx, (auth)/settings/categories/CategoriesClient.tsx, (auth)/settings/customer-labels/CustomerLabelsClient.tsx, (auth)/settings/event-categories/page.tsx, (auth)/settings/maintenance/MaintenanceAreasClient.tsx, (auth)/settings/message-templates/MessageTemplatesClient.tsx, (auth)/table-bookings/boh/BohBookingsClient.tsx, src/components/features/catering/CateringManager.tsx, src/components/features/events/EventChecklistCard.tsx, src/components/private-bookings/CommunicationsTab.tsx, src/components/private-bookings/WorkflowPanels.tsx
- **ModalActions** (16 files): (auth)/checklists/manage/_components/ChecklistModal.tsx, (auth)/checklists/manage/_components/TemplateModal.tsx, (auth)/invoices/catalog/page.tsx, (auth)/invoices/vendors/page.tsx, (auth)/roles/components/RolePermissionsModal.tsx, (auth)/settings/business-hours/SpecialHoursModal.tsx, (auth)/table-bookings/foh/FohClockWidget.tsx, (auth)/table-bookings/foh/components/FohChangeTimeModal.tsx, (auth)/table-bookings/foh/components/FohMiniModals.tsx, (auth)/users/components/UserRolesModal.tsx, src/components/features/catering/CateringPackageModal.tsx, src/components/features/invoices/EmailInvoiceModal.tsx, src/components/modals/AddNoteModal.tsx, src/components/modals/ChasePaymentModal.tsx, src/components/modals/EmailQuoteModal.tsx, src/components/private-bookings/DeleteBookingButton.tsx
- **Form** (6 files): (auth)/private-bookings/[id]/PrivateBookingDetailClient.tsx, (auth)/settings/categories/CategoriesClient.tsx, (auth)/settings/customer-labels/CustomerLabelsClient.tsx, (auth)/settings/maintenance/MaintenanceAreasClient.tsx, (auth)/settings/message-templates/MessageTemplatesClient.tsx, src/components/private-bookings/WorkflowPanels.tsx
- **StatGroup** (5 files): (auth)/customers/insights/page.tsx, (auth)/expenses/insights/_components/ExpensesInsightsClient.tsx, (auth)/menu-management/dishes/page.tsx, (auth)/mgd/insights/_components/MgdInsightsClient.tsx, (auth)/mileage/insights/_components/MileageInsightsClient.tsx
- **CardDescription** (3 files): (auth)/customers/[id]/page.tsx, (auth)/roles/components/RoleCard.tsx, (auth)/settings/gdpr/page.tsx
- **CardTitle** (3 files): (auth)/customers/[id]/page.tsx, (auth)/roles/components/RoleCard.tsx, (auth)/settings/gdpr/page.tsx
- **SortableHeader** (3 files): (auth)/expenses/_components/ExpensesClient.tsx, (auth)/expenses/insights/_components/ExpensesInsightsClient.tsx, (auth)/mileage/insights/_components/MileageInsightsClient.tsx
- **TabNav** (3 files): (auth)/expenses/insights/_components/ExpensesInsightsClient.tsx, (auth)/mgd/insights/_components/MgdInsightsClient.tsx, (auth)/mileage/insights/_components/MileageInsightsClient.tsx
- **DrawerActions** (3 files): (auth)/menu-management/dishes/_components/DishDrawer.tsx, (auth)/menu-management/ingredients/_components/IngredientDrawer.tsx, (auth)/menu-management/recipes/_components/RecipeDrawer.tsx
- **FormSection** (3 files): (auth)/menu-management/dishes/_components/DishOverviewTab.tsx, (auth)/menu-management/ingredients/_components/IngredientDrawer.tsx, (auth)/menu-management/recipes/_components/RecipeDrawer.tsx
- **FilterPanel** (3 files): (auth)/menu-management/dishes/page.tsx, (auth)/menu-management/ingredients/page.tsx, (auth)/menu-management/recipes/page.tsx
- **BackButton** (2 files): (auth)/quotes/[id]/edit/page.tsx, (auth)/settings/customer-labels/CustomerLabelsClient.tsx
- **RadioGroup** (1 files): (auth)/employees/new/NewEmployeeOnboardingClient.tsx
- **PopoverHeader** (1 files): (auth)/menu-management/ingredients/_components/PriceHistoryPopover.tsx
- **PopoverContent** (1 files): (auth)/menu-management/ingredients/_components/PriceHistoryPopover.tsx

## Appendix C: files importing an icon library

- **@heroicons/react** (95 files): (auth)/customers/[id]/page.tsx, (auth)/customers/insights/page.tsx, (auth)/employees/[employee_id]/_components/QuickAddNoteSheet.tsx, (auth)/employees/[employee_id]/page.tsx, (auth)/employees/birthdays/page.tsx, (auth)/events/_components/ArtworkBrandingModal.tsx, (auth)/events/_components/EventImagePanel.tsx, (auth)/menu-management/_components/MenuDishesTable.tsx, (auth)/menu-management/dishes/_components/CompositionRow.tsx, (auth)/menu-management/dishes/_components/DishDrawer.tsx, (auth)/menu-management/dishes/_components/DishGpAnalysisTab.tsx, (auth)/menu-management/dishes/page.tsx, (auth)/menu-management/ingredients/page.tsx, (auth)/menu-management/recipes/_components/RecipeIngredientRow.tsx, (auth)/messages/bulk/BulkMessagesClient.tsx, (auth)/mileage/_components/DestinationsClient.tsx, (auth)/mileage/_components/MileageClient.tsx, (auth)/mileage/_components/MileageTripCard.tsx, (auth)/mileage/_components/MileageTripTable.tsx, (auth)/mileage/_components/TripForm.tsx, (auth)/private-bookings/[id]/PaymentHistoryTable.tsx, (auth)/private-bookings/[id]/PrivateBookingDetailClient.tsx, (auth)/private-bookings/[id]/items/page.tsx, (auth)/private-bookings/[id]/messages/PrivateBookingMessagesClient.tsx, (auth)/private-bookings/_components/PrivateBookingsClient.tsx, (auth)/private-bookings/new/page.tsx, (auth)/private-bookings/settings/page.tsx, (auth)/private-bookings/settings/spaces/page.tsx, (auth)/private-bookings/settings/vendors/page.tsx, (auth)/private-bookings/sms-queue/page.tsx, (auth)/receipts/_components/PnlClient.tsx, (auth)/receipts/_components/ReceiptBulkReviewClient.tsx, (auth)/receipts/_components/ui/ReceiptExport.tsx, (auth)/receipts/_components/ui/ReceiptMobileCard.tsx, (auth)/receipts/_components/ui/ReceiptTableRow.tsx, (auth)/receipts/bank-balance/BankBalanceClient.tsx, (auth)/receipts/vendors/_components/VendorSummaryGrid.tsx, (auth)/recruitment/_components/RecruitmentDashboardClient.tsx, (auth)/roles/components/RoleCard.tsx, (auth)/rota/AddShiftsModal.tsx, (auth)/rota/RotaFeedButton.tsx, (auth)/rota/RotaGrid.tsx, (auth)/rota/RotaPublishStatus.tsx, (auth)/rota/leave/LeaveManagerClient.tsx, (auth)/rota/page.tsx, (auth)/rota/payroll/PayrollClient.tsx, (auth)/rota/reassign/ReassignQueueClient.tsx, (auth)/rota/templates/ShiftTemplatesManager.tsx, (auth)/rota/timeclock/TimeclockManager.tsx, (auth)/settings/api-keys/ApiKeysManager.tsx, (auth)/settings/background-jobs/BackgroundJobsClient.tsx, (auth)/settings/budgets/BudgetsManager.tsx, (auth)/settings/business-hours/SpecialHoursCalendar.tsx, (auth)/settings/business-hours/SpecialHoursClientWrapper.tsx, (auth)/settings/business-hours/SpecialHoursModal.tsx, (auth)/settings/calendar-notes/CalendarNotesManager.tsx, (auth)/settings/categories/CategoriesClient.tsx, (auth)/settings/customer-labels/CustomerLabelsClient.tsx, (auth)/settings/event-categories/page.tsx, (auth)/settings/gdpr/page.tsx, (auth)/settings/message-templates/MessageTemplatesClient.tsx, (auth)/settings/pay-bands/PayBandsManager.tsx, src/app/(staff-portal)/portal/shifts/CalendarSubscribeButton.tsx, src/app/(staff-portal)/portal/shifts/ShiftDecisionControls.tsx, src/components/features/catering/CateringManager.tsx, src/components/features/catering/CateringPackageModal.tsx, src/components/features/customers/CustomerImport.tsx, src/components/features/customers/CustomerLabelDisplay.tsx, src/components/features/customers/CustomerLabelSelector.tsx, src/components/features/customers/CustomerName.tsx, src/components/features/customers/CustomerSearchInput.tsx, src/components/features/customers/WinBackCampaign.tsx, src/components/features/employees/DeleteEmployeeButton.tsx, src/components/features/employees/EmergencyContactsTab.tsx, src/components/features/employees/EmployeeAttachmentsList.tsx, src/components/features/employees/EmployeeAuditTrail.tsx, src/components/features/employees/EmployeeForm.tsx, src/components/features/employees/EmployeeHolidaysTab.tsx, src/components/features/employees/EmployeeNotesList.tsx, src/components/features/employees/EmployeePayTab.tsx, src/components/features/events/EventCategoryFormGrouped.tsx, src/components/features/events/EventMarketingLinksCard.tsx, src/components/features/events/EventPromotionContentCard.tsx, src/components/features/invoices/VendorDeleteButton.tsx, src/components/features/messages/MessageThread.tsx, src/components/features/private-bookings/VenueSpaceDeleteButton.tsx, src/components/features/shared/NetworkStatus.tsx, src/components/features/shared/SquareImageUpload.tsx, src/components/private-bookings/CalendarView.tsx, src/components/private-bookings/CommunicationsTab.tsx, src/components/private-bookings/DeleteBookingButton.tsx, src/components/private-bookings/EventDetailsRiskSection.tsx, src/components/private-bookings/WorkflowPanels.tsx, src/components/schedule-calendar/CalendarKindBadge.tsx, src/components/schedule-calendar/VenueCalendar.tsx

- **lucide-react** (40 files): (auth)/employees/new/NewEmployeeOnboardingClient.tsx, (auth)/expenses/_components/ExpenseForm.tsx, (auth)/invoices/MobileInvoiceCard.tsx, (auth)/invoices/[id]/InvoiceDetailClient.tsx, (auth)/invoices/[id]/edit/page.tsx, (auth)/invoices/[id]/payment/page.tsx, (auth)/invoices/catalog/page.tsx, (auth)/invoices/export/page.tsx, (auth)/invoices/new/page.tsx, (auth)/invoices/recurring/[id]/edit/page.tsx, (auth)/invoices/recurring/[id]/page.tsx, (auth)/invoices/recurring/new/page.tsx, (auth)/invoices/recurring/page.tsx, (auth)/invoices/vendors/page.tsx, (auth)/quotes/[id]/convert/page.tsx, (auth)/quotes/[id]/edit/page.tsx, (auth)/quotes/[id]/page.tsx, (auth)/quotes/new/page.tsx, (auth)/rota/hours/HoursByEmployeeClient.tsx, (auth)/short-links/_components/ShortLinkActionsMenu.tsx, (auth)/table-bookings/boh/BohBookingsClient.tsx, src/app/(dev)/guest-preview/page.tsx, src/app/(feedback)/feedback/thanks/page.tsx, src/app/auth/reset-password/page.tsx, src/app/g/[token]/event-payment/page.tsx, src/app/g/[token]/private-feedback/page.tsx, src/app/g/[token]/table-payment/TablePaymentClient.tsx, src/app/g/[token]/table-payment/TablePaymentSuccessPanel.tsx, src/app/g/[token]/waitlist-offer/page.tsx, src/app/parking/guest/[id]/_components/PublicParkingClient.tsx, src/app/parking/payment-error/page.tsx, src/components/features/customers/CustomerLabelSelector.tsx, src/components/features/employees/OnboardingChecklistTab.tsx, src/components/features/employees/RightToWorkTab.tsx, src/components/features/events/EventChecklistCard.tsx, src/components/features/feedback/StarRating.tsx, src/components/features/guest/GuestAlert.tsx, src/components/features/invoices/EmailInvoiceModal.tsx, src/components/modals/ChasePaymentModal.tsx, src/components/modals/EmailQuoteModal.tsx

## Appendix D: files importing react-hot-toast directly (not the DS toast)

68 files: (auth)/cashing-up/daily/_components/DailyClient.tsx, (auth)/checklists/_components/TaskRow.tsx, (auth)/checklists/manage/_components/ChecklistModal.tsx, (auth)/checklists/manage/_components/SetupClient.tsx, (auth)/checklists/manage/_components/SpotChecksClient.tsx, (auth)/checklists/manage/_components/TemplateModal.tsx, (auth)/checklists/manage/_components/TodayAdminClient.tsx, (auth)/checklists/manage/_components/TodosClient.tsx, (auth)/customers/[id]/page.tsx, (auth)/events/_components/ArtworkBrandingModal.tsx, (auth)/events/_components/EventImagePanel.tsx, (auth)/feedback-inbox/FeedbackInboxClient.tsx, (auth)/profile/change-password/page.tsx, (auth)/receipts/_components/ui/ReceiptExport.tsx, (auth)/receipts/_components/ui/ReceiptMobileCard.tsx, (auth)/receipts/_components/ui/ReceiptReclassify.tsx, (auth)/receipts/_components/ui/ReceiptRules.tsx, (auth)/receipts/_components/ui/ReceiptTableRow.tsx, (auth)/receipts/_components/ui/ReceiptUpload.tsx, (auth)/roles/components/RoleCard.tsx, (auth)/roles/components/RolePermissionsModal.tsx, (auth)/rota/AddShiftsModal.tsx, (auth)/rota/BookHolidayModal.tsx, (auth)/rota/CreateShiftModal.tsx, (auth)/rota/HolidayDetailModal.tsx, (auth)/rota/MarkSickModal.tsx, (auth)/rota/RotaFeedButton.tsx, (auth)/rota/RotaGrid.tsx, (auth)/rota/RotaPublishStatus.tsx, (auth)/rota/ShiftDetailModal.tsx, (auth)/rota/leave/LeaveManagerClient.tsx, (auth)/rota/payroll/PayrollClient.tsx, (auth)/rota/reassign/ReassignQueueClient.tsx, (auth)/rota/templates/ShiftTemplatesManager.tsx, (auth)/rota/timeclock/TimeclockManager.tsx, (auth)/settings/api-keys/ApiKeysManager.tsx, (auth)/settings/background-jobs/BackgroundJobsClient.tsx, (auth)/settings/budgets/BudgetsManager.tsx, (auth)/settings/business-hours/BusinessHoursManager.tsx, (auth)/settings/business-hours/HoursVersionStrip.tsx, (auth)/settings/business-hours/SpecialHoursCalendar.tsx, (auth)/settings/business-hours/SpecialHoursModal.tsx, (auth)/settings/business-hours/WeeklyScheduleClient.tsx, (auth)/settings/gdpr/page.tsx, (auth)/settings/message-templates/MessageTemplatesClient.tsx, (auth)/settings/pay-bands/PayBandsManager.tsx, (auth)/settings/rota/RotaSettingsManager.tsx, (auth)/settings/table-bookings/AllocationSettings.tsx, (auth)/settings/table-bookings/SeasonalPeriods.tsx, (auth)/short-links/_components/ShortLinkActionsMenu.tsx, (auth)/short-links/_components/ShortLinkFormModal.tsx, (auth)/short-links/_components/ShortLinksClient.tsx, (auth)/table-bookings/[id]/BookingDetailClient.tsx, (auth)/table-bookings/boh/BohBookingsClient.tsx, (auth)/table-bookings/foh/FohClockWidget.tsx, (auth)/users/components/UserRolesModal.tsx, src/app/(staff-portal)/portal/leave/LeaveRequestForm.tsx, src/app/(staff-portal)/portal/shifts/OpenShiftRequestButton.tsx, src/app/(staff-portal)/portal/shifts/ShiftDecisionControls.tsx, src/app/(timeclock)/timeclock/_components/TimeclockClient.tsx, src/components/features/customers/CustomerLabelSelector.tsx, src/components/features/employees/EmployeeHolidaysTab.tsx, src/components/features/employees/EmployeePayTab.tsx, src/components/features/events/EventCategoryFormGrouped.tsx, src/components/features/events/tableTalkerSheet.ts, src/components/features/messages/MessageThread.tsx, src/components/features/shared/SquareImageUpload.tsx, src/components/features/table-bookings/preorder/SeasonalPreorderSection.tsx
