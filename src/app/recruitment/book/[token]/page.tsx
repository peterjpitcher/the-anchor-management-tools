import RecruitmentBookingClient from './RecruitmentBookingClient'
import { previewRecruitmentBookingToken } from '@/services/recruitment'
import { GuestShell } from '@/components/features/guest'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ token: string }>
}

export default async function RecruitmentBookingPage({ params }: PageProps) {
  const { token } = await params
  const preview = await previewRecruitmentBookingToken(token)

  // Candidates see the pub's guest brand, like every other public token page (owner
  // decision, 18 Sep 2026). GuestShell owns the page's only <main>.
  return (
    <GuestShell maxWidthClassName="max-w-2xl">
      <RecruitmentBookingClient
        token={token}
        initialPreview={preview}
      />
    </GuestShell>
  )
}

