import { GUEST_CONTACT } from '@/lib/guest-contact'
import { GUEST_LINK_CLASS } from './styles'

type GuestLinkProps = {
  href: string
  children: React.ReactNode
  /** Opens in a new tab, for a page on another site such as the privacy notice. */
  external?: boolean
  rel?: string
}

/**
 * An inline link inside guest copy.
 *
 * no-referrer by default: guest pages carry a bearer token in the URL, and the
 * app's Referrer-Policy would otherwise hand the full path to the next page.
 */
export function GuestLink({ href, children, external = false, rel }: GuestLinkProps): React.JSX.Element {
  return (
    <a
      href={href}
      referrerPolicy="no-referrer"
      className={GUEST_LINK_CLASS}
      {...(external ? { target: '_blank', rel: rel ?? 'noopener noreferrer' } : rel ? { rel } : {})}
    >
      {children}
    </a>
  )
}

/** The pub's phone number as a tap-to-call link, from the one contact source. */
export function GuestPhoneLink(): React.JSX.Element {
  return <GuestLink href={GUEST_CONTACT.telHref}>{GUEST_CONTACT.phoneDisplay}</GuestLink>
}

/** The pub's email address as a mail link, from the one contact source. */
export function GuestEmailLink(): React.JSX.Element {
  return <GuestLink href={GUEST_CONTACT.emailHref}>{GUEST_CONTACT.email}</GuestLink>
}

/**
 * The closing "Need help? Call ..." line a guest page ends on. Pass the words;
 * put a `GuestPhoneLink` in them.
 */
export function GuestHelpLine({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="text-center font-anchor-body text-guest-body text-guest-text-muted">{children}</p>
}
