export default function CardCapturePage() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center space-y-4">
        <h1 className="text-2xl font-semibold text-gray-900">No action needed</h1>
        <p className="text-gray-600">
          Card details are no longer required to secure your booking.
        </p>
        <p className="text-gray-600">
          Your booking has been confirmed. You will receive an SMS confirmation shortly.
        </p>
        <p className="text-sm text-gray-400">
          If you have any questions, please contact us directly.
        </p>
      </div>
    </main>
  )
}
