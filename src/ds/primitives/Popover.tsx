'use client'

import {
  createContext,
  Fragment,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
} from 'react'
import {
  Popover as HeadlessPopover,
  PopoverButton,
  PopoverPanel,
} from '@headlessui/react'
import { cn } from '@/lib/utils'

export type PopoverPlacement =
  | 'bottom-start'
  | 'bottom-end'
  | 'bottom'
  | 'top-start'
  | 'top-end'
  | 'top'

export type PopoverWidth = 'auto' | 'sm' | 'md' | 'lg'

export interface PopoverRenderProps {
  /** Closes the panel and returns focus to the trigger. */
  close: () => void
}

export interface PopoverProps {
  /**
   * The control that opens the panel, normally a DS `Button` or `IconButton`. The popover's
   * `aria-expanded`, `aria-haspopup` and click handling land on that element itself, and its
   * own `id` is kept (so a `Field` label still points at it).
   */
  trigger: React.ReactNode
  /** The panel content, or a function that receives `{ close }` to close it from inside. */
  children: React.ReactNode | ((api: PopoverRenderProps) => React.ReactNode)
  /** Which trigger edge the panel lines up with when `placement` is not given. */
  align?: 'left' | 'right'
  /**
   * Where the panel opens (default `bottom-start`, or `bottom-end` with `align="right"`).
   * It flips to the other side when there is no room, and shifts to stay on screen.
   */
  placement?: PopoverPlacement
  /** Panel width: `sm` 14rem, `md` 18rem (default), `lg` 24rem, `auto` sized by its content. */
  width?: PopoverWidth
  /** Extra classes for the panel, for example a custom width or less padding. */
  panelClassName?: string
  /** Classes for the element that wraps the trigger, for example `w-full` or `flex-1`. */
  className?: string
  /** Accessible name for the panel. Defaults to the trigger's own name. */
  label?: string
  /** Called with `true` when the panel opens and `false` when it closes. */
  onOpenChange?: (open: boolean) => void
}

const PopoverCloseContext = createContext<() => void>(() => {})

/**
 * Closes the nearest DS `Popover` from a component inside its panel (for example after
 * applying a choice). Outside a popover it returns a function that does nothing.
 */
export function usePopoverClose(): () => void {
  return useContext(PopoverCloseContext)
}

const widthClasses: Record<PopoverWidth, string> = {
  auto: 'w-max',
  sm: 'w-56',
  md: 'w-72',
  lg: 'w-96',
}

/** Headless UI's anchor names ("bottom start") for our placements. */
const anchorFor: Record<PopoverPlacement, 'bottom start' | 'bottom end' | 'bottom' | 'top start' | 'top end' | 'top'> = {
  'bottom-start': 'bottom start',
  'bottom-end': 'bottom end',
  bottom: 'bottom',
  'top-start': 'top start',
  'top-end': 'top end',
  top: 'top',
}

function OpenChangeNotifier({ open, onOpenChange }: { open: boolean; onOpenChange?: (open: boolean) => void }): null {
  const previous = useRef(open)
  useEffect(() => {
    if (previous.current === open) return
    previous.current = open
    onOpenChange?.(open)
  }, [open, onOpenChange])
  return null
}

/**
 * A click-to-open panel for small forms and pickers. The panel is portalled to the end of the
 * page and anchored to the trigger, so a card or table with `overflow: hidden` cannot clip it.
 */
export function Popover({
  trigger,
  children,
  align = 'left',
  placement,
  width = 'md',
  panelClassName,
  className,
  label,
  onOpenChange,
}: PopoverProps) {
  const generatedId = useId()
  const triggerElement = isValidElement<{ id?: string }>(trigger) ? trigger : null
  // Headless UI would replace the trigger's id with its own; keep the caller's so labels hold.
  const triggerId = triggerElement?.props.id ?? `popover-trigger-${generatedId}`
  const resolvedPlacement = placement ?? (align === 'right' ? 'bottom-end' : 'bottom-start')
  const triggerProps: Record<string, string> = { id: triggerId, 'aria-haspopup': 'dialog' }

  return (
    <HeadlessPopover className={cn('relative', className)}>
      {({ open }) => (
        <>
          <OpenChangeNotifier open={open} onOpenChange={onOpenChange} />
          {triggerElement ? (
            // Headless UI forwards these onto the trigger element itself (its types only
            // list Fragment's own props, hence the spread).
            <PopoverButton as={Fragment} {...triggerProps}>
              {triggerElement}
            </PopoverButton>
          ) : (
            <PopoverButton
              id={triggerId}
              aria-haspopup="dialog"
              className="inline-flex rounded-default focus-visible:outline-hidden focus-visible:shadow-ring"
            >
              {trigger}
            </PopoverButton>
          )}

          <PopoverPanel
            anchor={{ to: anchorFor[resolvedPlacement], gap: 8, padding: 8 }}
            role="dialog"
            aria-label={label}
            aria-labelledby={label ? undefined : triggerId}
            className={cn(
              'z-50 max-w-[calc(100vw-1rem)] rounded-lg bg-surface border border-border shadow-lg p-4',
              widthClasses[width],
              'focus:outline-hidden',
              'transition duration-100 ease-out data-[closed]:scale-95 data-[closed]:opacity-0',
              panelClassName,
            )}
          >
            {({ close }) => (
              <PopoverCloseContext.Provider value={close}>
                {typeof children === 'function' ? children({ close }) : children}
              </PopoverCloseContext.Provider>
            )}
          </PopoverPanel>
        </>
      )}
    </HeadlessPopover>
  )
}
