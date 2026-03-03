export default function Loading() {
  return (
    <div className="animate-pulse space-y-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 bg-gray-200 rounded w-40" />
          <div className="h-4 bg-gray-100 rounded w-56" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 bg-gray-200 rounded w-28" />
          <div className="h-9 bg-gray-200 rounded w-28" />
        </div>
      </div>

      {/* Week navigation */}
      <div className="flex items-center gap-3">
        <div className="h-9 bg-gray-200 rounded w-9" />
        <div className="h-5 bg-gray-200 rounded w-48" />
        <div className="h-9 bg-gray-200 rounded w-9" />
      </div>

      {/* Rota grid */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-8 border-b border-gray-200 bg-gray-50">
          <div className="px-3 py-3 border-r border-gray-200">
            <div className="h-4 bg-gray-200 rounded w-16" />
          </div>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="px-3 py-3 border-r border-gray-100 last:border-r-0 text-center space-y-1">
              <div className="h-3 bg-gray-200 rounded w-8 mx-auto" />
              <div className="h-5 bg-gray-200 rounded w-6 mx-auto" />
            </div>
          ))}
        </div>

        {/* Employee rows */}
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="grid grid-cols-8 border-b border-gray-100 last:border-b-0">
            <div className="px-3 py-4 border-r border-gray-200 space-y-1">
              <div className="h-4 bg-gray-200 rounded w-24" />
              <div className="h-3 bg-gray-100 rounded w-16" />
            </div>
            {Array.from({ length: 7 }).map((_, j) => (
              <div key={j} className="px-2 py-3 border-r border-gray-100 last:border-r-0 min-h-[60px]">
                {(i + j) % 3 === 0 && (
                  <div className="h-10 bg-blue-50 border border-blue-100 rounded" />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
