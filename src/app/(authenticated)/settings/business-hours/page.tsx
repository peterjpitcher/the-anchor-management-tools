import { Suspense } from 'react'
import { BusinessHoursManager } from './BusinessHoursManager'
import { SpecialHoursManager } from './SpecialHoursManager'

export default function BusinessHoursPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Business Hours</h1>
        <p className="mt-1 text-xs sm:text-sm text-gray-600">
          Manage your regular opening hours and special dates
        </p>
      </div>

      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-3 py-4 sm:px-4 sm:py-5 lg:p-6">
          <h2 className="text-base sm:text-lg font-medium text-gray-900 mb-3 sm:mb-4">Regular Hours</h2>
          <Suspense fallback={<div>Loading...</div>}>
            <BusinessHoursManager />
          </Suspense>
        </div>
      </div>

      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-3 py-4 sm:px-4 sm:py-5 lg:p-6">
          <h2 className="text-base sm:text-lg font-medium text-gray-900 mb-3 sm:mb-4">Special Hours & Holidays</h2>
          <Suspense fallback={<div>Loading...</div>}>
            <SpecialHoursManager />
          </Suspense>
        </div>
      </div>
    </div>
  )
}