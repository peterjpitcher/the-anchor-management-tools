import type { Customer } from '@/types/database'

export type CustomerWithLoyalty = Customer & {
  isLoyal?: boolean
}

export function sortCustomersByLoyalty(customers: CustomerWithLoyalty[]): CustomerWithLoyalty[] {
  return [...customers].sort((a, b) => {
    if (a.isLoyal && !b.isLoyal) return -1
    if (!a.isLoyal && b.isLoyal) return 1
    const nameA = [a.first_name, a.last_name ?? ''].filter(Boolean).join(' ')
    const nameB = [b.first_name, b.last_name ?? ''].filter(Boolean).join(' ')
    return nameA.localeCompare(nameB)
  })
}

