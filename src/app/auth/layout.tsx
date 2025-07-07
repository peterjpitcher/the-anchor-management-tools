import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Login - Management Tools',
  description: 'Secure login for The Anchor Management Tools',
  robots: 'noindex, nofollow',
  other: {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  }
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      {/* Security headers via meta tags */}
      <meta name="referrer" content="no-referrer" />
      <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
      <meta httpEquiv="Pragma" content="no-cache" />
      <meta httpEquiv="Expires" content="0" />
      {children}
    </>
  )
}