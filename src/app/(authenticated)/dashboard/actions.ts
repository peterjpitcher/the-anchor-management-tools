'use server'

import { revalidatePath, revalidateTag } from 'next/cache'

export async function refreshDashboard() {
  revalidateTag('dashboard')
  revalidatePath('/dashboard')
}

