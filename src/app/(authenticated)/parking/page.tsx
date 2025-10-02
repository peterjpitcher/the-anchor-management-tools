import Link from 'next/link'

export default function ParkingDashboard() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Parking Management</h1>
        <p className="text-sm text-slate-600">Track car park bookings, payments, and availability.</p>
      </header>

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <p className="text-sm text-slate-700">
          The parking dashboard is under active development. Booking creation, pricing, and payment APIs
          are available now. UI workflows for booking management will follow shortly.
        </p>
        <p className="mt-4 text-sm text-slate-600">
          In the meantime you can create bookings through the internal action layer or public API endpoints
          documented in the API guide.
        </p>
        <div className="mt-4">
          <Link className="text-sm font-medium text-blue-600 hover:underline" href="/docs/guides/api">View API documentation</Link>
        </div>
      </div>
    </div>
  )
}
