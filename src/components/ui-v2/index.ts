/**
 * Central export file for all UI components
 * 
 * This is the new component library (ui-v2) that will replace the legacy components.
 * All components follow consistent patterns and design tokens.
 */

// Layout Components
export { Container } from './layout/Container'
export { Page } from './layout/Page'
export { PageLayout } from './layout/PageLayout'
export { Card } from './layout/Card'
export { Section } from './layout/Section'
export { Divider, SectionDivider, OrDivider, DotDivider } from './layout/Divider'

// Form Components
export { Form, FormSection, FormActions } from './forms/Form'
export { FormGroup, FormGroupSet, InlineFormGroup } from './forms/FormGroup'
export { Input, InputGroup, InputGroupAddon } from './forms/Input'
export { Select, OptGroup, SelectGroup } from './forms/Select'
export { Textarea, TextareaWithActions } from './forms/Textarea'
export { Checkbox, CheckboxGroup } from './forms/Checkbox'
export { RadioGroup, Radio } from './forms/Radio'
export { SearchInput, SearchBar, GlobalSearch } from './forms/SearchInput'
export { Button, ButtonGroup, IconButton, LinkButton } from './forms/Button'
export { DateTimePicker, DatePicker, TimePicker, DateRangePicker } from './forms/DateTimePicker'
export { FileUpload, ImageUpload } from './forms/FileUpload'
export { Toggle, ToggleGroup, CompactToggle, FeatureToggle } from './forms/Toggle'
export { Slider, RangeSlider, PercentageSlider } from './forms/Slider'
export { TagInput, EmailTagInput, SkillTagInput } from './forms/TagInput'
export { Rating, RatingDisplay, RatingInput, useRating } from './forms/Rating'

// Display Components
export { DataTable } from './display/DataTable'
export { EmptyState, EmptyStateSearch, EmptyStateError, EmptyStateIcons } from './display/EmptyState'
export { Badge, BadgeGroup, StatusBadge, CountBadge } from './display/Badge'
export { Stat, StatGroup, ComparisonStat } from './display/Stat'
export { FilterPanel, QuickFilters } from './display/FilterPanel'
export { Avatar, AvatarGroup, AvatarStack, ProfileAvatar } from './display/Avatar'
export { Calendar, MiniCalendar, EventCalendar } from './display/Calendar'
export { VirtualList, VirtualGrid, useVirtualList } from './display/VirtualList'
export { List, SimpleList, UserList } from './display/List'
export { Accordion, SimpleAccordion, FAQAccordion, useAccordion } from './display/Accordion'
export { Timeline, ActivityTimeline, ProcessTimeline } from './display/Timeline'
export { StatusIndicator, ConnectionStatus, HealthStatus, ProgressStatus } from './display/StatusIndicator'

// Navigation Components
export { BackButton, BackLink, MobileBackButton } from './navigation/BackButton'
export { Breadcrumbs, SimpleBreadcrumbs, PageBreadcrumbs } from './navigation/Breadcrumbs'
export { Pagination, SimplePagination, LoadMorePagination } from './navigation/Pagination'
export { TabNav, VerticalTabNav } from './navigation/TabNav'
export { HeaderNav } from './navigation/HeaderNav'
export { CommandPalette, useCommandPalette, CommandPaletteFooter } from './navigation/CommandPalette'
export { Tabs, TabsNav, useTabs } from './navigation/Tabs'
export { Dropdown, DropdownButton, ActionMenu } from './navigation/Dropdown'
export { Menu, ContextMenu } from './navigation/Menu'
export { Stepper, StepperNavigation, useStepper } from './navigation/Stepper'

// Feedback Components
export { Alert } from './feedback/Alert'
export { toast, Toaster, useToast, actionToast } from './feedback/Toast'
export { Skeleton, SkeletonText, SkeletonAvatar, SkeletonButton, SkeletonCard } from './feedback/Skeleton'
export { Spinner, SpinnerOverlay, SpinnerButton } from './feedback/Spinner'
export { ProgressBar, StackedProgressBar } from './feedback/ProgressBar'

// Overlay Components
export { Modal, ModalActions, ConfirmModal, AlertModal } from './overlay/Modal'
export { Tooltip, TooltipProvider, IconTooltip, HelpTooltip, TruncateTooltip } from './overlay/Tooltip'
export { Drawer, DrawerActions, MobileDrawer } from './overlay/Drawer'
export { Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverFooter, PopoverMenu } from './overlay/Popover'
export { ConfirmDialog, DeleteConfirmDialog, RestoreConfirmDialog, useConfirmDialog } from './overlay/ConfirmDialog'

// Utility Components
export { ErrorBoundary } from './utility/ErrorBoundary'

// Hooks
export { useDebounce } from './hooks/useDebounce'

// Utils
export { formatBytes, formatNumber, formatCurrency, formatPercentage, formatDuration, truncate, formatPhoneNumber, formatRelativeTime, formatFileSizeLimit, formatList } from './utils/format'

// Types
export type { ComponentProps } from './types'
