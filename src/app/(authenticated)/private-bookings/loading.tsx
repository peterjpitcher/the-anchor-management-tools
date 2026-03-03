export default function Loading() {
  return (
    <div className="animate-pulse space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 bg-gray-200 rounded w-44" />
          <div className="h-4 bg-gray-100 rounded w-64" />
        </div>
        <div className="h-9 bg-gray-200 rounded w-36" />
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex flex-wrap gap-3">
          <div className="h-9 bg-gray-200 rounded w-32" />
          <div className="h-9 bg-gray-200 rounded w-28" />
          <div className="h-9 bg-gray-200 rounded w-40" />
        </div>
      </div>

      {/* Booking list */}
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-lg p-4 flex items-start gap-4">
            <div className="flex-shrink-0 space-y-1 w-28">
              <div className="h-4 bg-gray-200 rounded w-24" />
              <div className="h-3 bg-gray-100 rounded w-16" />
            </div>
            <div className="flex-1 space-y-2">
              <div className="h-5 bg-gray-200 rounded w-48" />
              <div className="h-4 bg-gray-100 rounded w-36" />
              <div className="flex gap-2">
                <div className="h-5 bg-gray-100 rounded-full w-20" />
                <div className="h-5 bg-gray-100 rounded-full w-24" />
              </div>
            </div>
            <div className="flex-shrink-0">
              <div className="h-4 bg-gray-200 rounded w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
