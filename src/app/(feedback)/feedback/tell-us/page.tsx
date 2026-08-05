import { TellUsClient } from './TellUsClient'
import { GuestShell } from '@/components/features/guest'
import { sanitizeFeedbackSource } from '@/app/api/feedback/source'

export const metadata = {
  title: 'Tell us about your visit',
}

interface TellUsPageProps {
  searchParams: Promise<{ src?: string }>
}

export default async function TellUsPage({ searchParams }: TellUsPageProps) {
  const params = await searchParams
  const src = sanitizeFeedbackSource(params.src)

  // The shell stays on the server so the guest webfonts and the footer never
  // enter the client bundle. TellUsClient renders the `<form>` inside it.
  return (
    <GuestShell>
      <TellUsClient src={src} />
    </GuestShell>
  )
}
