import { redirect } from 'next/navigation'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function PrivateBookingSingularRedirectPage({ params }: PageProps) {
  const { id } = await params
  redirect(`/private-bookings/${id}`)
}
