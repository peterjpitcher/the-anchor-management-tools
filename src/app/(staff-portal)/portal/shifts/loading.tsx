export default function Loading() {
  return (
    <div className="animate-pulse space-y-5">
      {/* Page heading */}
      <div className="space-y-1">
        <div className="h-6 bg-gray-200 rounded w-28" />
        <div className="h-4 bg-gray-100 rounded w-64" />
      </div>

      {/* Calendar subscribe button area */}
      <div className="h-9 bg-gray-200 rounded w-48" />

      {/* Shift cards */}
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Date header */}
          <div className="px-4 py-2 border-b bg-gray-50 border-gray-100">
            <div className="h-4 bg-gray-200 rounded w-24" />
          </div>
          {/* Shift rows */}
          <div className="divide-y divide-gray-50">
            {Array.from({ length: i === 0 ? 2 : 1 }).map((_, j) => (
              <div key={j} className="px-4 py-3 flex items-center justify-between">
                <div className="space-y-1.5">
                  <div className="h-4 bg-gray-200 rounded w-32" />
                  <div className="flex items-center gap-2">
                    <div className="h-4 bg-gray-100 rounded w-12" />
                    <div className="h-3 bg-gray-100 rounded w-16" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
