import RecruitmentBookingClient from './RecruitmentBookingClient'
import { previewRecruitmentBookingToken } from '@/services/recruitment'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ token: string }>
}

export default async function RecruitmentBookingPage({ params }: PageProps) {
  const { token } = await params
  const preview = await previewRecruitmentBookingToken(token)

  return (
    <RecruitmentBookingClient
      token={token}
      initialPreview={preview}
    />
  )
}

