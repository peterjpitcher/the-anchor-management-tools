import React, { type CSSProperties } from 'react'
import { iconPaths } from './paths'

/** Union type of all available icon names */
export type IconName = keyof typeof iconPaths

interface IconProps {
  /** Name of the icon to render */
  name: IconName
  /** Pixel size (width and height). Default: 16 */
  size?: number
  /** Additional CSS class names */
  className?: string
  /** Inline styles */
  style?: CSSProperties
}

/**
 * SVG icon component rendering named icons from the design system icon set.
 * Renders at 16px default on a 24x24 viewBox with strokeWidth 1.75.
 *
 * Server component -- no 'use client' directive needed.
 *
 * @example
 * ```tsx
 * <Icon name="home" />
 * <Icon name="search" size={20} className="text-text-muted" />
 * ```
 */
export function Icon({ name, size = 16, className, style }: IconProps): React.ReactElement | null {
  const paths = iconPaths[name]
  if (!paths) return null

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, display: 'inline-block', ...style }}
      aria-hidden="true"
    >
      {paths}
    </svg>
  )
}
