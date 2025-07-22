/**
 * LinkButton Component
 * 
 * A button component that renders as a Next.js Link for client-side navigation.
 * Combines the styling of Button with the navigation of Link.
 */

import { forwardRef } from 'react'
import Link from 'next/link'
import { Button, ButtonProps } from '../forms/Button'

export interface LinkButtonProps extends Omit<ButtonProps, 'onClick'> {
  /**
   * The URL to navigate to
   */
  href: string
  
  /**
   * Whether to open in a new tab
   * @default false
   */
  target?: string
  
  /**
   * Rel attribute for external links
   */
  rel?: string
}

export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(({
  href,
  target,
  rel,
  children,
  ...buttonProps
}, ref) => {
  // For external links or new tab, use regular anchor
  if (target === '_blank' || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return (
      <a
        ref={ref}
        href={href}
        target={target}
        rel={rel || (target === '_blank' ? 'noopener noreferrer' : undefined)}
        style={{ textDecoration: 'none' }}
      >
        <Button {...buttonProps}>
          {children}
        </Button>
      </a>
    )
  }

  // For internal links, use Next.js Link
  return (
    <Link 
      href={href} 
      passHref 
      legacyBehavior
    >
      <a ref={ref} style={{ textDecoration: 'none' }}>
        <Button {...buttonProps}>
          {children}
        </Button>
      </a>
    </Link>
  )
})

LinkButton.displayName = 'LinkButton'