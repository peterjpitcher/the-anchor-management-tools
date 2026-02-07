'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { usePermissions } from '@/contexts/PermissionContext'
import type { Customer, Message } from '@/types/database'
import { toggleCustomerSmsOptIn, getCustomerMessages, getCustomerSmsStats } from '@/app/actions/customerSmsActions'
import { markMessagesAsRead } from '@/app/actions/messageActions'
import { updateCustomer as updateCustomerAction } from '@/app/actions/customers'
import { getCustomerLabelAssignments, getCustomerLabels, type CustomerLabel, type CustomerLabelAssignment } from '@/app/actions/customer-labels'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card, CardDescription, CardTitle } from '@/components/ui-v2/layout/Card'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Button } from '@/components/ui-v2/forms/Button'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup'
import { NavLink } from '@/components/ui-v2/navigation/NavLink'
import { MessageThread } from '@/components/features/messages/MessageThread'
import { CustomerForm } from '@/components/features/customers/CustomerForm'
import { CustomerLabelSelector } from '@/components/features/customers/CustomerLabelSelector'

export const dynamic = 'force-dynamic'
const CUSTOMER_DETAIL_SELECT = `
  id,
  first_name,
  last_name,
  email,
  mobile_number,
  created_at,
  sms_opt_in,
  sms_delivery_failures,
  last_sms_failure_reason,
  last_successful_sms_at,
  sms_deactivated_at,
  sms_deactivation_reason
`

export default function CustomerViewPage() {
  const params = useParams<{ id: string }>()
  const customerId = params.id
  const supabase = useSupabase()
  const router = useRouter()
  const { hasPermission } = usePermissions()

  const canViewMessages = hasPermission('messages', 'view')
  const canManageCustomers = hasPermission('customers', 'manage')

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loading, setLoading] = useState(true)
  const [togglingSmsSetting, setTogglingSmsSetting] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [smsStats, setSmsStats] = useState<{
    customer: {
      sms_opt_in: boolean
      sms_delivery_failures: number
      last_sms_failure_reason: string | null
      last_successful_sms_at: string | null
      sms_deactivated_at: string | null
      sms_deactivation_reason: string | null
    }
    stats: {
      totalMessages: number
      deliveredMessages: number
      failedMessages: number
      deliveryRate: string
    }
  } | null>(null)

  const [availableLabels, setAvailableLabels] = useState<CustomerLabel[]>([])
  const [customerLabelAssignments, setCustomerLabelAssignments] = useState<CustomerLabelAssignment[]>([])
  const [isEditingCustomer, setIsEditingCustomer] = useState(false)

  const loadMessages = useCallback(async () => {
    if (!customerId) return

    setMessagesLoading(true)
    try {
      const messagesResult = await getCustomerMessages(customerId)
      if ('error' in messagesResult) {
        console.error('Failed to load messages:', messagesResult.error)
        toast.error('Failed to load messages')
        return
      }

      setMessages(messagesResult.messages)

      if (canViewMessages) {
        const hasUnreadInbound = messagesResult.messages.some(
          (message) => message.direction === 'inbound' && !message.read_at
        )
        if (hasUnreadInbound) {
          await markMessagesAsRead(customerId)
        }
      }
    } catch (error) {
      console.error('Error loading messages:', error)
      toast.error('Failed to load messages')
    } finally {
      setMessagesLoading(false)
    }
  }, [canViewMessages, customerId])

  const loadData = useCallback(async () => {
    if (!customerId) return

    setLoading(true)
    try {
      const [
        { data: customerData, error: customerError },
        smsStatsResult,
        customerLabelsResult,
        customerAssignmentsResult,
      ] = await Promise.all([
        supabase
          .from('customers')
          .select(CUSTOMER_DETAIL_SELECT)
          .eq('id', customerId)
          .single(),
        getCustomerSmsStats(customerId),
        getCustomerLabels(),
        getCustomerLabelAssignments(customerId),
      ])

      if (customerError) {
        throw customerError
      }
      if (!customerData) {
        throw new Error('Customer not found')
      }
      setCustomer(customerData)

      if ('error' in smsStatsResult) {
        console.error('Failed to load SMS stats:', smsStatsResult.error)
      } else {
        setSmsStats(smsStatsResult)
      }

      if (customerLabelsResult.data) {
        setAvailableLabels(customerLabelsResult.data)
      } else if (customerLabelsResult.error) {
        console.error('Failed to load customer labels:', customerLabelsResult.error)
        setAvailableLabels([])
      }

      if (customerAssignmentsResult.data) {
        setCustomerLabelAssignments(customerAssignmentsResult.data)
      } else if (customerAssignmentsResult.error) {
        console.error('Failed to load customer label assignments:', customerAssignmentsResult.error)
        setCustomerLabelAssignments([])
      }

      await loadMessages()
    } catch (error) {
      console.error('Error loading customer details:', error)
      toast.error('Failed to load customer details.')
    } finally {
      setLoading(false)
    }
  }, [customerId, loadMessages, supabase])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleToggleSms = async () => {
    if (!customer) return

    setTogglingSmsSetting(true)
    const newOptIn = customer.sms_opt_in === false
    const result = await toggleCustomerSmsOptIn(customer.id, newOptIn)

    if ('error' in result) {
      toast.error(`Failed to update SMS settings: ${result.error}`)
      setTogglingSmsSetting(false)
      return
    }

    toast.success(`SMS ${newOptIn ? 'activated' : 'deactivated'} for customer`)
    setCustomer({ ...customer, sms_opt_in: newOptIn })

    const stats = await getCustomerSmsStats(customer.id)
    if (!('error' in stats)) {
      setSmsStats(stats)
    }

    setTogglingSmsSetting(false)
  }

  const handleUpdateCustomer = async (data: Omit<Customer, 'id' | 'created_at'>) => {
    if (!customer) return

    try {
      const formData = new FormData()
      formData.append('first_name', data.first_name)
      if (data.last_name) formData.append('last_name', data.last_name)
      if (data.email) formData.append('email', data.email)
      if (data.mobile_number) formData.append('mobile_number', data.mobile_number)
      if (customer.sms_opt_in) formData.append('sms_opt_in', 'on')

      const result = await updateCustomerAction(customer.id, formData)

      if (result.error) {
        toast.error(result.error)
        return
      }

      toast.success('Customer updated successfully')
      setIsEditingCustomer(false)
      await loadData()
    } catch (error) {
      console.error('Error updating customer:', error)
      toast.error('Failed to update customer')
    }
  }

  if (loading) {
    return (
      <PageLayout
        title="Customer Details"
        subtitle="Loading customer information"
        backButton={{ label: 'Back to Customers', href: '/customers' }}
        loading
        loadingLabel="Loading customer..."
      >
        {null}
      </PageLayout>
    )
  }

  if (!customer) {
    return (
      <PageLayout
        title="Customer Details"
        subtitle="Customer not found"
        backButton={{ label: 'Back to Customers', href: '/customers' }}
        error="The requested customer could not be found."
      >
        {null}
      </PageLayout>
    )
  }

  const customerName = `${customer.first_name} ${customer.last_name || ''}`.trim()

  const navActions = (
    <NavGroup>
      {canManageCustomers && (
        <NavLink onClick={() => setIsEditingCustomer(true)}>
          Edit Details
        </NavLink>
      )}
    </NavGroup>
  )

  return (
    <PageLayout
      title={customerName}
      subtitle={customer.mobile_number || 'No mobile number'}
      backButton={{ label: 'Back to Customers', href: '/customers' }}
      navActions={navActions}
    >
      <div className="space-y-6">
        <Modal
          open={isEditingCustomer}
          onClose={() => setIsEditingCustomer(false)}
          title="Edit Customer Details"
        >
          <CustomerForm
            customer={customer}
            onSubmit={handleUpdateCustomer}
            onCancel={() => setIsEditingCustomer(false)}
          />
        </Modal>

        <div className="grid gap-6 xl:grid-cols-3">
          <Card
            className="xl:col-span-2"
            header={
              <div className="flex items-center justify-between">
                <CardTitle>Messages</CardTitle>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={loadMessages}
                  disabled={messagesLoading}
                >
                  {messagesLoading ? 'Refreshing…' : 'Refresh'}
                </Button>
              </div>
            }
          >
            <MessageThread
              messages={messages}
              customerId={customer.id}
              customerName={customerName}
              canReply={customer.sms_opt_in !== false}
              onMessageSent={async () => {
                await loadMessages()
              }}
            />
          </Card>

          <div className="space-y-6">
            <Card>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <ChatBubbleLeftRightIcon className="h-5 w-5 text-gray-400" />
                  <span
                    className={`text-sm font-medium ${customer.sms_opt_in !== false ? 'text-green-600' : 'text-red-600'}`}
                  >
                    SMS {customer.sms_opt_in !== false ? 'Active' : 'Inactive'}
                  </span>
                </div>
                {customer.sms_delivery_failures && customer.sms_delivery_failures > 0 && (
                  <span className="text-sm text-orange-600">
                    {customer.sms_delivery_failures} failed deliveries
                  </span>
                )}
              </div>
            </Card>

            {hasPermission('customers', 'manage') && (
              <Card header={<CardTitle>Customer Labels</CardTitle>}>
                <CustomerLabelSelector
                  customerId={customer.id}
                  canEdit
                  initialLabels={availableLabels}
                  initialAssignments={customerLabelAssignments}
                  onLabelsChange={(updatedAssignments) => {
                    setCustomerLabelAssignments(updatedAssignments)
                  }}
                />
              </Card>
            )}

            <Card
              header={
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle>SMS Messaging Status</CardTitle>
                    <CardDescription>
                      Control whether this customer receives SMS notifications and replies.
                    </CardDescription>
                  </div>
                  <Button
                    onClick={handleToggleSms}
                    disabled={togglingSmsSetting}
                    variant={customer.sms_opt_in !== false ? 'secondary' : 'primary'}
                    size="sm"
                  >
                    {togglingSmsSetting
                      ? 'Updating...'
                      : customer.sms_opt_in !== false
                        ? 'Deactivate SMS'
                        : 'Activate SMS'}
                  </Button>
                </div>
              }
            >
              {smsStats && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Total Messages</dt>
                    <dd className="mt-1 text-sm text-gray-900">{smsStats.stats?.totalMessages || 0}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Delivered</dt>
                    <dd className="mt-1 text-sm text-gray-900">{smsStats.stats?.deliveredMessages || 0}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Failed</dt>
                    <dd className="mt-1 text-sm text-gray-900">{smsStats.stats?.failedMessages || 0}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Delivery Rate</dt>
                    <dd className="mt-1 text-sm text-gray-900">{smsStats.stats?.deliveryRate || 0}%</dd>
                  </div>
                </div>
              )}

              {customer.sms_deactivation_reason && (
                <Alert variant="error" title="Auto-deactivated" className="mt-4">
                  {customer.sms_deactivation_reason}
                  {customer.last_sms_failure_reason && (
                    <p className="mt-1 text-sm text-red-700">
                      Last error: {customer.last_sms_failure_reason}
                    </p>
                  )}
                </Alert>
              )}
            </Card>
          </div>
        </div>
      </div>
    </PageLayout>
  )
}
