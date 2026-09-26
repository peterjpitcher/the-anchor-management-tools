# UI and UX standards

The staff app takes its look from design tokens and the design-system barrel. Three places hold the truth:

- **Tokens:** the `@theme static` block in `src/app/globals.css`. Tailwind 4 turns each token into utilities (`--color-text-muted` becomes `text-text-muted`) and `@theme static` puts every token on `:root`, so `var(--color-...)` always works.
- **Components:** `@/ds` (`src/ds`: primitives, composites, shell, icons, tokens).
- **Reference page:** `/settings/design-system` shows every token, read live from the stylesheet, and the real components.

The guard `tests/guards/design-tokens.test.ts` fails the test run when a change adds a raw value (see "The guard" below).

## Page contract

Every staff page is built the same way. Consistency is the point: a page that looks slightly different from its neighbours is a bug. Rules marked **(guard)** are enforced by `tests/guards/page-contract.test.ts`.

### The one exception

The FOH manager iPad kiosk (`/table-bookings/foh` signed in as the manager kiosk login, `PageLayout headerVariant="dark"`) and the FOH chromeless shell around it (`Topbar` in FOH mode, `FohClockBand`, `FohHeader`) stay exactly as they are. Staff use that screen all day and it deliberately stops them reaching anything else. Pages the kiosk can open (`/checklists`, `/vouchers/foh`) follow this contract but keep their "Back to the floor" button, because the kiosk has no other way back.

### Page chrome

- Every page renders `PageLayout` once, as its outermost element. **(guard)** `PageHeader` has been removed from the design system.
- `title`: a page that has its own sidebar entry is titled with its sidebar label ("Invoices", "Quotes", "Rota"). Every other page in a tab row is titled with the label of the sidebar entry that owns the row ("Rota" on every Rota tab, "Private Bookings" on Calendar and SMS Queue), and its subtitle may name the tab. A detail page is titled with the record's name (the customer, the invoice number); a new or edit page with its action ("New Invoice", "Edit Role"); a page opened from a Settings tile with the tile's label. The same title while loading, on error and when loaded: build one `layoutProps` object and spread it into every state. On a detail page with tabs, every tab shows the same title.
- Capitalisation on staff screens: Title Case for page, section, card and dialog titles, tab labels, back labels and button labels ("New Invoice", "Back to Roles", "Save Changes"). Sentence case for subtitles, descriptions, help text, messages and table cells. Field labels and table headers are uppercased by the components. Guest pages follow the website's voice rules instead.
- `subtitle`: optional, one short line, sentence case, no full stop. On a tab page it names the tab or says what the page is for.
- Never pass spacing classes to `PageLayout` (`className`, `headerClassName`, `contentClassName`) and never wrap it in padding, `max-w-*`, `mx-auto` or `min-h-screen`. **(guard)** The only `<main>` is the app shell's. **(guard)**
- Width: leave `containerSize` at `full`, except a page whose content is one form with no table (a line-item editor such as the invoice and quote builders counts as a table, so those stay full) (change password, a role, a maintenance item, a campaign, a simple settings form), which uses `containerSize="md"`.

### Navigation

- A section with more than one page has one nav constant in `<section>/_shared/nav.ts` (for example `FINANCE_NAV`, `EMPLOYEES_NAV`), passed as `navItems` on every page in that tab row. Never copy the array into a page. **(guard: no `SectionNav` outside `src/ds`)**
- The active tab comes from the path (longest matching prefix). Every page in a tab row shows exactly the same tabs: filter by permission the same way on every page, and show badges on every page or on none.
- Child pages (detail, new, edit) do not show their section's tab row: they show the back button. A record with several views of its own (a private booking's Overview, Items, Messages and Communications) has its own tab row, shown on each of those views together with the back button. A sub-area with its own tab row (Private Bookings Settings) works the same way.
- `Tabs` switch panels inside one page. `Segmented` switches the view of the same data (list or calendar, 7 or 30 days). Never use a nav component with `onSelect` to switch panels.
- A page shows at most one tab row.
- Settings tiles come from `buildSettingsTileGroups` in `settings/_shared/tiles.ts`. A tile shows only when the user has the same permission its page checks, so no tile leads to the Unauthorised page; a new tile names that permission there.
- Back navigation: `backButton` on every page below its section's top level: detail pages and their tabs, new and edit pages, sub-areas with their own tab row (Private Bookings Settings), and the pages you drill into from Settings. It is labelled "Back to <Parent>" and points at the direct parent. No back button on a section's top-level pages, whether or not they have a tab row. No breadcrumbs anywhere. **(guard)**

### Header actions

- Page-level actions go in `headerActions`: `size="sm"`, secondary actions first, the primary action last. The main "New X" button is always here, never in the body.
- "Refresh", "Export" and view switchers are header actions too. Filters and search sit directly above the data they filter, in one `flex flex-wrap items-end gap-3` row.

### Body

- `PageLayout` spaces its children 24px apart (`space-y-6`). Pass blocks as direct children; do not add margins between them or wrap them in another stack.
- Panels are `Card`. A titled panel uses `CardHeader` (`title`, `subtitle`, `action`); its body is `CardBody`. Tables sit in `<Card padding="none">` or straight after a `CardHeader`. Never hand-build a panel from `bg-surface border rounded-* p-*`.
- A heading over a group of cards is `Section` (`title`, `description`, `actions`). A default `Section` adds no padding, so its cards line up with every other card. Do not pass `padding` to a default `Section`.
- Headings: page title `h1` (PageLayout), section title `h2` (Section, 16px semibold), card title `h3` (CardHeader, 14px semibold), and a sub-heading inside a card body `h4` (`SubHeading`, 14px semibold; `as="h3"` in a card with no CardHeader). No other heading styles in page code.
- Inside a card: `space-y-4` between blocks, `grid gap-4 sm:grid-cols-2` for side-by-side fields. Two-column page layouts use `gap-6`.
- Figures: `StatGrid` with `Stat` children (two across on phones, the `columns` count on wide screens; figures step down one size on phones). Never hand-build a stat tile.
- `Segmented` stays on one line and scrolls sideways on a narrow screen; keep its labels short.

### States

- Route loading: every section has a `loading.tsx` that renders `<PageLoading />`.
- A page still fetching on the client passes `loading` to `PageLayout` (header stays). A block still fetching renders `<PageLoading inline />`. No hand-made spinners, no "Loading..." text on its own.
- Nothing to show: `Empty` (`size="sm"` inside a table or card). A table's empty row is the table's `emptyMessage` or an `Empty`.
- Failure: the header stays and the page shows `Alert tone="danger"` (or `PageLayout error` with `onRetry`). A failed load is never shown as an empty list.

### Forms

- Labels come from `Field` or the `label` prop of `Input`, `Select` and `Textarea` (12px, uppercase, `tracking-wider`, muted). Never a raw `<label>` styled by hand.
- Every form ends with `FormFooter`: secondary first, primary last; right-aligned on desktop, full width with the primary on top on phones.
- Confirming a delete or another irreversible action is `ConfirmDialog`, never `confirm()`.

### Wording and small patterns

The same action has the same words and the same look on every page.

- **Create:** the header button that starts a new record is "New X" (never "Add X" or "Create X"), and what it opens is titled with the same words ("New Vendor" opens "New Vendor"). Its submit button says "Create X" for a standalone record and "Add X" for something added to the record on screen (a line item, a contact, a note). A domain verb is fine ("Log an Issue", "Book Table", "Record Collection", "Invite") as long as the page or dialog it opens uses the same words.
- **Save:** an edit form's submit button says "Save Changes"; a form split into sections names the section ("Save Opening Hours"). Never "Update X". The one exception is a form whose whole job is one action ("Change Password", "Record Payment").
- **Edit:** a detail page's edit action is "Edit", secondary. The primary slot is for the record's next step.
- **Delete:** the header action is "Delete", danger. A delete ConfirmDialog is titled "Delete <Thing>", its message says what is lost, and its confirm button says "Delete". Its dismiss button stays "Cancel".
- **Cancel a booking, campaign or voucher:** the action is "Cancel <Thing>"; the ConfirmDialog is titled "Cancel <Thing>", confirms with "Cancel <Thing>" in danger and dismisses with "Keep <Thing>" (a dismiss button labelled "Cancel" next to "Cancel Booking" is ambiguous).
- **Tones:** danger only for something that cannot be undone from the screen (delete, cancel, void, revoke, anonymise). Reversible actions (deactivate, disable, archive, mark as no-show when it can be reverted) are primary. A danger button always opens a danger confirm.
- **Dialog titles** never end in "?": the question goes in the message.
- **Retry:** "Try Again", secondary, sm, always.
- **Export and download:** "Export CSV" for data, "Download PDF" for documents; "Email <Thing>" for sending a document ("Email Invoice", "Email Quote"). No second, shorter label for phones.
- **Pending labels:** prefer the Button `loading` prop and keep the label. If the label must change, it ends with the single character "…" ("Saving…"), never three full stops.
- **Cancel on forms** is a `LinkButton` to the same place as the back button (a `Button` with `onClick` only when it must also reset state). A tab page has no Cancel. Every new and edit page has one.
- **Empty states:** the title is sentence case and short; the description is a full sentence ending in a full stop. Wording by cause: "No X yet" when nothing has been added; "No X match these filters" under a search or filter; "No X for this period" under a date window. Never "No data available".
- **Icon-only buttons** are named in sentence case (their `aria-label` is read out, not shown).
- **Subtitles on tab pages** read "<Tab>: <what this page is for>". Every tab has its own subtitle.
- **First tab** of a row names what it shows: the list's noun ("Invoices", "Campaigns", "Trips", "Bookings"), or "Overview" when it is a dashboard.
- **Status of the record** shows as a Badge in the first card (or the CardHeader action), not in the page header.
- **Filters** never sit in the header, whatever the page.
- **Destructive actions** on a detail page sit in the header actions (after the secondary actions, before the primary), not in a "danger zone" card.
- **Overflow menu:** more than three header actions collapse the extras into a secondary "More" Dropdown, labelled, with an icon.

### Dialogs

- A Modal's action buttons always go in its `footer` prop (a form in the body links its submit button with `form="<form id>"`). `FormFooter` is for forms on a page, never inside a Modal.
- A yes/no confirmation is `ConfirmDialog`. A confirmation that must submit a server-action form (so the action runs as a form post) may use a Modal whose footer mirrors ConfirmDialog exactly (same button order, labels and tones).
- A confirm-style dialog with no fields is always `ConfirmDialog`.

### Components

- Build from `@/ds` before writing markup. `@/ds` no longer re-exports `src/ds/compat`: the few legacy pieces left are imported from `@/ds/compat` by their last callers. Do not add uses.
- **Tables:** `Table` (small uppercase muted headers on `bg-surface-2`) or `DataTable` (sorting, empty row, pagination). One pager: `TablePagination`.
- **Sorting:** a sortable column is `<TableHead sortable sortDirection={...} onSort={...}>`: the label becomes a real button and the header carries `aria-sort`; `sortDirection` is `asc`, `desc` or `null` (sorted by another column) and the caller decides the next direction. A `DataTable` sorts its own rows, or takes controlled sorting for a list the server sorts and pages: `sortKey` (`null` for none), `sortDirection` and `onSortChange(key, direction)`. Never a hand-built sort header.
- **Buttons and links:** `Button`, `LinkButton`, `IconButton`. The primary colour is the Orange Jelly orange (`bg-primary`), used for buttons, the active tab, sub-navigation and links. `LinkButton download` downloads instead of navigating (`true` keeps the server's file name, a string sets it).
- **Files:** `FileButton` is a DS `Button` over a hidden file input, for a picker that is not a drop zone (`onFiles`, `accept`, `multiple`, `capture`, `loading`, `name`, `inputRef`). An icon-only `FileButton` takes `aria-label` and `title` (the hover hint), as an `IconButton` does. A drop zone is `FileUpload`. Never a hand-styled `<input type="file">` or a `<label>` dressed as a button.
- **Fields:** `Input` takes `warning` for a soft problem that does not block saving (amber, with the message under the field, announced politely as a status); `error` wins when both are set and is announced as an alert, in `text-danger-fg` in `Input`, `Select`, `Textarea` and `Field` alike. A group of radios, checkboxes or buttons that answers one question sits in `Fieldset` (`legend`, `hint`, `error`, `required`), whose legend looks exactly like a `Field` label.
- **Checkboxes:** a `Checkbox` with a visible `label` grows its row to the 44px touch target on touch screens. One named only by `aria-label` (a row selector, a "mark done" tick) takes `touchTarget`, which grows its tap area to 44px on touch screens without moving anything. That area reaches 14px past the box and sits above its neighbours, so leave `gap-3.5` before a link or button beside it. Never wrap a checkbox in a hand-made `<label>` to make it easier to tap.
- **Figures:** `Stat` takes `tone` (`success`, `warning`, `danger`) when the figure itself is good or bad news, and `deltaGood="down"` when a fall is the good direction (costs, no-shows, wastage). The delta shows as an unsigned percentage; `deltaLabel` replaces that text when the change is not a percentage, such as an absolute change when the previous figure was zero ("+2") or a change in percentage points ("+5 pts"), keeping the direction colour, the arrow and the words a screen reader hears.
- **Menus and overlays:** `Dropdown`, `Popover`, `Modal`, `Drawer`, `ConfirmDialog`. Never a hand-built `fixed inset-0` overlay. `Dropdown` and `Popover` panels are portalled to the end of the page and anchored to their trigger, so a scrolling table or an `overflow-hidden` card cannot clip them: never raise a `z-index` or drop `overflow-hidden` to make a menu show. A `Dropdown` takes `width`: `sm` (the default, 12rem), `md` (16rem), `lg` (20rem) or `auto` (fits the longest item, 12rem to 20rem): pick the width that keeps every item on one line. `DropdownLabel` heads a group of items; `DropdownItem closeOnSelect={false}` keeps the menu open for an item that changes the menu itself, such as a toggle.
- **Charts:** one approach, the DS chart composites in `src/ds/composites/Chart.tsx` (`BarChart`, `LineChart`, `ComboChart`, plus the compact `RevenueChart` and `Sparkline`). Series take the chart tokens in order (`CHART_COLOURS`, `chartColour(i)`), numbers print through `formatChartValue` (`number`, `currency`, `shorthandCurrency`, `percent`) and tooltips use `ChartTooltipFrame`. Never import `recharts` or draw an SVG chart in page code.
- **Status:** `Badge` and `Alert` with a `tone`. Each status has one map, used everywhere it shows:
  - table bookings: `TABLE_BOOKING_STATUS_TONE` in `src/lib/table-bookings/ui.ts` (booked primary, seated success, pending payment warning, no-show danger; cancelled, left and completed neutral), with `getTableBookingVisualState` (the state a booking shows), `getTableBookingStatusLabel`, `getTableBookingStatusBadgeClasses`, `getTableBookingStatusBlockClasses`, and for the deposit `getTableBookingDepositState` and `getTableBookingDepositBadgeClasses`
  - vouchers: `VOUCHER_STATUS_TONES` and `VOUCHER_STATUS_LABELS` in `src/app/(authenticated)/vouchers/_shared/voucher-ui.tsx` (issued info, redeemed success)
  - private bookings: `privateBookingStatusTone` (`privateBookingStatusLabel`) and `privateBookingPaymentTone` in `src/app/(authenticated)/private-bookings/_shared/status-ui.ts` (confirmed primary, draft warning because it is a hold waiting for its deposit, completed and cancelled neutral; overdue money is the only red)
  - events and event bookings: `eventStatusTone` (`eventStatusLabel`) and `eventBookingStatusTone` in `src/app/(authenticated)/events/_shared/status-ui.ts` (bookings follow the table booking colours)
  - invoices and quotes: `invoiceStatusTone` (`invoiceStatusLabel`) and `quoteStatusTone` (`quoteStatusLabel`) in `src/lib/invoices/status-ui.ts`, which the invoice and quote PDFs use too
  - rota shifts, holidays, departments, day notes and the hours report: `ROTA_SHIFT_STATUS_CLASSES` (`rotaShiftStatusClasses`), `ROTA_HOLIDAY_CLASSES`, `rotaDepartmentClasses` over `ROTA_DEPARTMENT_CLASSES` and `ROTA_DEPARTMENT_FALLBACK_CLASSES` (one department to category map, `ROTA_DEPARTMENT_CATEGORIES` and `rotaDepartmentCategory`, also used by the printed rota), `ROTA_DAY_INFO_CLASSES` and `ROTA_CALENDAR_NOTE_CLASSES` (day notes), and `ROTA_HOURS_SERIES_COLOURS`, `ROTA_CHART_COLOURS` and `ROTA_CHART_PRINT_COLOURS` (the hours report on screen and on paper) in `src/lib/rota/status-ui.ts`. A shift's own colour comes from `resolveShiftColour` in `src/lib/rota/shift-template-colours.ts`, on screen and on paper.
  - holiday (leave) requests, on every screen that lists one (the rota dialog, `/rota/leave`, the employee Holidays tab, the staff portal): `ROTA_LEAVE_STATUS_TONE` and `ROTA_LEAVE_STATUS_LABEL` (`rotaLeaveStatusTone`, `rotaLeaveStatusLabel`) in `src/lib/rota/status-ui.ts` (pending warning, worded "Pending approval"; approved success; declined danger). A status filter over these requests uses the same words.
  - text and email delivery, wherever a send is listed (event marketing texts, a private booking's Communications tab, marketing recipients, the inbox): `MESSAGE_DELIVERY_STATUS_TONE` and `MESSAGE_DELIVERY_STATUS_LABEL` (`messageDeliveryStatusTone`, `messageDeliveryStatusLabel`) in `src/lib/messages/status-ui.ts` (on its way info; sent, delivered, opened or read success; delayed or needs review warning; failed, undelivered, bounced, complained or suppressed danger; cancelled, skipped or received neutral)
  - Any other status gets a named map in its domain's `status-ui` file and is listed below. Never pick a tone inline at the call site.

  Every other named status map, by file (`tests/guards/status-map-docs.test.ts` checks that every name here exists in its file and that no exported status map is missing):

  | Area | File | Maps |
  |---|---|---|
  | Cashing up | `cashing-up/_shared/status-ui.ts` | `CASHUP_SESSION_STATUS_TONE` (`cashupSessionStatusTone`), `targetPerformanceTone`, `targetPerformanceRowClass`, `CASH_VARIANCE_UI` with `cashVarianceKind`, `cashVarianceTextClass`, `cashVarianceTone` and `cashVarianceAlertTone` (a till count against the Z-read on every screen: short danger, over warning, balanced neutral), `signedAmountTextClass` and `signedAmountTone` (takings against target, where more is better), `cashupImportResultTone`, `weeklyProgressTone` |
  | Checklists | `checklists/_shared/status-ui.ts` | `CHECKLIST_CLOSED_TASK_STATUS`, `CHECKLIST_GENERATION_STATUS`, `CHECKLIST_TODO_STATUS`, `CHECKLIST_SPOT_CHECK_STATUS`, `CHECKLIST_PRESENCE_STATUS`, `CHECKLIST_BAND_TONE` (`checklistBandTone`), `CHECKLIST_REVIEW_CELL_CLASSES` |
  | Customers | `customers/_shared/status-ui.ts` | `CONTACT_CHANNEL_TONE`, `STRATEGIC_SIGNAL_TONE`, `CUSTOMER_IMPORT_ROW_TONE`, `CUSTOMER_IMPORT_ROW_LABEL`, `CUSTOMER_IMPORT_ROW_TINT` |
  | Dashboard | `dashboard/_shared/status-ui.ts` | `EVENT_FILL_BADGE` (`eventFillStatus`), `ACTION_ITEM_SEVERITY_CLASSES`, `revenueChangeTone`, `attentionCountTone` |
  | Employees | `employees/_shared/status-ui.ts` | `employmentStatusTone`, `holidayAllowanceTone`, `HOLIDAY_ALLOWANCE_TEXT_CLASSES`, `contactPriorityTone`, `RATE_OVERRIDE_TONES`, `birthdayCountdownTone`, `reliabilityScoreTone`, `RELIABILITY_LOW_SAMPLE_TONE`, `reliabilityEventTone`, `SEPARATION_SHIFT_DECISION_TONES`, `auditEntryIconClasses` (holiday requests use the leave map above) |
  | Events | `events/_shared/status-ui.ts` | also `eventTodoUrgencyTone`, `eventTodoUrgencyBorderClass`, `eventChecklistStatusTextClass`, `eventSeatingTypeTone`, `eventLinkTypeTone`, `eventTicketTypeSaleTone`, `eventCapacityFillClass`, `eventPreflightIssueTextClass`, `seoHealthBand`, `seoHealthStyles` (marketing texts use the delivery map above) |
  | Feedback inbox | `feedback-inbox/_shared/status-ui.ts` | `FEEDBACK_STATUS_TONE`, `FEEDBACK_STATUS_LABEL` |
  | Insights | `insights/_shared/status-ui.ts` | `INSIGHT_STATUS_WORD`, `INSIGHT_STATUS_EMOJI`, `INSIGHT_STATUS_TEXT` |
  | Invoices | `invoices/_shared/status-ui.ts` | `RECURRING_SCHEDULE_TONE` (`recurringScheduleTone`, `recurringScheduleLabel`), `VENDOR_CONTACT_FLAG_TONE` |
  | Refunds (parking, private and table bookings) | `src/components/features/invoices/RefundHistoryTable.tsx` | `REFUND_STATUS_TONE` |
  | Maintenance | `maintenance/_shared/status-ui.ts` | `MAINTENANCE_STATUS_TONES`, `MAINTENANCE_PRIORITY_TONES`, `MAINTENANCE_RESPONSIBILITY_TONES`, `MAINTENANCE_KIND_TONES`, `MAINTENANCE_OVERDUE_TONE`, `maintenanceOverdueCountTone`, `MAINTENANCE_PHOTO_EVENT_TONES` (words: `MAINTENANCE_STATUS_LABELS`, `MAINTENANCE_PRIORITY_LABELS`, `MAINTENANCE_RESPONSIBILITY_LABELS` and `MAINTENANCE_KIND_LABELS` in `src/types/maintenance.ts`) |
  | Marketing email | `marketing/_shared/marketing-ui.tsx` | `CAMPAIGN_STATUS_LABELS` (`CampaignStatusBadge`), `RecipientStatusBadge` (the delivery map above), `SendSwitchBadge`, `ProviderReadyBadge`, `EngagedBadge`, `ELIGIBILITY_LABELS` (`EligibilityBadge`), `MARKETING_STATUS_LABELS` (`MarketingStatusBadge`), `SKIP_REASON_LABELS` (`skipReasonLabel`), `SUBSCRIBER_SUGGESTION_TONES`, `CONTACT_IMPORT_FLAG_TONES`, `SUBSCRIBER_TYPE_LABELS`, `MARKETING_BASIS_LABELS` |
  | Menu management | `menu-management/_shared/status-ui.ts` | `menuActiveTone` (`menuActiveLabel`), `menuAssignmentTone`, `purchaseDepartmentTone` (words: `MENU_PURCHASE_DEPARTMENT_LABELS` in `src/lib/menu/purchase-departments.ts`), `menuGpTone`, `GP_TARGET_UI` (`gpTargetState`), `DISH_COSTING_STATUS_UI`, `dishCostingCountTone`, `allergenRemovableRowClass`, `MENU_ALLERGEN_TONE`, `MENU_DIETARY_TONE`, `ALLERGEN_VERIFICATION_UI`, `inclusionTypeBorder`, `inclusionTypeTone`, `UPGRADE_TEXT`, `optionGroupStyle` |
  | Messages | `messages/_shared/status-ui.ts` | `REPLY_BLOCK_TONE`, `SMS_CONSENT_TONE` (words: `SMS_CONSENT_LABEL` in `src/lib/messages/replyEligibility.ts`), `WHATSAPP_OPT_IN_TONE`, `MESSAGE_CHANNEL_BADGE_TONE`, `MESSAGE_ATTACHMENT_BADGE_TONE` |
  | MGD | `mgd/_shared/status-ui.ts` | `MGD_RETURN_STATUS_TONE` (`mgdReturnStatusLabel`) |
  | Mileage | `mileage/_shared/status-ui.ts` | `MILEAGE_TRIP_SOURCE_TONE`, `MILEAGE_TRIP_SOURCE_LABEL` |
  | OJ Projects | `oj-projects/_shared/status-ui.ts` | `OJ_PROJECT_STATUS` (`ojProjectStatus`), `OJ_ENTRY_STATUS` (`ojEntryStatus`), `OJ_ENTRY_TYPE` (`ojEntryType`), `OJ_BILLABLE` (`ojBillable`), `OJ_ACTIVE` (`ojActive`), `OJ_MONEY_TEXT` (`ojBalanceText`), `ojBalanceTone`, `ojReceivedTone`, `ojBudgetTone` |
  | Parking | `parking/_shared/status-ui.ts` | `PARKING_BOOKING_STATUS_TONE`, `PARKING_BOOKING_STATUS_LABEL`, `PARKING_PAYMENT_STATUS_TONE`, `PARKING_PAYMENT_STATUS_LABEL` |
  | Private bookings | `private-bookings/_shared/status-ui.ts` | also `privateBookingPaymentTextClass`, `privateBookingStatusBlockClasses`, `settingsActiveTone` (`settingsActiveLabel`), `PREFERRED_VENDOR_TONE`, `smsQueueTone`, `growthRecordSourceTone`, `SENT_MESSAGE_TRIGGER_TONE`, `WAIVER_STATUS_TONE`, `RISK_STATUS_TONE`, `SUPPLIER_STATUS_TONE`, `SUPPLIER_ROW_STATUS_TONE`, `FINAL_DETAILS_STATUS_TONE`, `POST_EVENT_STATUS_TONE`, `DEDUCTION_STATUS_TONE`, `COMPLAINT_STATUS_TONE`, `RECORD_LOCKED_TONE`, `CANCELLATION_OUTCOME_TONE`, `SCHEDULED_REMINDER_TONE` |
  | Receipts and P&L | `receipts/_shared/status-ui.ts` | `RECEIPT_STATUS_TONE`, `RECEIPT_STATUS_LABEL`, `RECEIPT_FLOW_TONE`, `RECEIPT_FLOW_TEXT_CLASS`, `RECEIPT_FLOW_CHART_COLOUR`, `netAmountTone`, `netAmountTextClass`, `automationCoverageTone` (`automationCoverageDeltaLabel`, its change in percentage points), `RECEIPT_INSIGHT_TONE`, `RECEIPT_INSIGHT_LABEL`, `RECEIPT_SOURCE_TONE`, `RECEIPT_SOURCE_LABEL`, `RECEIPT_CLASSIFICATION_SOURCE_TONE`, `RECEIPT_CLASSIFICATION_SOURCE_LABEL`, `RECEIPT_RULE_STATE_TONE`, `RECEIPT_SUGGESTION_SOURCE_TONE`, `RECEIPT_SUGGESTION_SOURCE_LABEL`, `vendorSignalTone`, `spendMovementTone`, `spendMovementTextClass`, `spendMovementBarColour`, `PNL_HEALTH_TONE`, `pnlVarianceTone` |
  | Recruitment | `recruitment/_shared/status-ui.ts` | `RECRUITMENT_SCORE_TONE`, `RECRUITMENT_SCORE_LABEL`, `RECRUITMENT_SCORE_ROW_CLASS` (`recruitmentScoreBand`), `recruitmentCvStatusTone`, `recruitmentRightToWorkTone`, `RECRUITMENT_STAGE_TONE`, `RECRUITMENT_APPOINTMENT_STATUS_TONE`, `RECRUITMENT_FLAG_TONE`, `RECRUITMENT_TEMPLATE_TONE` |
  | Roles | `roles/_shared/status-ui.ts` | `ROLE_NAME_BADGE_TONE`, `ROLE_SYSTEM_FLAG_TONE`, `ROLE_NONE_TONE` |
  | Rota screens | `rota/_shared/status-ui.ts` | `ROTA_STAT_TONE`, `ROTA_WEEK_PUBLISH_TONE`, `ROTA_WEEK_PUBLISH_LABEL`, `ROTA_WEEK_PUBLISH_ICON`, `ROTA_OPEN_SHIFTS_TONE`, `LABOUR_SHARE_TONE`, `LABOUR_SHARE_LABEL`, `LABOUR_SHARE_TEXT_CLASSES`, `LABOUR_SHARE_CELL_CLASSES`, `ROTA_WAGES_COSTING_TONE`, `ROTA_HOURS_LIMIT_TEXT_CLASSES`, `ROTA_CAPACITY_TEXT_CLASSES`, `ROTA_CAPACITY_BAR_TONE` (`rotaCapacityState`), `OPEN_SHIFT_REQUEST_STATUS_TONE`, `ADD_SHIFTS_ITEM_TONE`, `ADD_SHIFTS_ASSIGNEE_TONE`, `budgetUsageTone`, `BUDGET_HOURS_TEXT_CLASSES`, `LEAVE_ALLOWANCE_TONE`, `LEAVE_ALLOWANCE_TEXT_CLASSES`, `PAYROLL_APPROVAL_TONE`, `PAYROLL_VARIANCE_TONE` (`payrollVarianceState`), `payrollDiffClasses`, `PAYROLL_EARNED_TONE`, `PAYROLL_PAY_RATE_TONE`, `PAYROLL_DAY_FLAGGED_TONE`, `payrollFlagBadgeClasses`, `TIMECLOCK_FLAG_TONE`, `TIMECLOCK_REVIEWED_ROW_CLASSES`, `REASSIGN_ORIGIN_TONE`, `REASSIGN_ORIGIN_LABEL`, `REASSIGN_OUTCOME_TONE`, `SHIFT_TEMPLATE_BADGE_TONE` |
  | Settings | `settings/_shared/status-ui.ts` | `auditLogStatusTone`, `backgroundJobStatusTone`, `activeStateTone`, `SPECIAL_HOURS_DAY_CLASSES`, `SPECIAL_HOURS_TEXT_CLASSES`, `SPECIAL_HOURS_BADGE`, `DEFAULT_TEMPLATE_TONE`, `PAY_RATE_STATUS_BADGE`, `SMS_FAILURE_TONES` (`smsFailureBadge`), `SEASONAL_PERIOD_STATUS_BADGE` |
  | Short links | `short-links/_shared/status-ui.ts` | `SHORT_LINK_KIND_TONE`, `LEGACY_REPORTER_TONE` |
  | Table bookings | `table-bookings/_shared/status-ui.ts` | `TABLE_BOOKING_REFUND_PROGRESS_TONE`; the booking status and deposit are the table booking map above |
  | Seasonal pre-orders | `src/components/features/table-bookings/preorder/status-ui.ts` | `PREORDER_COMPLETENESS_TONE` |
  | Venue calendar | `src/components/schedule-calendar/status-ui.ts` | `CALENDAR_CLOSURE_CELL_CLASSES`, `CALENDAR_CLOSURE_BADGE` |
  | Vouchers | `vouchers/_shared/voucher-ui.tsx` | also `VoucherStatusBadge`, `VOUCHER_EVENT_ACTION_LABELS`, `REMINDER_KIND_LABELS`, `REMINDER_CHANNEL_LABELS`, `REMINDER_STATUS_TONES`, `REMINDER_STATUS_LABELS`, `voucherExpiringSoonTone` (the FOH kiosk reads the same maps through `statusTone` and `statusLabel` in `vouchers/foh/components/voucher-status.ts`) |
  | Staff portal | `src/app/(staff-portal)/portal/_shared/status-ui.ts` | `OPEN_SHIFT_REQUESTED_TONE`, `SHIFT_CONFIRM_PANEL_CLASSES`, `shiftPremiumTone` (holiday requests use the leave map above) |
  | Onboarding | `src/app/(employee-onboarding)/onboarding/_shared/status-ui.ts` | `ONBOARDING_SECTION_TONE`, `ONBOARDING_SECTION_LABEL`, `ONBOARDING_SECTION_ICON`, `TIME_OFF_ROW_BORDER_CLASSES` |
  | Timeclock kiosk | `src/app/(timeclock)/timeclock/_components/status-ui.ts` | `KIOSK_TILE_CLASSES`, `KIOSK_DOT_CLASSES` |
  | Guest pages | `src/components/features/guest/status-ui.ts` | `GUEST_BANNER_TONE`, `GUEST_BADGE_TONE_FOR`, `guestBadgeToneForStatus`, `GUEST_ALERT_TONE_CLASS`, `GUEST_ALERT_BODY_CLASS`, `GUEST_TONE_ICON`, `GUEST_BADGE_TONE_CLASS`, `GUEST_MARK_TONE_CLASS`, `GUEST_MARK_ICON` (guest tokens only) |

  Paths without `src/` are under `src/app/(authenticated)/`. Emails and PDFs take the same meanings as palette values (`statusBadgeStyle` in `src/lib/pdf/document-chrome.ts`).
- **Toasts:** `toast` from `@/ds` for transient confirmations (`success`, `error`, `warning`, `info`). A lasting result of a form sits in an inline `Alert`. One `Toaster`, in the root layout.
- **Icons:** the DS `Icon` only. Add a missing glyph to `src/ds/icons/paths.tsx` rather than importing another icon set.
- **Forms:** DS fields with Zod validation in the server action. There is no form library.
- **Width checks in JavaScript:** `SHELL_MEDIA_QUERY` from `@/ds`, never a hard-coded 768px or 640px.

### Page template

```tsx
// src/app/(authenticated)/invoices/_shared/nav.ts
import type { HeaderNavItem } from '@/ds'
export const FINANCE_NAV: HeaderNavItem[] = [
  { label: 'Invoices', href: '/invoices' },
  { label: 'Quotes', href: '/quotes' },
]

// a list page
<PageLayout
  title="Invoices"
  subtitle="Money owed to Orange Jelly"
  navItems={FINANCE_NAV}
  headerActions={<LinkButton href="/invoices/new" size="sm">New Invoice</LinkButton>}
>
  <StatGrid columns={3}>...</StatGrid>
  <Card padding="none">
    <DataTable ... emptyMessage="No invoices yet" />
  </Card>
</PageLayout>

// a form page
<PageLayout title="New Role" backButton={{ label: 'Back to Roles', href: '/roles' }} containerSize="md">
  <Card>
    <CardHeader title="Role Details" />
    <CardBody className="space-y-4">
      <Input label="Name" ... />
    </CardBody>
  </Card>
  <FormFooter>
    <LinkButton href="/roles" variant="secondary">Cancel</LinkButton>
    <Button type="submit">Create Role</Button>
  </FormFooter>
</PageLayout>
```

## Tokens

| Need | Use |
|---|---|
| Page background | `bg-bg` |
| Card or panel | `bg-surface border border-border rounded-lg shadow-sm` (or DS `Card`) |
| Sunk panel, table header | `bg-surface-2` |
| Hover | `hover:bg-surface-hover` |
| Headings | `text-text-strong` |
| Body text | `text-text` |
| Secondary text, labels | `text-text-muted` |
| Hints | `text-text-soft` |
| Placeholders and icons (never text) | `text-text-subtle` |
| Primary action, link | `bg-primary text-primary-fg`, `text-primary` |
| Soft highlight | `bg-primary-soft text-primary-soft-fg`, edged with `border-primary-border` |
| Status message | `bg-success-soft text-success-fg border-success-border` (also `warning`, `danger`, `info`) |
| Status icon, dot or fill | `text-success`, `bg-success` (and the other three) |
| Fixed app categories (departments, dish groups, booking types) | `cat-1` to `cat-8`, each with `-soft` and `-fg` |
| Charts | `var(--color-chart-1)` to `var(--color-chart-6)`, or `fill-chart-1` |
| Avatars | `bg-avatar-1` to `bg-avatar-6` with white text |
| Text on dark surfaces | `text-on-dark`, `text-on-dark-muted`, `hover:bg-on-dark-hover`, `border-on-dark-border` |
| Dialog backdrop | `bg-overlay` |

- **Type:** `text-2xs` (10px, the minimum), `text-meta` (11px), `text-xs` (12px), `text-ui` (13px, table cells and dense controls), `text-sm` (14px, body), `text-base` and up.
- **Radius:** `rounded-sm` 6px, `rounded-default` 8px (buttons, fields), `rounded-md` 10px (not the Tailwind 6px), `rounded-lg` 14px (cards, dialogs), `rounded-xl` 20px, `rounded-pill`. `rounded-full` is for circles.
- **Shadows:** `shadow-xs` (buttons), `shadow-sm` (cards, tables), `shadow-default` (raised panels), `shadow-lg` (dialogs, drawers, menus, toasts), `shadow-ring` and `shadow-ring-inset` (focus).
- **Sizes:** `min-h-touch` (44px), `h-input-h`, `h-btn-h`, `h-btn-h-sm`, `h-btn-h-lg`, `py-cell-y`, `p-pad-card`.
- **Breakpoint:** `shell:` and `max-shell:` switch at 821px, where the app shell changes between phone and desktop.
- `cn()` in `src/lib/utils.ts` knows the custom token names, so `cn('text-ui', 'text-text-muted')` and `cn('text-guest-h1', 'text-anchor-gold')` keep both. A new token must be registered there too: `tests/lib/cn.test.ts` reads the `@theme` block and fails on any text, spacing, radius, shadow, leading, tracking, container or ease token `cn()` does not know.

## Global phone overrides

`src/app/globals.css` applies these to every page, whatever the component asks for. Check here before chasing a size that will not change on a phone.

Under 821px (the `max-shell:` range, `@media (max-width: 820px)`):

- The size tokens grow for thumbs: `h-input-h` 44px, `h-btn-h` 42px, `h-btn-h-sm` 34px, `h-btn-h-lg` 48px.
- Every `input`, `select` and `textarea` is 16px (`!important`), because anything smaller makes iOS Safari zoom the page on focus.
- Every `button` (except sidebar buttons, switches and `GuestButton`), `[role="button"]`, `select` and `.touch-target` is at least 44px by 44px.
- Every `table` is at least 560px wide and scrolls inside its nearest `overflow-x-auto` wrapper.
- A `[role="tablist"]` never wraps: it scrolls sideways with the scrollbar hidden.
- `html` and `body` never scroll sideways; `main > div` and `.sm:flex-row` rows get `min-width: 0` so they can shrink.
- The sidebar is hidden: the phone chrome takes over.

Under 641px:

- Every `[role="tab"]` gets 8px by 12px padding, a 44px minimum height and no wrapping.
- `.truncate` also gets `max-width: 100%`, and `html`, `body` and `main` hide sideways overflow.

On touch screens of any width (`pointer: coarse`), only inside an element marked `data-touch-targets` (FOH, BOH, messages, table booking detail, the voucher FOH and handout screens, DS `Modal` and `Drawer`): buttons, inputs, selects, options and text areas get a 44px minimum.

## Rules

1. **Contrast.** Text on white needs at least 4.5:1: `text-text`, `text-text-muted`, `text-text-soft` or a status `-fg` colour. Base status colours are for icons, dots, fills and borders.
2. **Minimum size.** Nothing below `text-2xs` (10px) on a staff screen.
3. **Focus.** Controls: `focus-visible:outline-hidden focus-visible:shadow-ring`. Inside a container that clips (accordions, tab strips, table headers): `focus-visible:shadow-ring-inset`. Text fields: `focus:border-border-focus focus:shadow-ring`; in the error state `focus:border-danger` with the red halo the DS `Input` already applies. `outline-hidden` keeps focus visible in Windows high-contrast mode. Native radios keep the browser outline.
4. **Disabled.** `disabled:opacity-50`.
5. **Light theme only.** No dark-mode variants (dropped on 18 September 2026).
6. **Touch.** The FOH, BOH, timeclock and voucher screens are used on an iPad: targets at least 44px (`min-h-touch`) and text at least 10px. DS `Modal` and `Drawer` panels apply the 44px floor on touch screens.
7. **Guest pages.** Pages inside `GuestShell` (the `.guest-theme` class) use only the `anchor-*` and `guest-*` tokens and the `Guest*` components. Staff screens never use them.
8. **Emails and PDFs.** Mail clients and PDF renderers cannot read CSS variables, so their colours come from `src/lib/brand/palette.ts`, which a test pins to the tokens:
   - `STAFF` for Orange Jelly and staff documents: invoices, receipts, quotes, statements, contracts, staff emails, rota and hours PDFs.
   - `GUEST` for anything a guest receives about The Anchor: booking, event, table and voucher emails and the voucher card. The primary button is `GUEST.buttonBg` with `GUEST.buttonText`, as on the guest pages.
   - Black-ink print sheets (the table and event booking sheets) use the `STAFF` greys, which stay darker on paper.
   - `CHART_SERIES` and `CATEGORY` carry the chart and category colours for generated documents, such as the printed rota.
9. **Colours staff choose stay data.** Shift template colours, calendar note colours, customer labels and event categories are saved values, not tokens.
10. **Never build class names at runtime** (`bg-${tone}-soft` is never generated). Map each value to a whole class string, as the status maps do.

## Not allowed

The guard counts these in `src/`:

| Rule | What it catches | Use instead |
|---|---|---|
| `raw-palette` | Tailwind colours such as `bg-gray-100`, `text-blue-600`, `border-emerald-200`, and `white` or `black` (`bg-white`, `text-white`, `border-black/10`) outside emails and PDFs | the token for the meaning (`bg-surface`, `text-primary-fg`, `text-on-dark`, `bg-overlay`) |
| `hex-colour` | `#rrggbb` anywhere outside `globals.css`, `src/lib/brand/palette.ts` and a short list of saved-colour files | a token, or the palette for emails and PDFs |
| `px-text-size` | `text-[13px]`, `text-[22px]` and every other pixel size | the type scale above; the `text-guest-*` sizes on guest pages |
| `bare-rounded` | `rounded` on its own (4px) | `rounded-sm` or larger |
| `off-scale-radius` | `rounded-2xl`, `rounded-3xl` | `rounded-xl` or `rounded-lg` |
| `off-scale-shadow` | `shadow` on its own, `shadow-md`, `shadow-xl`, `shadow-2xl` | the shadow scale above |
| `dark-variant` | `dark:` classes | nothing: light theme only |
| `legacy-hsl-var` | `hsl(var(--...))` from the old shadcn setup | token utilities |
| `raw-820-breakpoint` | hand-written 820px breakpoints | `shell:` or `max-shell:` |
| `sidebar-outside-shell` | sidebar tokens outside `src/ds/shell` | `Button variant="primary"` or the `on-dark` tokens |
| `legacy-focus-ring` | `focus:ring-*`, `focus-visible:ring-*`, `ring-offset-*`, `outline-none` | Rule 3: `focus-visible:outline-hidden focus-visible:shadow-ring` |
| `guest-token-outside-guest` | `anchor-*` and `guest-*` classes outside `GuestShell`, `src/components/features/guest`, the public route folders and `StarRating`'s guest tone | the staff tokens (Rule 7) |
| `brand-ramp-outside-shell` | `bg-brand-700`, `text-brand-50` and the rest of the brand ramp outside `src/ds/shell`, `src/components/shells` and `PageLayout`'s dark kiosk header | `primary`, `primary-soft`, `primary-soft-fg` or the `on-dark` tokens |
| `status-opacity` | `bg-warning/10`, `border-primary/20` and other status colours at an opacity | the `-soft` fill and `-border` edge tokens |
| `rounded-md` | `rounded-md` (10px here) on staff screens outside `src/ds` | `rounded-lg` (cards, panels), `rounded-default` (buttons, fields, clickable rows) or `rounded-sm` (chips) |

## The guard

`tests/guards/design-tokens.test.ts` counts each rule in each file and compares the counts with `tests/guards/design-tokens.baseline.json`.

- **"adds no new raw values"** fails when any count rises. Fix the code; never raise the baseline to get a change through.
- **"has a baseline no looser than the code"** fails when a count fell and the baseline still holds the old number. Lower it with `UPDATE_DESIGN_TOKEN_BASELINE=1 npx vitest run tests/guards/design-tokens.test.ts` and commit the baseline with the change. The update refuses to raise any number.
- **"records every rule at its current version"** fails when a rule was added or widened and the baseline has not recorded it yet. Adding a rule, or widening what one catches, means a new rule id or a higher `version` on the rule; the same update command then records the current counts for that rule only. Every other rule still only goes down, so a widened rule is never a way to raise the rest.
- Comments are ignored. Bare `rounded` and `shadow` count only inside strings that read as class lists, so prose is safe.
