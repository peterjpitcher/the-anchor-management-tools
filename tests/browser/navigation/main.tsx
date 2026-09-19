import React from 'react'
import { createRoot } from 'react-dom/client'
import { AppShell } from '../../../src/ds/shell/AppShell'
import { usePathname } from './stubs'
import '../../../src/app/globals.css'

function Preview() {
  const path = usePathname()
  return <AppShell userId="navigation-fixture" userName="Preview" userRole="Super Admin" isSuperAdmin onSignOut={() => {}} isSigningOut={false}>
    <h1 className="text-xl font-semibold">Navigation verification</h1>
    <p className="mt-3">Local fixture. No customer data or live actions.</p>
    <p className="mt-3" data-testid="destination">{path}</p>
    <a className="mt-4 inline-block underline" href="/cashing-up/daily" onClick={event => { event.preventDefault(); history.pushState(null, '', '/cashing-up/daily'); window.dispatchEvent(new PopStateEvent('popstate')) }}>Open a daily cashing up entry</a>
    <button className="ml-4 rounded border px-3 py-1" type="button">Main page focus target</button>
  </AppShell>
}
createRoot(document.getElementById('root')!).render(<Preview />)
