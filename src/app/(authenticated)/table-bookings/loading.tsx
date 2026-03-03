export default function Loading() {
  return (
    <div className="animate-pulse space-y-6 p-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="h-8 bg-gray-200 rounded w-48" />
        <div className="h-4 bg-gray-100 rounded w-72" />
      </div>

      {/* Nav tabs */}
      <div className="flex gap-4 border-b border-gray-200 pb-0">
        <div className="h-8 bg-gray-200 rounded-t w-28" />
        <div className="h-8 bg-gray-100 rounded-t w-28" />
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap gap-3">
        <div className="h-9 bg-gray-200 rounded w-32" />
        <div className="h-9 bg-gray-200 rounded w-32" />
        <div className="h-9 bg-gray-200 rounded w-24" />
      </div>

      {/* Booking rows */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="divide-y divide-gray-100">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="px-4 py-4 flex items-center gap-4">
              <div className="space-y-1 w-24 flex-shrink-0">
                <div className="h-4 bg-gray-200 rounded w-16" />
                <div className="h-3 bg-gray-100 rounded w-12" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="h-4 bg-gray-200 rounded w-32" />
                <div className="h-3 bg-gray-100 rounded w-24" />
              </div>
              <div className="h-5 bg-gray-200 rounded w-16 hidden sm:block" />
              <div className="h-5 bg-gray-100 rounded w-20 hidden md:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
