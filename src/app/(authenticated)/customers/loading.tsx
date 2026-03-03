export default function Loading() {
  return (
    <div className="animate-pulse space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 bg-gray-200 rounded w-32" />
          <div className="h-4 bg-gray-100 rounded w-64" />
        </div>
        <div className="h-9 bg-gray-200 rounded w-36" />
      </div>

      {/* Search card */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="h-9 bg-gray-200 rounded w-full" />
        <div className="flex justify-between items-center">
          <div className="h-4 bg-gray-100 rounded w-40" />
          <div className="h-8 bg-gray-100 rounded w-28" />
        </div>
        <div className="flex gap-2">
          <div className="h-8 bg-gray-200 rounded w-24" />
          <div className="h-8 bg-gray-100 rounded w-32" />
        </div>
      </div>

      {/* Customer table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="border-b border-gray-100 px-4 py-3 bg-gray-50 flex gap-8">
          <div className="h-4 bg-gray-200 rounded w-12" />
          <div className="h-4 bg-gray-200 rounded w-16" />
          <div className="h-4 bg-gray-200 rounded w-28 hidden md:block" />
        </div>
        <div className="divide-y divide-gray-100">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="px-4 py-4 flex items-center gap-4">
              <div className="flex-1 space-y-1.5">
                <div className="h-4 bg-gray-200 rounded w-36" />
                <div className="h-3 bg-gray-100 rounded w-24" />
              </div>
              <div className="space-y-1 hidden sm:block">
                <div className="h-4 bg-gray-100 rounded w-28" />
                <div className="h-3 bg-gray-100 rounded w-36" />
              </div>
              <div className="flex gap-1 hidden md:flex">
                <div className="h-5 bg-gray-100 rounded-full w-16" />
                <div className="h-5 bg-gray-100 rounded-full w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
