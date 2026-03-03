export default function Loading() {
  return (
    <div className="animate-pulse space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 bg-gray-200 rounded w-32" />
          <div className="h-4 bg-gray-100 rounded w-48" />
        </div>
        <div className="h-9 bg-gray-200 rounded w-32" />
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
            <div className="h-4 bg-gray-100 rounded w-24" />
            <div className="h-7 bg-gray-200 rounded w-20" />
          </div>
        ))}
      </div>

      {/* Filters row */}
      <div className="flex gap-3">
        <div className="h-9 bg-gray-200 rounded w-64" />
        <div className="h-9 bg-gray-200 rounded w-32" />
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="border-b border-gray-100 px-4 py-3 bg-gray-50">
          <div className="h-4 bg-gray-200 rounded w-48" />
        </div>
        <div className="divide-y divide-gray-100">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="px-4 py-4 flex items-center justify-between gap-4">
              <div className="h-4 bg-gray-200 rounded w-24" />
              <div className="h-4 bg-gray-100 rounded w-40 hidden sm:block" />
              <div className="h-4 bg-gray-100 rounded w-24 hidden md:block" />
              <div className="h-5 bg-gray-200 rounded w-16" />
              <div className="h-4 bg-gray-200 rounded w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
