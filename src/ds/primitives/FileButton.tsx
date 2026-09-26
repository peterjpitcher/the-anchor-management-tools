'use client'

import { useCallback, useRef, type ReactNode, type Ref } from 'react'
import { Button, type ButtonProps } from './Button'

export interface FileButtonProps {
  /** Called with the picked files. Never called with an empty list. */
  onFiles: (files: File[]) => void
  /** File types the picker offers, as for <input accept>, such as "image/*" or ".csv". */
  accept?: string
  multiple?: boolean
  /** On a phone, open the camera straight away: 'environment' for the back camera, 'user' for the front. */
  capture?: 'user' | 'environment'
  disabled?: boolean
  /** Shows the Button's spinner and blocks picking. */
  loading?: boolean
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  icon?: ReactNode
  /** The button label. */
  children?: ReactNode
  'aria-label'?: string
  /** For a Field's hint or error. */
  'aria-describedby'?: string
  /**
   * With a name, the hidden input keeps what was picked so it submits with a surrounding
   * form. Without one, the input is cleared after each pick so the same file can be picked
   * again.
   */
  name?: string
  /** The hidden file input, so a caller can clear it after an upload. */
  inputRef?: Ref<HTMLInputElement>
  /** Goes on the button, which is the control. */
  id?: string
  className?: string
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (!ref) return
  if (typeof ref === 'function') {
    ref(value)
    return
  }
  ;(ref as { current: T | null }).current = value
}

/**
 * A DS Button that opens the file picker. The file input is hidden and out of the tab order;
 * the Button is the control a keyboard or screen reader reaches.
 *
 * ```tsx
 * <FileButton accept="image/*" capture="environment" icon={<Icon name="camera" />} onFiles={upload}>
 *   Take Photo
 * </FileButton>
 * ```
 */
export function FileButton({
  onFiles,
  accept,
  multiple = false,
  capture,
  disabled = false,
  loading = false,
  variant,
  size,
  icon,
  children,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  name,
  inputRef,
  id,
  className,
}: FileButtonProps): React.JSX.Element {
  const ownInputRef = useRef<HTMLInputElement | null>(null)
  const setInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      ownInputRef.current = node
      assignRef(inputRef, node)
    },
    [inputRef],
  )

  return (
    <>
      {/* First and display: none, so it never takes a flex gap or a parent's last-child spacing. */}
      <input
        ref={setInputRef}
        type="file"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        accept={accept}
        multiple={multiple}
        capture={capture}
        name={name}
        disabled={disabled || loading}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (!name) event.target.value = ''
          if (files.length > 0) onFiles(files)
        }}
      />
      <Button
        type="button"
        id={id}
        variant={variant}
        size={size}
        icon={icon}
        loading={loading}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        className={className}
        onClick={() => ownInputRef.current?.click()}
      >
        {children}
      </Button>
    </>
  )
}
