'use server'

import { unstable_cache } from 'next/cache'
import { DashboardService } from '@/services/dashboard'

export async function loadDashboardSnapshot() {
  // This function appears to be a placeholder or legacy. 
  // Keeping empty for now as it was in the original file, 
  // or maybe it was intended to warm the cache?
}

// Cache dashboard data for 1 minute
export const getDashboardData = unstable_cache(
  async () => {
    return await DashboardService.getDashboardData();
  },
  ['dashboard-data'],
  {
    revalidate: 60, // Cache for 1 minute
    tags: ['dashboard']
  }
)

// Get activity feed data with caching
export const getActivityFeedData = unstable_cache(
  async (limit: number = 10) => {
    return await DashboardService.getActivityFeedData(limit);
  },
  ['activity-feed'],
  {
    revalidate: 30, // Cache for 30 seconds
    tags: ['activity']
  }
)