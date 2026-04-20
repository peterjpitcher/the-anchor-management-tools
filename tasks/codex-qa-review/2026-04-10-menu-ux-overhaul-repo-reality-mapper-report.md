Inspected the spec first, then the live code. Here’s the repo-reality report.

1. Drawer component  
[Drawer.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/overlay/Drawer.tsx#L17)  
Actual size type is `size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'`. Actual position type is `position?: 'left' | 'right' | 'top' | 'bottom'`.  
Actual props are: `open`, `onClose`, `position?`, `size?`, `title?`, `description?`, `children`, `footer?`, `showCloseButton?`, `closeOnBackdrop?`, `showBackdrop?`, `swipeToClose?`, `className?`, `overlayClassName?`, `zIndex?`, `unmount?`, `stickyHeaderFooter?`.  
`lg` and `xl` do exist. For left/right drawers they map to `max-w-2xl` and `max-w-4xl`; for top/bottom they map to `max-h-[75vh]` and `max-h-[90vh]` ([Drawer.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/overlay/Drawer.tsx#L137)).  
Mobile full-screen: not explicitly. There is no viewport-based “switch to full-screen on mobile.” For left/right drawers the panel is always `h-full w-full` plus a `max-w-*`, so on narrow mobile screens it will usually fill the width, but that is implicit, not a dedicated mobile mode ([Drawer.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/overlay/Drawer.tsx#L247)).

2. DataTable component  
[DataTable.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/DataTable.tsx#L38)  
Sorting: yes. `Column<T>` has `sortable?: boolean` and `sortFn?: (a: T, b: T) => number`, and the table keeps internal `sortColumn` / `sortDirection` state ([DataTable.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/DataTable.tsx#L241)).  
Expandable rows: yes. Props are `expandable?: boolean`, `renderExpandedContent?: (row: T) => ReactNode`, `defaultExpandedKeys?: Array<string | number>` ([DataTable.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/DataTable.tsx#L198)).  
Actual column props are: `key`, `header`, `cell`, `sortable?`, `sortFn?`, `width?`, `align?: 'left' | 'center' | 'right'`, `hideOnMobile?`, `className?`.  
Pagination: no built-in pagination props or slicing. It renders `sortedData.map(...)` directly in both mobile and desktop views ([DataTable.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/DataTable.tsx#L445), [DataTable.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/DataTable.tsx#L626)).

3. Tabs component  
[Tabs.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/navigation/Tabs.tsx#L22)  
Actual variant type is `variant?: 'underline' | 'pills' | 'enclosed' | 'segment'`. Other key props: `items`, `activeKey?`, `defaultActiveKey?`, `onChange?`, `size?: 'sm' | 'md' | 'lg'`, `align?: 'start' | 'center' | 'end' | 'stretch'`, `orientation?: 'horizontal' | 'vertical'`, `fullWidth?`, `bordered?`, `padded?`, `destroyInactive?`, `tabListClassName?`, `tabPanelClassName?`, `className?`, `keyboardNavigation?`, `renderTabLabel?`, `onDisabledClick?`.  
Can it be used inside a Drawer? Yes, nothing in the component prevents that. It is a regular in-tree component with no portal or overlay coupling. I did not find a current Drawer usage, but the implementation is compatible.

4. Accordion component  
[Accordion.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Accordion.tsx#L24)  
Actual variant type is `variant?: 'default' | 'bordered' | 'separated' | 'ghost'`.  
Actual props are: `items`, `activeKeys?`, `defaultActiveKeys?`, `onChange?`, `multiple?`, `collapsible?`, `variant?`, `size?: 'sm' | 'md' | 'lg'`, `iconPosition?: 'start' | 'end'`, `expandIcon?`, `showArrow?`, `destroyInactive?`, `className?`, `headerClassName?`, `contentClassName?`, `renderHeader?`, `fullWidth?`.  
Each `AccordionItem` is `key`, `title`, `content`, `icon?`, `disabled?`, `extra?`.

5. Stat component family  
[Stat.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Stat.tsx#L16)  
`Stat` variant type is `variant?: 'default' | 'bordered' | 'filled'`. Color type is `color?: 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'`.  
`StatProps` are: `label`, `value`, `change?`, `changeType?: 'increase' | 'decrease' | 'neutral'`, `description?`, `icon?`, `size?: 'sm' | 'md' | 'lg'`, `variant?`, `color?`, `loading?`, `formatValue?`, `onClick?`, `className?`, `href?`.  
`StatGroup` exists and is a layout helper with `children`, `columns?: 1 | 2 | 3 | 4`, `className?`, `mobileScroll?: boolean` ([Stat.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Stat.tsx#L304)).  
`ComparisonStat` exists with `label`, `value`, `previousValue`, `format?: 'number' | 'percent' | 'currency'`, plus the rest of `StatProps` except `value`, `change`, `changeType` ([Stat.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Stat.tsx#L351)).

6. FilterPanel component  
[FilterPanel.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/FilterPanel.tsx#L34)  
Actual filter type union is `type: 'text' | 'select' | 'multiselect' | 'date' | 'daterange' | 'number' | 'boolean'`.  
It also supports a custom renderer via `render?: (value: any, onChange: (value: any) => void) => ReactNode`.  
`number` is implemented as a `{ min, max }` pair of number inputs, `boolean` as a checkbox, `multiselect` as a checkbox list.  
Panel props include `filters`, `values`, `onChange`, `savedFilters?`, `onSaveFilter?`, `onDeleteSavedFilter?`, `onLoadSavedFilter?`, `showSearch?`, `searchValue?`, `onSearchChange?`, `searchPlaceholder?`, `layout?: 'horizontal' | 'vertical' | 'compact'`, `showClearAll?`, `showFilterCount?`, `maxVisibleFilters?`, `className?`, `loading?`, `onReset?`.

7. Pagination component  
[Pagination.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/navigation/Pagination.tsx#L15)  
It does exist. `PaginationProps` are: `currentPage`, `totalPages`, `totalItems`, `itemsPerPage`, `onPageChange`, `onItemsPerPageChange?`, `itemsPerPageOptions?`, `showItemsPerPage?`, `showPageJumper?`, `showFirstLastButtons?`, `showItemCount?`, `maxPagesToShow?`, `size?: 'sm' | 'md' | 'lg'`, `position?: 'start' | 'center' | 'end' | 'between'`, `className?`, `labels?`.  
There are also `SimplePagination` and `LoadMorePagination` helper exports.

8. Server actions  
[menu-management.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/menu-management.ts#L73), [menu.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/menu.ts#L98)  
`updateMenuIngredient` does not support partial updates at runtime. Even though `UpdateIngredientInput` is typed as `Partial<CreateIngredientInput>`, the action uses `IngredientSchema.parse(input)`, not `.partial()`.  
`updateMenuDish` does support partial updates at runtime. It uses `DishSchema.partial().parse(input)` ([menu-management.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/menu-management.ts#L326)).  
So the real answer is: ingredient action no, dish action yes.

9. Skeleton / EmptyState  
[Skeleton.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/feedback/Skeleton.tsx#L14), [EmptyState.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/EmptyState.tsx#L37)  
Both exist. `SkeletonProps`: `variant?: 'text' | 'circular' | 'rectangular' | 'rounded'`, `width?`, `height?`, `animation?: 'pulse' | 'wave' | false`, `lines?`, `lastLineShort?`. It also exports `SkeletonText`, `SkeletonAvatar`, `SkeletonButton`, `SkeletonCard`.  
`EmptyStateProps`: `title`, `description?`, `icon?: EmptyStateIcon | ReactNode`, `action?`, `size?: 'sm' | 'md' | 'lg'`, `variant?: 'default' | 'dashed' | 'minimal'`, `centered?`, plus normal `HTMLAttributes<HTMLDivElement>`. It also exports `EmptyStateSearch` and `EmptyStateError`.

10. ConfirmDialog  
[ConfirmDialog.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/overlay/ConfirmDialog.tsx#L25)  
It does exist. `ConfirmDialogProps` are: `open`, `onClose`, `onConfirm`, `title`, `message?`, `type?: 'danger' | 'warning' | 'info' | 'success'`, `confirmText?`, `cancelText?`, `showIcon?`, `icon?`, `confirmVariant?: 'primary' | 'danger' | 'success'`, `destructive?`, `requireConfirmation?`, `confirmationText?`, `confirmationPlaceholder?`, `children?`, `closeOnConfirm?`, `loadingText?`, `size?: 'xs' | 'sm' | 'md' | 'lg'`.  
Important reality check: it is implemented on top of `Modal`, not `Drawer` ([ConfirmDialog.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/overlay/ConfirmDialog.tsx#L22)). It also exports `DeleteConfirmDialog` and `RestoreConfirmDialog`.

If you want, I can turn this into a spec-vs-reality delta table next.