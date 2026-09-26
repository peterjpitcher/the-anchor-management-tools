/**
 * Design System: top-level barrel export
 *
 * Usage:
 *   import { Button, Card, Icon, colors } from '@/ds'
 */

export * from './primitives'
// Named here because src/ds/primitives/index.ts lists its exports one by one.
export { DropdownLabel } from './primitives/Dropdown'
export { usePopoverClose } from './primitives/Popover'
export type { PopoverPlacement, PopoverProps, PopoverRenderProps, PopoverWidth } from './primitives/Popover'
export type { ConfirmDialogProps, ConfirmDialogTone } from './primitives/ConfirmDialog'
export * from './composites'
export { PageLoading } from './composites/PageLoading'
export type { PageLoadingProps } from './composites/PageLoading'
export * from './icons'
export * from './tokens'
export * from './shell'
// Legacy components are no longer on the barrel: the few left are imported from '@/ds/compat'.
