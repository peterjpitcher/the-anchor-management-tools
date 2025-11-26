import type { InvoiceWithDetails, InvoiceStatus } from '@/types/invoices'
import { Card } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'

interface MobileInvoiceCardProps {
  invoice: InvoiceWithDetails
  onClick?: (invoice: InvoiceWithDetails) => void
}

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const formatCurrency = (value: number) => currencyFormatter.format(value)

export function MobileInvoiceCard({ invoice, onClick }: MobileInvoiceCardProps) {
  const isOverdue = invoice.status === 'overdue'
  const isPaid = invoice.status === 'paid'

  function getStatusBadgeVariant(
    status: InvoiceStatus
  ): 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'secondary' {
    switch (status) {
      case 'draft':
        return 'default'
      case 'sent':
        return 'info'
      case 'partially_paid':
        return 'warning'
      case 'paid':
        return 'success'
      case 'overdue':
        return 'error'
      case 'void':
        return 'secondary'
      case 'written_off':
        return 'secondary'
      default:
        return 'default'
    }
  }

  return (
    <Card 
      className={`p-4 transition-shadow hover:shadow-md ${onClick ? 'cursor-pointer' : ''}`}
      onClick={() => onClick?.(invoice)}
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="flex-1">
          <div className="font-semibold text-gray-900">
            {invoice.invoice_number}
          </div>
          <div className="mt-1 text-sm text-gray-600">
            {invoice.vendor?.name || 'No vendor'}
          </div>
          {invoice.reference && (
            <div className="mt-1 text-xs text-gray-500">
              Ref: {invoice.reference}
            </div>
          )}
        </div>
        <Badge variant={getStatusBadgeVariant(invoice.status)} size="sm">
          {invoice.status.charAt(0).toUpperCase() +
            invoice.status.slice(1).replace('_', ' ')}
        </Badge>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Invoice Date:</span>
          <span className="font-medium">
            {new Date(invoice.invoice_date).toLocaleDateString('en-GB')}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Due Date:</span>
          <span className={`font-medium ${isOverdue ? 'text-red-600' : ''}`}>
            {new Date(invoice.due_date).toLocaleDateString('en-GB')}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t pt-3">
        <div>
          <div className="text-xs text-gray-500">Total Amount</div>
          <div className="text-lg font-semibold">
            {formatCurrency(invoice.total_amount)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">Balance</div>
          {isPaid ? (
            <div className="font-semibold text-green-600">Paid</div>
          ) : (
            <div
              className={`font-semibold ${isOverdue ? 'text-red-600' : ''}`}
            >
              {formatCurrency(invoice.total_amount - invoice.paid_amount)}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
