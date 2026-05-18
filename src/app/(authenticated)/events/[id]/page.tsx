import { redirect } from 'next/navigation'

/**
 * Event detail pages now use the drawer pattern in /events.
 * Redirect any direct links to the events list.
 */
export default async function EventViewPage() {
  redirect('/events')
}
