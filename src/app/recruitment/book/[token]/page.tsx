import RecruitmentBookingClient from './RecruitmentBookingClient'
import { previewRecruitmentBookingToken } from '@/services/recruitment'
import { GuestShell } from '@/components/features/guest'

// Static and non-personal on purpose, like every guest page's title: no token or name may reach
// a browser title or history entry. The words are the page heading's own kicker.
export const metadata = { title: 'Interview booking - The Anchor' }

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
    <GuestShell width="wide">
      <RecruitmentBookingClient
        token={token}
        initialPreview={preview}
      />
    </GuestShell>
  )
}
