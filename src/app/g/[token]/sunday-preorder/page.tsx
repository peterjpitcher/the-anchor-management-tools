import { GuestPageShell } from '@/components/features/shared/GuestPageShell'

export default function SundayPreorderPage() {
  return (
    <GuestPageShell maxWidthClassName="max-w-xl">
      <div className="mx-auto w-full max-w-xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">Sunday pre-orders are no longer required</h1>
        <p className="mt-2 text-sm text-gray-600">
          You do not need to choose food in advance for Sunday bookings. We will look after your table when you arrive.
        </p>
      </div>
    </GuestPageShell>
  )
}
