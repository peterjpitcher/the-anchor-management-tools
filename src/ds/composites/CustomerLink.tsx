import Link from 'next/link'
import { cn } from '@/lib/utils'

type CustomerLinkProps = {
  customerId?: string | null
  name?: string | null
  fallback?: string | null
  className?: string
}

export function CustomerLink({ customerId, name, fallback, className }: CustomerLinkProps) {
  const label = (name || fallback || 'Unknown customer').trim()

  if (!customerId) {
    return <span className={className}>{label}</span>
  }

  return (
    <Link
      href={`/customers/${customerId}`}
      className={cn('font-medium text-primary hover:underline', className)}
    >
      {label}
    </Link>
  )
}
