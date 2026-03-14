'use client'

import { useEffect, useState, useMemo, useCallback, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import type { Customer } from '@/types/database'
import { CustomerForm } from '@/components/features/customers/CustomerForm'
import { CustomerImport } from '@/components/features/customers/CustomerImport'
import { CustomerName } from '@/components/features/customers/CustomerName'
import { CustomerLabelDisplay } from '@/components/features/customers/CustomerLabelDisplay'
import type { CustomerLabelAssignment } from '@/app/actions/customer-labels'
import type { CustomerCategoryStats, CustomerListResult } from '@/app/actions/customers'
import {
  createCustomer as createCustomerAction,
  updateCustomer as updateCustomerAction,
  deleteCustomer as deleteCustomerAction,
  importCustomers as importCustomersAction,
  getCustomerList,
} from '@/app/actions/customers'
import Link from 'next/link'
import {
  ChatBubbleLeftIcon,
  XCircleIcon,
  PencilIcon,
  TrashIcon,
  PlusIcon,
} from '@heroicons/react/24/outline'

import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { Button, IconButton } from '@/components/ui-v2/forms/Button'
import { SearchInput } from '@/components/ui-v2/forms/SearchInput'
import { Select } from '@/components/ui-v2/forms/Select'
import { Badge, BadgeGroup } from '@/components/ui-v2/display/Badge'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Pagination as PaginationV2 } from '@/components/ui-v2/navigation/Pagination'
import { Skeleton } from '@/components/ui-v2/feedback/Skeleton'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CustomersClientProps {
  initialData: CustomerListResult
  initialPage: number
  initialPageSize: number
  initialSearch: string
  initialShowDeactivated: boolean
  canManageCustomers: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CustomersClient({
  initialData,
  initialPage,
  initialPageSize,
  initialSearch,
  initialShowDeactivated,
  canManageCustomers,
}: CustomersClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // -------------------------------------------------------------------------
  // Local state — the server hydrated values are the initial state
  // -------------------------------------------------------------------------

  const [customers, setCustomers] = useState<Customer[]>(initialData.customers)
  const [totalCount, setTotalCount] = useState(initialData.totalCount)
  const [customerPreferences, setCustomerPreferences] = useState<
    Record<string, CustomerCategoryStats[]>
  >(initialData.customerPreferences)
  const [customerLabels, setCustomerLabels] = useState<
    Record<string, CustomerLabelAssignment[]>
  >(initialData.customerLabels)
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>(
    initialData.unreadCounts
  )

  const [searchTerm, setSearchTerm] = useState(initialSearch)
  const [currentPage, setCurrentPage] = useState(initialPage)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [showDeactivated, setShowDeactivated] = useState(initialShowDeactivated)

  // Form / UI state
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null)

  // Loading state for subsequent (non-initial) fetches
  const [isFetching, setIsFetching] = useState(false)
  const [, startTransition] = useTransition()

  // -------------------------------------------------------------------------
  // URL sync helper — keeps search params in sync with local state
  // -------------------------------------------------------------------------

  const pushParams = useCallback(
    (updates: {
      page?: number
      search?: string
      deactivated?: boolean
      size?: number
    }) => {
      const params = new URLSearchParams(searchParams.toString())
      if (updates.page !== undefined) {
        if (updates.page <= 1) params.delete('page')
        else params.set('page', String(updates.page))
      }
      if (updates.search !== undefined) {
        if (updates.search === '') params.delete('search')
        else params.set('search', updates.search)
      }
      if (updates.deactivated !== undefined) {
        if (!updates.deactivated) params.delete('deactivated')
        else params.set('deactivated', '1')
      }
      if (updates.size !== undefined) {
        if (updates.size === 50) params.delete('size')
        else params.set('size', String(updates.size))
      }
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false })
      })
    },
    [pathname, router, searchParams]
  )

  // -------------------------------------------------------------------------
  // Data fetching — called whenever filters / pagination change
  // -------------------------------------------------------------------------

  const fetchPage = useCallback(
    async (opts: {
      page: number
      size: number
      search: string
      deactivated: boolean
    }) => {
      setIsFetching(true)
      try {
        const result = await getCustomerList({
          page: opts.page,
          pageSize: opts.size,
          searchTerm: opts.search,
          showDeactivated: opts.deactivated,
        })
        setCustomers(result.customers)
        setTotalCount(result.totalCount)
        setCustomerPreferences(result.customerPreferences)
        setCustomerLabels(result.customerLabels)
        setUnreadCounts(result.unreadCounts)
        if (result.error) {
          toast.error(result.error)
        }
      } catch (err) {
        console.error('Error fetching customers:', err)
        toast.error('Failed to load customers')
      } finally {
        setIsFetching(false)
      }
    },
    []
  )

  // Re-fetch whenever filters change (skip on initial mount — server already fetched)
  const isFirstMount = useMemo(() => ({ value: true }), [])
  useEffect(() => {
    if (isFirstMount.value) {
      isFirstMount.value = false
      return
    }
    fetchPage({ page: currentPage, size: pageSize, search: searchTerm, deactivated: showDeactivated })
  }, [currentPage, fetchPage, isFirstMount, pageSize, searchTerm, showDeactivated])

  // -------------------------------------------------------------------------
  // Filter handlers
  // -------------------------------------------------------------------------

  const handleSearch = useCallback(
    (term: string) => {
      setSearchTerm(term)
      setCurrentPage(1)
      pushParams({ search: term, page: 1 })
    },
    [pushParams]
  )

  const handlePageChange = useCallback(
    (page: number) => {
      setCurrentPage(page)
      pushParams({ page })
    },
    [pushParams]
  )

  const handlePageSizeChange = useCallback(
    (size: number) => {
      setPageSize(size)
      setCurrentPage(1)
      pushParams({ size, page: 1 })
    },
    [pushParams]
  )

  const handleFilterChange = useCallback(
    (deactivated: boolean) => {
      setShowDeactivated(deactivated)
      setCurrentPage(1)
      pushParams({ deactivated, page: 1 })
    },
    [pushParams]
  )

  // After a mutation, re-fetch the current page
  const refreshCurrentPage = useCallback(() => {
    fetchPage({
      page: currentPage,
      size: pageSize,
      search: searchTerm,
      deactivated: showDeactivated,
    })
  }, [currentPage, fetchPage, pageSize, searchTerm, showDeactivated])

  const totalPages = Math.ceil(totalCount / pageSize)

  // -------------------------------------------------------------------------
  // CRUD handlers
  // -------------------------------------------------------------------------

  const handleCreateCustomer = useCallback(
    async (customerData: Omit<Customer, 'id' | 'created_at'>) => {
      if (!canManageCustomers) {
        toast.error('You do not have permission to manage customers.')
        return
      }
      try {
        const formData = new FormData()
        formData.append('first_name', customerData.first_name)
        formData.append('last_name', customerData.last_name ?? '')
        formData.append('mobile_number', customerData.mobile_number ?? '')
        formData.append('default_country_code', '44')
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
        refreshCurrentPage()
      } catch (error) {
        console.error('Error creating customer:', error)
        toast.error('Failed to create customer')
      }
    },
    [canManageCustomers, refreshCurrentPage]
  )

  const handleUpdateCustomer = useCallback(
    async (customerData: Omit<Customer, 'id' | 'created_at'>) => {
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
        formData.append('default_country_code', '44')
        if (customerData.email) {
          formData.append('email', customerData.email)
        }
        formData.append('sms_opt_in', editingCustomer.sms_opt_in !== false ? 'on' : 'off')

        const result = await updateCustomerAction(editingCustomer.id, formData)

        if ('error' in result && result.error) {
          toast.error(typeof result.error === 'string' ? result.error : 'Failed to update customer')
          return
        }

        toast.success('Customer updated successfully')
        setEditingCustomer(null)
        setShowForm(false)
        refreshCurrentPage()
      } catch (error) {
        console.error('Error updating customer:', error)
        toast.error('Failed to update customer')
      }
    },
    [canManageCustomers, editingCustomer, refreshCurrentPage]
  )

  const handleDeleteCustomer = useCallback(
    async (customer: Customer) => {
      if (!canManageCustomers) {
        toast.error('You do not have permission to manage customers.')
        return
      }
      setDeleteTarget(customer)
    },
    [canManageCustomers]
  )

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    try {
      const result = await deleteCustomerAction(deleteTarget.id)
      if ('error' in result && result.error) {
        throw new Error(result.error)
      }
      toast.success('Customer deleted successfully')
      refreshCurrentPage()
    } catch (error) {
      console.error('Error deleting customer:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to delete customer')
    } finally {
      setDeleteTarget(null)
    }
  }, [deleteTarget, refreshCurrentPage])

  const handleImportCustomers = useCallback(
    async (customersData: Omit<Customer, 'id' | 'created_at'>[]) => {
      if (!canManageCustomers) {
        toast.error('You do not have permission to manage customers.')
        return
      }
      try {
        const result = await importCustomersAction(
          customersData.map(c => ({
            first_name: c.first_name,
            last_name: c.last_name ?? '',
            mobile_number: c.mobile_number ?? '',
            email: c.email ?? undefined,
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

        const skippedTotal =
          (result.skippedInvalid ?? 0) +
          (result.skippedDuplicateInFile ?? 0) +
          (result.skippedExisting ?? 0)
        let successMessage = `Imported ${result.created ?? 0} customers`
        if (skippedTotal > 0) {
          successMessage += ` (${skippedTotal} skipped)`
        }

        toast.success(successMessage)
        setShowImport(false)
        refreshCurrentPage()
      } catch (error) {
        console.error('Error importing customers:', error)
        toast.error('Failed to import customers')
      }
    },
    [canManageCustomers, refreshCurrentPage]
  )

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

  const startEditCustomer = useCallback(
    (customer: Customer) => {
      if (!canManageCustomers) {
        toast.error('You do not have permission to manage customers.')
        return
      }
      setEditingCustomer(customer)
      setShowForm(true)
    },
    [canManageCustomers]
  )

  // -------------------------------------------------------------------------
  // Columns
  // -------------------------------------------------------------------------

  const desktopColumns = useMemo(() => {
    const baseColumns = [
      {
        key: 'name',
        header: 'Name',
        sortable: true,
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
        ),
      },
      {
        key: 'mobile',
        header: 'Mobile',
        sortable: true,
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
              <div className="text-sm text-gray-500">{customer.email}</div>
            )}
            {customer.mobile_number && customer.sms_opt_in === false && (
              <Badge variant="error" size="sm" icon={<XCircleIcon className="h-3 w-3" />}>
                SMS Deactivated
              </Badge>
            )}
          </div>
        ),
      },
      {
        key: 'event_preferences',
        header: 'Event Preferences',
        cell: (customer: Customer) => {
          const prefs = customerPreferences[customer.id]
          if (prefs && prefs.length > 0) {
            return (
              <BadgeGroup>
                {prefs.slice(0, 3).map(pref => (
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
                {prefs.length > 3 && (
                  <span className="text-xs text-gray-500">+{prefs.length - 3} more</span>
                )}
              </BadgeGroup>
            )
          }
          return <span className="text-gray-400">No preferences yet</span>
        },
      },
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
            <IconButton onClick={() => startEditCustomer(customer)} aria-label="Edit customer">
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
        ),
      },
    ]
  }, [
    canManageCustomers,
    customerLabels,
    customerPreferences,
    handleDeleteCustomer,
    startEditCustomer,
    unreadCounts,
  ])

  // -------------------------------------------------------------------------
  // Subviews: form and import
  // -------------------------------------------------------------------------

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
      >
        <CustomerImport
          onImportComplete={handleImportCustomers}
          onCancel={() => setShowImport(false)}
          existingCustomers={customers}
        />
      </PageLayout>
    )
  }

  // -------------------------------------------------------------------------
  // Main list view
  // -------------------------------------------------------------------------

  const navItems: HeaderNavItem[] = [
    { label: 'Overview', href: '/customers' },
    { label: 'Insights', href: '/customers/insights' },
  ]

  const headerActions = canManageCustomers ? (
    <div className="flex items-center gap-2">
      <LinkButton href="/settings/customer-labels" variant="secondary" size="sm">
        Customer Labels
      </LinkButton>
      <Button onClick={openImportCustomers} variant="secondary">
        Import
      </Button>
      <Button
        onClick={openCreateCustomer}
        variant="primary"
        leftIcon={<PlusIcon className="h-5 w-5" />}
      >
        Add Customer
      </Button>
    </div>
  ) : null

  return (
    <PageLayout
      title="Customers"
      subtitle="Manage your customer database and segments"
      navItems={navItems}
      headerActions={headerActions}
    >
      {/* Filters */}
      <Card>
        <div className="space-y-4">
          <div className="flex flex-col gap-4">
            <SearchInput
              placeholder="Search customers by name, phone or email..."
              onSearch={handleSearch}
              defaultValue={searchTerm}
              debounceDelay={300}
              className="w-full"
            />
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 sm:items-center sm:justify-between">
              <div className="text-sm text-gray-600">
                {searchTerm && (
                  <span>
                    Searching for &quot;{searchTerm}&quot; — Found {totalCount} customers
                  </span>
                )}
                {!searchTerm && totalCount > 0 && (
                  <span>
                    Showing {customers.length} of {totalCount} customers
                  </span>
                )}
              </div>
              <Select
                value={pageSize}
                onChange={e => handlePageSizeChange(Number(e.target.value))}
                selectSize="sm"
                aria-label="Customers per page"
              >
                <option value={50}>50 per page</option>
                <option value={100}>100 per page</option>
                <option value={200}>200 per page</option>
                <option value={500}>500 per page</option>
                <option value={1000}>1000 per page</option>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant={showDeactivated ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => handleFilterChange(false)}
            >
              SMS Active
            </Button>
            <Button
              variant={showDeactivated ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => handleFilterChange(true)}
            >
              SMS Deactivated
            </Button>
          </div>
        </div>
      </Card>

      {/* Customer list */}
      {isFetching ? (
        <Card>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </Card>
      ) : customers.length === 0 ? (
        <Card>
          <EmptyState
            title="No customers found"
            description="Adjust your search or add a new customer."
            action={
              canManageCustomers ? (
                <Button onClick={openCreateCustomer}>
                  <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
                  Add Customer
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          {/* Desktop view */}
          <div className="hidden md:block">
            <Card>
              <DataTable
                data={customers}
                getRowKey={customer => customer.id}
                columns={desktopColumns}
              />
            </Card>
          </div>

          {/* Mobile card view */}
          <div className="block md:hidden">
            <Card className="divide-y divide-gray-200">
              {customers.map(customer => (
                <div
                  key={customer.id}
                  className="px-4 py-4 sm:px-6 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/customers/${customer.id}`}
                      className="block hover:bg-gray-50 flex-1 min-w-0"
                    >
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
                            <a
                              href={`tel:${customer.mobile_number}`}
                              className="text-blue-600 hover:text-blue-700"
                            >
                              {customer.mobile_number}
                            </a>
                          ) : (
                            'No mobile'
                          )}
                        </p>
                        {customer.email && (
                          <p className="text-xs sm:text-sm text-gray-500">{customer.email}</p>
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
                  {customerPreferences[customer.id] &&
                    customerPreferences[customer.id].length > 0 && (
                      <div className="mt-2">
                        <BadgeGroup>
                          {customerPreferences[customer.id].slice(0, 2).map(pref => (
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
              onPageChange={handlePageChange}
            />
          )}
        </>
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete Customer"
        message={
          deleteTarget
            ? `Are you sure you want to delete ${deleteTarget.first_name}${deleteTarget.last_name ? ` ${deleteTarget.last_name}` : ''}? This will also delete all their bookings.`
            : ''
        }
        confirmText="Delete"
        type="danger"
        onConfirm={confirmDelete}
      />
    </PageLayout>
  )
}
