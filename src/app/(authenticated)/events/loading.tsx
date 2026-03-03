export default function Loading() {
  return (
    <div className="animate-pulse space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 bg-gray-200 rounded w-24" />
          <div className="h-4 bg-gray-100 rounded w-48" />
        </div>
        <div className="h-9 bg-gray-200 rounded w-32" />
      </div>

      {/* Calendar grid */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="px-2 py-3 border-r border-gray-100 last:border-r-0 text-center">
              <div className="h-4 bg-gray-200 rounded w-8 mx-auto" />
            </div>
          ))}
        </div>

        {/* Calendar cells */}
        {Array.from({ length: 5 }).map((_, row) => (
          <div key={row} className="grid grid-cols-7 border-b border-gray-100 last:border-b-0">
            {Array.from({ length: 7 }).map((_, col) => (
              <div key={col} className="min-h-[80px] p-2 border-r border-gray-100 last:border-r-0 space-y-1">
                <div className="h-4 bg-gray-100 rounded w-6" />
                {(row * 7 + col) % 5 === 0 && (
                  <div className="h-5 bg-gray-200 rounded w-full" />
                )}
                {(row * 7 + col) % 7 === 2 && (
                  <div className="h-5 bg-gray-200 rounded w-3/4" />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
