import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ContractPage({ params }: Props) {
  const { id } = await params
  redirect(`/api/private-bookings/contract?bookingId=${id}`)
}