import { redirect } from 'next/navigation'

type SearchParamsPromise = Promise<Record<string, string | string[] | undefined>>

export default async function LegacyCheckInRedirect({
  searchParams,
}: {
  searchParams: SearchParamsPromise
}) {
  const resolved = await searchParams
  const eventIdParam = resolved?.event
  const eventId = Array.isArray(eventIdParam) ? eventIdParam[0] : eventIdParam

  if (eventId && typeof eventId === 'string') {
    redirect(`/events/${eventId}/check-in`)
  }

  redirect('/events')
}
