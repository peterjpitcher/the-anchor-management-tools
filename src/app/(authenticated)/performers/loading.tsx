export default function Loading() {
  return (
    <div className="animate-pulse space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 bg-gray-200 rounded w-32" />
          <div className="h-4 bg-gray-100 rounded w-48" />
        </div>
        <div className="h-9 bg-gray-200 rounded w-36" />
      </div>

      {/* Search bar */}
      <div className="h-9 bg-gray-200 rounded w-full" />

      {/* Performer cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-gray-200 rounded-full flex-shrink-0" />
              <div className="space-y-1 flex-1">
                <div className="h-4 bg-gray-200 rounded w-32" />
                <div className="h-3 bg-gray-100 rounded w-24" />
              </div>
            </div>
            <div className="h-3 bg-gray-100 rounded w-full" />
            <div className="h-3 bg-gray-100 rounded w-3/4" />
          </div>
        ))}
      </div>
    </div>
  )
}
