/**
 * Backward-compatible re-exports from legacy ui-v2/ components
 *
 * These exist solely so that consumer files that import { X } from '@/ds'
 * continue to compile. All exports here are @deprecated and should be
 * replaced by their ds/ equivalents during a follow-up cleanup.
 */

// Forms
export { FormGroup,   } from './FormGroup'

export { Form, FormSection, FormActions } from './Form'

export { RadioGroup } from './RadioGroup'


// Display
export { EmptyState,    } from './EmptyState'

export { StatGroup } from './StatGroup'

export { FilterPanel,  } from './FilterPanel'
export type { FilterDefinition,   } from './FilterPanel'

// Layout
export { Container } from './Container'

export { CardTitle, CardDescription } from './CardParts'

// Navigation
export { TabNav,  } from './TabNav'

export { BackButton,   } from './BackButton'

export { SortableHeader } from './SortableHeader'

// Overlay
export { ModalActions } from './ModalActions'
export { DrawerActions } from './DrawerActions'
export { ConfirmModal,  } from './ConfirmModal'

// Popover parts
export { PopoverHeader, PopoverContent } from './PopoverParts'

// Forms (advanced)



// Toggle (legacy event-based Switch)
export { Toggle } from './Toggle'
