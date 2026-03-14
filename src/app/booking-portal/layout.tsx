import type { ReactNode } from 'react'

export const dynamic = 'force-dynamic'

// Public read-only portal for customers to view their private booking status.
// No authentication required — access is controlled by a signed HMAC token in the URL.
export default function BookingPortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {children}
    </div>
  )
}
