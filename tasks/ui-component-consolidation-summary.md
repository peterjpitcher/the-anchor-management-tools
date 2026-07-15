# UI component consolidation decisions

Date: 15 July 2026

## Result

The baseline audit found 690 production component declarations. The first two implementation batches removed or absorbed 22 obsolete and compatibility declarations while adding three canonical shared components, so the live index now contains 671. Every current declaration has an explicit decision in `tasks/ui-component-consolidation-register.csv`.

The original index reported 681. The detailed pass found that its pattern matcher missed some `forwardRef` components, including `Button`, `Input` and `FormGroup`. The inventory now uses the TypeScript syntax tree and the corrected total is 690.

| Decision | Components | Meaning |
|---|---:|---|
| Keep | 605 | The component has a real route, business or design-system job. Its internal controls must still use the canonical DS. |
| Merge | 50 | Its job belongs in another named component. |
| Retire | 16 | It is deprecated, unused or stale. |

These components are not hundreds of public UI choices:

| Future scope | Components |
|---|---:|
| Next.js route boundaries | 191 |
| Page-local business components | 251 |
| Shared business components | 83 |
| Private business helpers | 14 |
| Infrastructure provider | 1 |
| Public DS component functions | 55 |
| Private DS helpers | 12 |

The 55 public DS functions form fewer component families because `Card` and `Table` expose named sub-parts. The practical target remains about 50 public component families, not hundreds of competing controls.

## Approved consolidation targets

### Remove stale and unused implementations

- Retire the test-only old `InvoicesClient` and `UserList` after their tests point at the live components.
- Delete `SpinnerTemp` and its three unused components.
- Delete the unused internal `Toast` renderer; keep the exported `toast` API.

### Remove the compatibility layer

Sixteen of the 32 compatibility implementations have now been removed or absorbed into the canonical component. The remaining replacements are recorded per row in the register. The important mappings are:

- `FormGroup` to `Field`;
- `EmptyState` to `Empty`;
- `ConfirmModal` to `ConfirmDialog`;
- `Toggle` to `Switch`;
- `TabNav` to `Tabs` or `SectionNav`;
- `SortableHeader` to `DataTable` sorting;
- `TablePagination` to `Pagination`;
- modal and drawer action wrappers to the overlay footer.

### Merge repeated shared patterns

- Eight local `SubmitButton` implementations and three specially named submit buttons become one `FormSubmitButton` pattern.
- Vendor, venue-space, contact and attachment delete controls share one confirmed server-action pattern.
- Add and edit emergency-contact modals become one `EmergencyContactModal`.
- Both private-booking add/edit item implementations become one `PrivateBookingItemModal`.
- Parking and invoice refund UI use one shared `RefundDialog` and `RefundHistoryTable`.
- Feedback uses one `StarRating`, with interactive and read-only modes.
- Repeated `DetailItem` helpers become one `DescriptionList` pattern.
- Repeated `StatusBadge` helpers become `Badge` with domain status maps.
- Local SVG helpers and direct icon-library choices move to the DS `Icon` registry.
- The shared `BarChart` moves into the DS chart family.

### Narrow the design-system API

- `PageLayout` is the public page shell; `PageHeader` becomes internal.
- `SectionNav` owns route navigation and `Tabs` owns in-page state.
- `Pagination` is the only pagination component.
- `CustomerLink` remains shared customer behaviour but moves out of the generic DS.
- Shell pieces remain private to `AppShell`.

## Implementation order

1. Add the missing canonical patterns: `RowActions`, `FormSubmitButton`, confirmed server action, `DescriptionList` and responsive filter toolbar.
2. Remove stale files and update their tests.
3. Migrate compatibility imports, then remove the compatibility barrel export.
4. Merge the confirmed domain duplicates.
5. Migrate raw controls section by section, starting with recruitment, rota, table bookings, private bookings and settings.
6. Test every migrated list, form and overlay at 320, 375, 768 and 1280 pixels.

## Completion rules

The work is complete when:

- the compatibility folder is no longer exported or imported;
- application code does not import icon libraries or `react-hot-toast` directly;
- raw buttons, fields, overlays and tables exist only in documented exceptions;
- every actionable list uses the same row-action policy;
- every canonical component has keyboard, loading, error and mobile behaviour covered by tests;
- lint, TypeScript, tests and production build pass.
