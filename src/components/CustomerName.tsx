import { StarIcon } from '@heroicons/react/24/solid'
import { CustomerWithLoyalty } from '@/lib/customerUtils'

interface CustomerNameProps {
  customer: CustomerWithLoyalty
  showMobile?: boolean
  className?: string
}

export function CustomerName({ customer, showMobile = false, className = '' }: CustomerNameProps) {
  return (
    <span className={className}>
      {customer.first_name} {customer.last_name}
      {showMobile && ` (${customer.mobile_number})`}
      {customer.isLoyal && (
        <StarIcon className="inline-block h-4 w-4 ml-1 text-yellow-500" aria-label="Loyal Customer" />
      )}
    </span>
  )
} 