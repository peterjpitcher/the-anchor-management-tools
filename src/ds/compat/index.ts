/**
 * Backward-compatible re-exports from legacy ui-v2/ components
 *
 * These exist solely so that consumer files that import { X } from '@/ds'
 * continue to compile. All exports here are @deprecated and should be
 * replaced by their ds/ equivalents during a follow-up cleanup.
 */

// Forms
export { FormGroup, FormGroupSet, InlineFormGroup } from './FormGroup'
export type { FormGroupProps } from './FormGroup'
export { Form, FormSection, FormActions } from './Form'
export type { FormProps } from './Form'
export { RadioGroup } from './RadioGroup'
export type { RadioGroupProps, RadioOption } from './RadioGroup'

// Display
export { EmptyState, EmptyStateSearch, EmptyStateError, EmptyStateIcons } from './EmptyState'
export type { EmptyStateProps, EmptyStateIcon } from './EmptyState'
export { StatGroup } from './StatGroup'
export { BadgeGroup } from './BadgeGroup'
export { FilterPanel, QuickFilters } from './FilterPanel'
export type { FilterDefinition, FilterValue, FilterPanelProps } from './FilterPanel'

// Layout
export { Container } from './Container'
export type { ContainerProps } from './Container'
export { CardTitle, CardDescription } from './CardParts'

// Navigation
export { TabNav, VerticalTabNav } from './TabNav'
export type { TabNavProps, TabItem } from './TabNav'
export { BackButton, BackLink, MobileBackButton } from './BackButton'
export type { BackButtonProps } from './BackButton'
export { SortableHeader } from './SortableHeader'

// Overlay
export { ModalActions } from './ModalActions'
export { DrawerActions } from './DrawerActions'
export { ConfirmModal, AlertModal } from './ConfirmModal'

// Popover parts
export { PopoverHeader, PopoverContent } from './PopoverParts'

// Forms (advanced)
export { DebouncedTextarea } from './DebouncedTextarea'
export type { DebouncedTextareaRef, DebouncedTextareaProps } from './DebouncedTextarea'

// Toggle (legacy event-based Switch)
export { Toggle } from './Toggle'
