export default function Loading() {
  return (
    <div className="animate-pulse space-y-6 p-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="h-8 bg-gray-200 rounded w-40" />
        <div className="h-4 bg-gray-100 rounded w-56" />
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
            <div className="h-4 bg-gray-100 rounded w-20" />
            <div className="h-7 bg-gray-200 rounded w-16" />
            <div className="h-3 bg-gray-100 rounded w-24" />
          </div>
        ))}
      </div>

      {/* Two-column content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming events */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="h-5 bg-gray-200 rounded w-36" />
          <div className="divide-y divide-gray-100">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="py-3 flex items-center gap-3">
                <div className="h-4 w-4 bg-gray-200 rounded flex-shrink-0" />
                <div className="flex-1 space-y-1">
                  <div className="h-4 bg-gray-200 rounded w-40" />
                  <div className="h-3 bg-gray-100 rounded w-28" />
                </div>
                <div className="h-5 bg-gray-100 rounded-full w-16" />
              </div>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="h-5 bg-gray-200 rounded w-32" />
          <div className="divide-y divide-gray-100">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="py-3 flex items-center gap-3">
                <div className="flex-1 space-y-1">
                  <div className="h-4 bg-gray-200 rounded w-36" />
                  <div className="h-3 bg-gray-100 rounded w-24" />
                </div>
                <div className="h-4 bg-gray-200 rounded w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
