import { TellUsClient } from './TellUsClient'
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

  return <TellUsClient src={src} />
}
