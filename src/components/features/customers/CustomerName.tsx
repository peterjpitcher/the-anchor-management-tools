import { CustomerWithLoyalty } from '@/lib/customerUtils'
import { Icon } from '@/ds'

interface CustomerNameProps {
  customer: CustomerWithLoyalty
  showMobile?: boolean
  className?: string
}

export function CustomerName({ customer, showMobile = false, className = '' }: CustomerNameProps) {
  const fullName = [customer.first_name, customer.last_name ?? ''].filter(Boolean).join(' ')
  return (
    <span className={className}>
      {fullName || customer.first_name}
      {showMobile && customer.mobile_number ? ` (${customer.mobile_number})` : ''}
      {customer.isLoyal && (
        <Icon name="star" size={16} className="inline-block ml-1 text-cat-6 fill-current" label="Loyal Customer" />
      )}
    </span>
  )
}
