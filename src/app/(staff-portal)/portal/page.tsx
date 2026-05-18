import { redirect } from 'next/navigation'

/**
 * Staff Portal root page -- redirects to shifts (the primary view).
 * The portal layout + navigation lives in the shifts and leave sub-pages.
 */
export default function PortalPage() {
  redirect('/portal/shifts')
}
