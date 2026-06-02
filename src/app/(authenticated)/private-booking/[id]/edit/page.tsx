import { redirect } from 'next/navigation'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function PrivateBookingSingularEditRedirectPage({ params }: PageProps) {
  const { id } = await params
  redirect(`/private-bookings/${id}/edit`)
}
