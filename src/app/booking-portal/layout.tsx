import type { ReactNode } from 'react'

export const dynamic = 'force-dynamic'

// Public read-only portal for customers to view their private booking status.
// No authentication required: access is controlled by a signed HMAC token in
// the URL.
//
// The page renders `GuestShell`, which owns the brand bar, the cream body, the
// footer and the only `<main>`, so this layout adds no chrome of its own.
export default function BookingPortalLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return <>{children}</>
}
