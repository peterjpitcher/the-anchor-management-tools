import { Empty, LinkButton, PageLayout } from '@/ds'

/**
 * The staff 404, inside the app shell.
 *
 * When a page calls `notFound()`, Next renders the nearest not-found boundary inside the layouts
 * above it. This file is that boundary for every page under `(authenticated)`, so a staff record
 * that no longer exists (an invoice, a booking, a role) shows this page with the sidebar still
 * there, instead of the guest-branded `src/app/not-found.tsx` outside the shell.
 *
 * A URL that matches no route at all is different: Next 15 answers it from the root
 * `src/app/not-found.tsx` (the guest page), even under a staff path such as /dashboard/typo,
 * because an unmatched URL belongs to no route group. Checked on a Next 15.5 build, 26 Sep 2026.
 */
export default function AuthenticatedNotFound(): React.JSX.Element {
  return (
    <PageLayout title="Page Not Found">
      <Empty
        icon="search"
        title="We can't find that page"
        description="The link may be old, or the record may have been deleted. Check the address, or start again from the dashboard."
        action={<LinkButton href="/dashboard">Go to Dashboard</LinkButton>}
      />
    </PageLayout>
  )
}
