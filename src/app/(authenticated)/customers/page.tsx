'use client'

import { useSupabase } from '@/components/providers/SupabaseProvider'
import { useEffect, useState, useMemo, useCallback } from 'react'
import type { Customer } from '@/types/database'
import { CustomerForm } from '@/components/features/customers/CustomerForm'
import { CustomerImport } from '@/components/features/customers/CustomerImport'
import { CustomerName } from '@/components/features/customers/CustomerName'
import { CustomerLabelDisplay } from '@/components/features/customers/CustomerLabelDisplay'
import { usePermissions } from '@/contexts/PermissionContext'
import { getBulkCustomerLabels } from '@/app/actions/customer-labels-bulk'
import { getUnreadMessageCounts } from '@/app/actions/messageActions'
import type { CustomerLabelAssignment } from '@/app/actions/customer-labels'
import { createCustomer as createCustomerAction, updateCustomer as updateCustomerAction, deleteCustomer as deleteCustomerAction, importCustomers as importCustomersAction } from '@/app/actions/customers'
import Link from 'next/link'
import { ChatBubbleLeftIcon, XCircleIcon, PencilIcon, TrashIcon, PlusIcon } from '@heroicons/react/24/outline'

// Loyalty removed
// New UI components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { Button, IconButton } from '@/components/ui-v2/forms/Button'
import { SearchInput } from '@/components/ui-v2/forms/SearchInput'
import { Badge, BadgeGroup } from '@/components/ui-v2/display/Badge'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Pagination as PaginationV2 } from '@/components/ui-v2/navigation/Pagination'
import { usePagination } from '@/hooks/usePagination'
import { Skeleton } from '@/components/ui-v2/feedback/Skeleton'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'

interface CustomerCategoryStats {
  customer_id: string
  category_id: string
  times_attended: number
  last_attended_date: string
  event_categories: {
    id: string
    name: string
  }
}

type CustomerCategoryStatsQueryRow = {
  customer_id: string
  category_id: string
  times_attended: number
  last_attended_date: string
  event_categories: { id: string; name: string } | { id: string; name: string }[]
}

export default function CustomersPage() {
  const supabase = useSupabase()
  const { hasPermission } = usePermissions()
  const canManageCustomers = hasPermission('customers', 'manage')
  const [searchTerm, setSearchTerm] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  // Loyalty removed: no regulars tracking
  const [customerPreferences, setCustomerPreferences] = useState<Record<string, CustomerCategoryStats[]>>({})
  const [customerLabels, setCustomerLabels] = useState<Record<string, CustomerLabelAssignment[]>>({})
  const [showDeactivated, setShowDeactivated] = useState(false)
  // Loyalty program removed

  // Memoize query configuration to prevent unnecessary re-renders
  const queryConfig = useMemo(() => {
    if (showDeactivated) {
      return {
        select: '*',
        orderBy: { column: 'first_name', ascending: true },
        filters: [{ column: 'sms_opt_in', operator: 'eq' as const, value: false }]
      }
    }

    return {
      select: '*',
      orderBy: { column: 'first_name', ascending: true },
      filters: [],
      or: 'sms_opt_in.is.null,sms_opt_in.eq.true'
    }
  }, [showDeactivated])

  const [customPageSize, setCustomPageSize] = useState(50)
  
  const paginationOptions = useMemo(() => ({
    pageSize: customPageSize === 1000 ? 10000 : customPageSize, // Use a very large number for "All"
    searchTerm: searchTerm,
    searchColumns: ['first_name', 'last_name', 'mobile_number', 'email']
  }), [customPageSize, searchTerm])

  // Use pagination hook with search
  const {
    data: customers,
    currentPage,
    totalPages,
    totalCount,
    pageSize,
    isLoading,
    setPage,
    refresh: loadCustomers
  } = usePagination<Customer>(
    supabase,
    'customers',
    queryConfig,
    paginationOptions
  )

  useEffect(() => {
    setPage(1)
  }, [setPage, showDeactivated])

  // Loyalty removed: no special loading

  // Load customer enrichments (preferences, labels, unread counts)
  useEffect(() => {
    let cancelled = false

    if (!customers || customers.length === 0) {
      setCustomerPreferences({})
      setCustomerLabels({})
      setUnreadCounts({})
      return
    }

    const customerIds = customers.map(c => c.id)

    async function loadCustomerData() {
      const fetchCustomerCategoryStats = async (ids: string[]): Promise<{
        data: CustomerCategoryStatsQueryRow[] | null
        error: unknown
      }> => {
        const { data, error } = await supabase
          .from('customer_category_stats')
          .select(`
              customer_id,
              category_id,
              times_attended,
              last_attended_date,
              event_categories!inner(
                id,
                name
              )
            `)
          .in('customer_id', ids)
          .order('times_attended', { ascending: false })

        return {
          data: data as CustomerCategoryStatsQueryRow[] | null,
          error
        }
      }

      try {
        const [statsResult, labelResult, unreadResult] = await Promise.all([
          fetchCustomerCategoryStats(customerIds),
          getBulkCustomerLabels(customerIds),
          getUnreadMessageCounts()
        ])

        if (cancelled) return

        const { data: stats, error: statsError } = statsResult

        if (statsError) {
          console.error('Error loading customer preferences:', statsError)
          setCustomerPreferences({})
        } else {
          const preferencesByCustomer: Record<string, CustomerCategoryStats[]> = {}
          stats?.forEach((stat) => {
            if (!preferencesByCustomer[stat.customer_id]) {
              preferencesByCustomer[stat.customer_id] = []
            }
            preferencesByCustomer[stat.customer_id].push({
              customer_id: stat.customer_id,
              category_id: stat.category_id,
              times_attended: stat.times_attended,
              last_attended_date: stat.last_attended_date,
              event_categories: Array.isArray(stat.event_categories)
                ? stat.event_categories[0]
                : stat.event_categories
            })
          })
          setCustomerPreferences(preferencesByCustomer)
        }

        if (labelResult.assignments) {
          setCustomerLabels(labelResult.assignments)
        } else if (labelResult.error) {
          console.error('Error loading label assignments:', labelResult.error)
          setCustomerLabels({})
        }

        const unreadCountsMap = (unreadResult && typeof unreadResult === 'object')
          ? unreadResult as Record<string, number>
          : {}
        const relevantUnread = customerIds.reduce<Record<string, number>>((acc, id) => {
          acc[id] = unreadCountsMap[id] ?? 0
          return acc
        }, {})
        setUnreadCounts(relevantUnread)
      } catch (error) {
        if (!cancelled) {
          console.error('Error loading customer data:', error)
        }
      }
    }

    loadCustomerData()

    return () => {
      cancelled = true
    }
  }, [customers, supabase])

  // Process customers with loyalty status and apply filter
  const visibleCustomers = useMemo(() => customers ?? [], [customers])

  const handleCreateCustomer = useCallback(async (
    customerData: Omit<Customer, 'id' | 'created_at'>
  ) => {
    if (!canManageCustomers) {
      toast.error('You do not have permission to manage customers.')
      return
    }
    try {
      const formData = new FormData()
      formData.append('first_name', customerData.first_name)
      formData.append('last_name', customerData.last_name ?? '')
      formData.append('mobile_number', customerData.mobile_number ?? '')
      if (customerData.email) {
        formData.append('email', customerData.email)
      }
      formData.append('sms_opt_in', 'on')

      const result = await createCustomerAction(formData)

      if ('error' in result && result.error) {
        toast.error(typeof result.error === 'string' ? result.error : 'Failed to create customer')
        return
      }

      toast.success('Customer created successfully')
      setShowForm(false)
      await loadCustomers()
    } catch (error) {
      console.error('Error creating customer:', error)
      toast.error('Failed to create customer')
    }
  }, [canManageCustomers, loadCustomers])

  const handleUpdateCustomer = useCallback(async (
    customerData: Omit<Customer, 'id' | 'created_at'>
  ) => {
    if (!editingCustomer) return
    if (!canManageCustomers) {
      toast.error('You do not have permission to manage customers.')
      return
    }

    try {
      const formData = new FormData()
      formData.append('first_name', customerData.first_name)
      formData.append('last_name', customerData.last_name ?? '')
      formData.append('mobile_number', customerData.mobile_number ?? '')
      if (customerData.email) {
        formData.append('email', customerData.email)
      }
      formData.append('sms_opt_in', 'on')

      const result = await updateCustomerAction(editingCustomer.id, formData)

      if ('error' in result && result.error) {
        toast.error(typeof result.error === 'string' ? result.error : 'Failed to update customer')
        return
      }

      toast.success('Customer updated successfully')
      setEditingCustomer(null)
      setShowForm(false)
      await loadCustomers()
    } catch (error) {
      console.error('Error updating customer:', error)
      toast.error('Failed to update customer')
    }
  }, [canManageCustomers, editingCustomer, loadCustomers])

  const handleDeleteCustomer = useCallback(async (customer: Customer) => {
    if (!canManageCustomers) {
      toast.error('You do not have permission to manage customers.')
      return
    }
    const confirmMessage =
      'Are you sure you want to delete this customer? This will also delete all their bookings.'
    if (!window.confirm(confirmMessage)) return

    try {
      const result = await deleteCustomerAction(customer.id)
      if ('error' in result && result.error) {
        throw new Error(result.error)
      }
      toast.success('Customer deleted successfully')
      await loadCustomers()
    } catch (error) {
      console.error('Error deleting customer:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to delete customer')
    }
  }, [canManageCustomers, loadCustomers])

  const handleImportCustomers = useCallback(async (customersData: Omit<Customer, 'id' | 'created_at'>[]) => {
    if (!canManageCustomers) {
      toast.error('You do not have permission to manage customers.')
      return
    }
    try {
      const result = await importCustomersAction(
        customersData.map((c) => ({
          first_name: c.first_name,
          last_name: c.last_name ?? '',
          mobile_number: c.mobile_number ?? '',
          email: c.email ?? undefined
        }))
      )

      if ('error' in result && result.error) {
        const message = typeof result.error === 'string' ? result.error : 'Failed to import customers'
        toast.error(message)
        return
      }

      if (!('success' in result) || !result.success) {
        toast.error('Failed to import customers')
        return
      }

      const skippedTotal = (result.skippedInvalid ?? 0) + (result.skippedDuplicateInFile ?? 0) + (result.skippedExisting ?? 0)
      let successMessage = `Imported ${result.created ?? 0} customers`
      if (skippedTotal > 0) {
        successMessage += ` (${skippedTotal} skipped)`
      }

      toast.success(successMessage)
      setShowImport(false)
      await loadCustomers()
    } catch (error) {
      console.error('Error importing customers:', error)
      toast.error('Failed to import customers')
    }
  }, [canManageCustomers, loadCustomers])

  const openCreateCustomer = useCallback(() => {
    if (!canManageCustomers) {
      toast.error('You do not have permission to manage customers.')
      return
    }
    setEditingCustomer(null)
    setShowForm(true)
  }, [canManageCustomers])

  const openImportCustomers = useCallback(() => {
    if (!canManageCustomers) {
      toast.error('You do not have permission to manage customers.')
      return
    }
    setShowImport(true)
  }, [canManageCustomers])

  const startEditCustomer = useCallback((customer: Customer) => {
    if (!canManageCustomers) {
      toast.error('You do not have permission to manage customers.')
      return
    }
    setEditingCustomer(customer)
    setShowForm(true)
  }, [canManageCustomers])

  const desktopColumns = useMemo(() => {
    const baseColumns = [
      {
        key: 'name',
        header: 'Name',
        cell: (customer: Customer) => (
          <div className="space-y-2">
            <div className="flex items-center">
              <div className="font-medium text-gray-900">
                <Link href={`/customers/${customer.id}`} className="text-blue-600 hover:text-blue-700">
                  <CustomerName customer={customer} />
                </Link>
                {unreadCounts[customer.id] > 0 && (
                  <Badge variant="primary" size="sm" className="ml-2">
                    <ChatBubbleLeftIcon className="h-3 w-3 mr-1" />
                    {unreadCounts[customer.id]}
                  </Badge>
                )}
              </div>
            </div>
            <CustomerLabelDisplay assignments={customerLabels[customer.id] || []} />
          </div>
        )
      },
      {
        key: 'mobile',
        header: 'Mobile',
        cell: (customer: Customer) => (
          <div className="space-y-1">
            {customer.mobile_number ? (
              <a href={`tel:${customer.mobile_number}`} className="text-blue-600 hover:text-blue-700">
                {customer.mobile_number}
              </a>
            ) : (
              '-'
            )}
            {customer.email && (
              <div className="text-sm text-gray-500">
                {customer.email}
              </div>
            )}
            {customer.mobile_number && customer.sms_opt_in === false && (
              <Badge
                variant="error"
                size="sm"
                icon={<XCircleIcon className="h-3 w-3" />}
              >
                SMS Deactivated
              </Badge>
            )}
          </div>
        )
      },
      {
        key: 'event_preferences',
        header: 'Event Preferences',
        cell: (customer: Customer) => {
          if (customerPreferences[customer.id] && customerPreferences[customer.id].length > 0) {
            return (
              <BadgeGroup>
                {customerPreferences[customer.id].slice(0, 3).map((pref) => (
                  <Badge
                    key={pref.category_id}
                    variant="success"
                    size="sm"
                    title={`Attended ${pref.times_attended} times`}
                  >
                    {pref.event_categories.name}
                    {pref.times_attended > 1 && (
                      <span className="ml-1">×{pref.times_attended}</span>
                    )}
                  </Badge>
                ))}
                {customerPreferences[customer.id].length > 3 && (
                  <span className="text-xs text-gray-500">
                    +{customerPreferences[customer.id].length - 3} more
                  </span>
                )}
              </BadgeGroup>
            )
          }
          return <span className="text-gray-400">No preferences yet</span>
        }
      }
    ] as const

    if (!canManageCustomers) {
      return [...baseColumns]
    }

    return [
      ...baseColumns,
      {
        key: 'actions',
        header: '',
        cell: (customer: Customer) => (
          <div className="flex items-center justify-end space-x-2">
            <IconButton
              onClick={() => startEditCustomer(customer)}
              aria-label="Edit customer"
            >
              <PencilIcon className="h-4 w-4" />
            </IconButton>
            <IconButton
              variant="danger"
              onClick={() => handleDeleteCustomer(customer)}
              aria-label="Delete customer"
            >
              <TrashIcon className="h-4 w-4" />
            </IconButton>
          </div>
        )
      }
    ]
  }, [canManageCustomers, customerLabels, customerPreferences, handleDeleteCustomer, startEditCustomer, unreadCounts])

  if (showForm || editingCustomer) {
    return (
      <PageLayout
        title={editingCustomer ? 'Edit Customer' : 'Create New Customer'}
        backButton={{
          label: 'Back to Customers',
          onBack: () => {
            setShowForm(false)
            setEditingCustomer(null)
          },
        }}
        containerSize="lg"
      >
        <Card>
          <CustomerForm
            customer={editingCustomer ?? undefined}
            onSubmit={editingCustomer ? handleUpdateCustomer : handleCreateCustomer}
            onCancel={() => {
              setShowForm(false)
              setEditingCustomer(null)
            }}
          />
        </Card>
      </PageLayout>
    )
  }

  if (showImport) {
    return (
      <PageLayout
        title="Import Customers"
        subtitle="Import multiple customers from a CSV file"
        backButton={{
          label: 'Back to Customers',
          onBack: () => setShowImport(false),
        }}
        containerSize="lg"
      >
        <CustomerImport
          onImportComplete={handleImportCustomers}
          onCancel={() => setShowImport(false)}
          existingCustomers={customers ?? []}
        />
      </PageLayout>
    )
  }

  const navItems: HeaderNavItem[] = canManageCustomers
    ? [
        { label: 'Manage Labels', href: '/settings/customer-labels' },
        { label: 'Import', onClick: openImportCustomers },
        { label: 'Add Customer', onClick: openCreateCustomer },
      ]
    : []

  const navActions = (
    <div className="flex items-center gap-2">
      {canManageCustomers && (
        <Button onClick={openCreateCustomer} size="sm">
          <PlusIcon className="h-4 w-4 mr-2" />
          Add Customer
        </Button>
      )}
    </div>
  )

  return (
    <PageLayout
      title="Customers"
      subtitle="Manage your customer database and segments"
      navItems={navItems}
      navActions={navActions}
    >
      <Card>
        <div className="space-y-4">
          <div className="flex flex-col gap-4">
            <SearchInput
              placeholder="Search customers by name or phone..."
              onSearch={setSearchTerm}
              debounceDelay={300}
              className="w-full"
            />
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 sm:items-center sm:justify-between">
              <div className="text-sm text-gray-600">
                {searchTerm && (
                  <span>Searching for &quot;{searchTerm}&quot; - Found {visibleCustomers.length} customers</span>
                )}
                {!searchTerm && totalCount > 0 && (
                  <span>
                    Showing {customPageSize === 1000 ? visibleCustomers.length : Math.min(visibleCustomers.length, customPageSize)} of {totalCount} customers
                  </span>
                )}
              </div>
              <select
                value={customPageSize}
                onChange={(e) => setCustomPageSize(Number(e.target.value))}
                className="rounded-md border-gray-300 text-sm focus:border-green-500 focus:ring-green-500 py-2 px-3"
              >
                <option value={50}>50 per page</option>
                <option value={100}>100 per page</option>
                <option value={200}>200 per page</option>
                <option value={500}>500 per page</option>
                <option value={1000}>All customers</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant={showDeactivated ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => setShowDeactivated(false)}
            >
              SMS Active
            </Button>
            <Button
              variant={showDeactivated ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setShowDeactivated(true)}
            >
              SMS Deactivated
            </Button>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <Card>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </Card>
      ) : visibleCustomers.length === 0 ? (
        <Card>
          <EmptyState
            title="No customers found"
            description="Adjust your search or add a new customer."
            action={canManageCustomers ? (
              <Button onClick={openCreateCustomer}>
                <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
                Add Customer
              </Button>
            ) : undefined}
          />
        </Card>
      ) : (
        <>
          {/* Desktop view with DataTable component */}
          <div className="hidden md:block">
            <Card>
              <DataTable
                data={visibleCustomers}
                getRowKey={(customer) => customer.id}
                columns={desktopColumns}
              />
            </Card>
          </div>
          
          {/* Mobile view */}
          <div className="block md:hidden">
            <Card className="divide-y divide-gray-200">
              {visibleCustomers.map(customer => (
                <div key={customer.id} className="px-4 py-4 sm:px-6 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <Link href={`/customers/${customer.id}`} className="block hover:bg-gray-50 flex-1 min-w-0">
                      <div className="flex items-center">
                        <p className="text-base sm:text-sm font-medium text-blue-600 truncate">
                          <CustomerName customer={customer} />
                        </p>
                        {unreadCounts[customer.id] > 0 && (
                          <Badge variant="primary" size="sm" className="ml-2">
                            <ChatBubbleLeftIcon className="h-3 w-3 mr-1" />
                            {unreadCounts[customer.id]}
                          </Badge>
                        )}
                      </div>
                    </Link>
                    {canManageCustomers && (
                      <div className="ml-2 flex-shrink-0 flex space-x-2">
                        <IconButton
                          onClick={() => startEditCustomer(customer)}
                          aria-label="Edit customer"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          variant="danger"
                          onClick={() => handleDeleteCustomer(customer)}
                          aria-label="Delete customer"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </IconButton>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 sm:flex sm:justify-between">
                    <div className="sm:flex space-y-1">
                      <div>
                        <p className="flex items-center text-sm text-gray-500">
                          {customer.mobile_number ? (
                            <a href={`tel:${customer.mobile_number}`} className="text-blue-600 hover:text-blue-700">
                              {customer.mobile_number}
                            </a>
                          ) : (
                            'No mobile'
                          )}
                        </p>
                        {customer.email && (
                          <p className="text-xs sm:text-sm text-gray-500">
                            {customer.email}
                          </p>
                        )}
                        {customer.mobile_number && customer.sms_opt_in === false && (
                          <Badge 
                            variant="error" 
                            size="sm" 
                            className="mt-1"
                            icon={<XCircleIcon className="h-3 w-3" />}
                          >
                            SMS Deactivated
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Loyalty removed */}
                  {customerPreferences[customer.id] && customerPreferences[customer.id].length > 0 && (
                    <div className="mt-2">
                      <BadgeGroup>
                        {customerPreferences[customer.id].slice(0, 2).map((pref) => (
                          <Badge
                            key={pref.category_id}
                            variant="success"
                            size="sm"
                            title={`Attended ${pref.times_attended} times`}
                          >
                            {pref.event_categories.name}
                            {pref.times_attended > 1 && (
                              <span className="ml-1">×{pref.times_attended}</span>
                            )}
                          </Badge>
                        ))}
                        {customerPreferences[customer.id].length > 2 && (
                          <span className="text-xs text-gray-500">
                            +{customerPreferences[customer.id].length - 2}
                          </span>
                        )}
                      </BadgeGroup>
                    </div>
                  )}
                  <div className="mt-2">
                    <CustomerLabelDisplay assignments={customerLabels[customer.id] || []} />
                  </div>
                </div>
              ))}
            </Card>
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <PaginationV2
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalCount}
              itemsPerPage={pageSize}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </PageLayout>
  )
}
