'use client'

import { createContext, useContext, type ReactNode } from 'react'

const AuthCreditContext = createContext<ReactNode>(null)

/**
 * Carries the Orange Jelly credit from the auth layout, a Server Component that can read the
 * feed, down to AuthCard, which the sign-in screens render from Client Components that cannot.
 * Screens outside /auth (/error, /unauthorized and the invite-link states) have no provider, so
 * the credit stays on the public sign-in pages.
 */
export function AuthCreditProvider({
  credit,
  children,
}: {
  credit: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return <AuthCreditContext.Provider value={credit}>{children}</AuthCreditContext.Provider>
}

/** The credit under the card, or nothing when no provider supplied one. */
export function AuthCredit(): React.JSX.Element | null {
  const credit = useContext(AuthCreditContext)
  if (!credit) return null

  return <div className="mt-4 w-full text-center shell:max-w-sm">{credit}</div>
}
