export default function Loading() {
  return (
    <div className="animate-pulse space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="h-4 bg-gray-100 rounded w-32" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 bg-gray-200 rounded w-24" />
          <div className="h-9 bg-gray-200 rounded w-24" />
        </div>
      </div>

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main detail card */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
            <div className="h-5 bg-gray-200 rounded w-32" />
            <div className="grid grid-cols-2 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-1">
                  <div className="h-3 bg-gray-100 rounded w-20" />
                  <div className="h-5 bg-gray-200 rounded w-36" />
                </div>
              ))}
            </div>
          </div>

          {/* Description block */}
          <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-3">
            <div className="h-5 bg-gray-200 rounded w-28" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-4 bg-gray-100 rounded w-full" />
            ))}
            <div className="h-4 bg-gray-100 rounded w-2/3" />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-3">
            <div className="h-5 bg-gray-200 rounded w-24" />
            <div className="h-8 bg-gray-200 rounded w-32" />
            <div className="h-5 bg-gray-100 rounded-full w-20" />
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-3">
            <div className="h-5 bg-gray-200 rounded w-28" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="h-4 w-4 bg-gray-200 rounded" />
                <div className="h-4 bg-gray-100 rounded w-32" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
