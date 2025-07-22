'use client'

import { useSupabase } from '@/components/providers/SupabaseProvider'
import { useEffect, useState, useMemo } from 'react'
import type { Customer } from '@/types/database'
import { CustomerForm } from '@/components/CustomerForm'
import { CustomerImport } from '@/components/CustomerImport'
import { PlusIcon, ArrowUpOnSquareIcon, PencilIcon, TrashIcon, XCircleIcon } from '@heroicons/react/24/outline'
import { CustomerName } from '@/components/CustomerName'
import { CustomerWithLoyalty, getLoyalCustomers } from '@/lib/customerUtils'
import Link from 'next/link'
import { getUnreadMessageCounts } from '@/app/actions/messageActions'
import { ChatBubbleLeftIcon } from '@heroicons/react/24/solid'
import { getConstraintErrorMessage, isPostgrestError } from '@/lib/dbErrorHandler'
import { usePagination } from '@/hooks/usePagination'
import { CustomerLabelDisplay } from '@/components/CustomerLabelDisplay'
import { usePermissions } from '@/contexts/PermissionContext'
import { TagIcon } from '@heroicons/react/24/outline'
import { getBulkCustomerLabels } from '@/app/actions/customer-labels-bulk'
import type { CustomerLabel, CustomerLabelAssignment } from '@/app/actions/customer-labels'
import { LoyaltyService } from '@/lib/services/loyalty'
import { LOYALTY_CONFIG } from '@/lib/config/loyalty'
// New UI components
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { Button, IconButton } from '@/components/ui-v2/forms/Button'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { SearchBar } from '@/components/ui-v2/forms/SearchInput'
import { Badge, BadgeGroup } from '@/components/ui-v2/display/Badge'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Pagination as PaginationV2 } from '@/components/ui-v2/navigation/Pagination'
import { Skeleton } from '@/components/ui-v2/feedback/Skeleton'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { TabNav } from '@/components/ui-v2/navigation/TabNav'

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

export default function CustomersPage() {
  const supabase = useSupabase()
  const { hasPermission } = usePermissions()
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<CustomerWithLoyalty | null>(null)
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [loyalCustomerIds, setLoyalCustomerIds] = useState<string[]>([])
  const [customerPreferences, setCustomerPreferences] = useState<Record<string, CustomerCategoryStats[]>>({})
  const [customerLabels, setCustomerLabels] = useState<Record<string, CustomerLabelAssignment[]>>({})
  const [filter, setFilter] = useState<'all' | 'regular' | 'non-regular'>('all')
  const [loyaltyMembers, setLoyaltyMembers] = useState<Record<string, {tier: string; availablePoints: number; id: string}>>({}) // phoneNumber -> member data
  const [loyaltyProgramEnabled, setLoyaltyProgramEnabled] = useState(false)

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput)
    }, 300) // 300ms delay

    return () => clearTimeout(timer)
  }, [searchInput])

  // Memoize query configuration to prevent unnecessary re-renders
  const queryConfig = useMemo(() => ({
    select: '*',
    orderBy: { column: 'first_name', ascending: true }
  }), [])

  const paginationOptions = useMemo(() => ({
    pageSize: 50,
    searchTerm: searchTerm,
    searchColumns: ['first_name', 'last_name', 'mobile_number']
  }), [searchTerm])

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

  // Load loyal customer IDs once on mount
  useEffect(() => {
    // Always show loyalty features (configuration is always enabled)
    setLoyaltyProgramEnabled(true);

    // Listen for settings changes (though we always show the UI)
    const handleSettingsChange = (_event: CustomEvent) => {
      // Keep UI enabled regardless of operational status
      setLoyaltyProgramEnabled(true);
    };

    window.addEventListener('loyalty-settings-changed', handleSettingsChange as EventListener);

    async function loadLoyalCustomers() {
      try {
        const loyalIds = await getLoyalCustomers(supabase)
        setLoyalCustomerIds(loyalIds)
      } catch (error) {
        console.error('Error loading loyal customers:', error)
        // Silent fail - loyalty status is not critical
      }
    }
    
    // Always load loyal customers for display
    loadLoyalCustomers()

    return () => {
      window.removeEventListener('loyalty-settings-changed', handleSettingsChange as EventListener);
    };
  }, [supabase])

  // Load customer event preferences, labels, and loyalty status
  useEffect(() => {
    async function loadCustomerData() {
      if (!customers || customers.length === 0) return

      try {
        const customerIds = customers.map(c => c.id)
        
        // Load loyalty status for all customers (only if enabled)
        if (loyaltyProgramEnabled) {
          const loyaltyData: Record<string, {tier: string; availablePoints: number; id: string}> = {}
          for (const customer of customers) {
            if (customer.mobile_number) {
              const member = await LoyaltyService.getMemberByPhone(customer.mobile_number)
              if (member) {
                loyaltyData[customer.mobile_number] = member
              }
            }
          }
          setLoyaltyMembers(loyaltyData)
        }
        
        // Load preferences
        const { data: stats, error } = await supabase
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
          .in('customer_id', customerIds)
          .order('times_attended', { ascending: false })

        if (error) {
          console.error('Error loading customer preferences:', error)
        } else {
          // Group by customer ID
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
        
        // Load labels in bulk
        const { assignments } = await getBulkCustomerLabels(customerIds)
        if (assignments) {
          setCustomerLabels(assignments)
        }
      } catch (error) {
        console.error('Error loading customer data:', error)
      }
    }

    loadCustomerData()
  }, [customers, supabase, loyaltyProgramEnabled])

  // Load unread message counts separately with a slight delay to avoid blocking initial render
  useEffect(() => {
    let mounted = true
    
    async function loadUnreadCounts() {
      try {
        // Small delay to let the main content render first
        await new Promise(resolve => setTimeout(resolve, 100))
        
        if (!mounted) return
        
        const counts = await getUnreadMessageCounts()
        if (mounted) {
          setUnreadCounts(counts)
        }
      } catch (error) {
        console.error('Error loading unread counts:', error)
        // Silent fail - not critical for page functionality
      }
    }
    
    loadUnreadCounts()
    
    return () => {
      mounted = false
    }
  }, [])

  // Process customers with loyalty status and apply filter
  const customersWithLoyalty = useMemo(() => {
    const processedCustomers = customers.map(customer => ({
      ...customer,
      isLoyal: loyalCustomerIds.includes(customer.id)
    }))
    
    // Check if customer has the "Regular" label
    const regularLabelAssignments = Object.entries(customerLabels).reduce((acc, [customerId, assignments]) => {
      const hasRegularLabel = assignments.some(assignment => {
        const label = assignment.label as CustomerLabel
        return label?.name === 'Regular'
      })
      if (hasRegularLabel) {
        acc.add(customerId)
      }
      return acc
    }, new Set<string>())
    
    if (filter === 'regular') {
      return processedCustomers.filter(customer => regularLabelAssignments.has(customer.id))
    } else if (filter === 'non-regular') {
      return processedCustomers.filter(customer => !regularLabelAssignments.has(customer.id))
    }
    
    return processedCustomers
  }, [customers, loyalCustomerIds, filter, customerLabels])

  async function handleCreateCustomer(
    customerData: Omit<Customer, 'id' | 'created_at'>
  ) {
    try {
      const { error } = await supabase.from('customers').insert([customerData])
      if (error) {
        const message = isPostgrestError(error) ? getConstraintErrorMessage(error) : 'Failed to create customer';
        toast.error(message)
        return
      }
      toast.success('Customer created successfully')
      setShowForm(false)
      await loadCustomers()
    } catch (error) {
      console.error('Error creating customer:', error)
      toast.error('Failed to create customer')
    }
  }

  async function handleUpdateCustomer(
    customerData: Omit<Customer, 'id' | 'created_at'>
  ) {
    if (!editingCustomer) return

    try {
      const { error } = await supabase
        .from('customers')
        .update(customerData)
        .eq('id', editingCustomer.id)

      if (error) {
        const message = isPostgrestError(error) ? getConstraintErrorMessage(error) : 'Failed to update customer';
        toast.error(message)
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
  }

  async function handleDeleteCustomer(customer: Customer) {
    const confirmMessage =
      'Are you sure you want to delete this customer? This will also delete all their bookings.'
    if (!window.confirm(confirmMessage)) return

    try {
      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', customer.id)
      if (error) throw error
      toast.success('Customer deleted successfully')
      await loadCustomers()
    } catch (error) {
      console.error('Error deleting customer:', error)
      toast.error('Failed to delete customer')
    }
  }

  async function handleImportCustomers(customersData: Omit<Customer, 'id' | 'created_at'>[]) {
    try {
      const { error } = await supabase.from('customers').insert(customersData)
      if (error) {
        const message = isPostgrestError(error) ? getConstraintErrorMessage(error) : 'Failed to import customers';
        toast.error(message)
        return
      }
      toast.success('Customers imported successfully')
      setShowImport(false)
      await loadCustomers()
    } catch (error) {
      console.error('Error importing customers:', error)
      toast.error('Failed to import customers')
    }
  }

  if (showForm || editingCustomer) {
    return (
      <Page title={editingCustomer ? 'Edit Customer' : 'Create New Customer'}>
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
      </Page>
    )
  }

  if (showImport) {
    return (
      <Page title="Import Customers">
        <CustomerImport
          onImportComplete={handleImportCustomers}
          onCancel={() => setShowImport(false)}
          existingCustomers={customers}
        />
      </Page>
    )
  }

  return (
    <Page
      title="Customers"
      description="A list of all customers including their name and mobile number."
      actions={
        <div className="flex flex-wrap gap-2 sm:gap-3">
          {hasPermission('customers', 'manage') && (
            <LinkButton
              href="/settings/customer-labels"
              variant="secondary"
            >
              <TagIcon className="-ml-1 mr-2 h-5 w-5" />
              Manage Labels
            </LinkButton>
          )}
          <Button
            variant="secondary"
            onClick={() => setShowImport(true)}
          >
            <ArrowUpOnSquareIcon className="-ml-1 mr-2 h-5 w-5" />
            Import
          </Button>
          <Button
            variant="primary"
            onClick={() => setShowForm(true)}
          >
            <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
            Add Customer
          </Button>
        </div>
      }
    >
      <Card>
        <div className="space-y-4">
          <SearchBar
            placeholder="Search customers..."
            value={searchInput}
            onSearch={setSearchInput}
          />
          <TabNav
            tabs={[
              { key: 'all', label: 'All Customers', badge: totalCount },
              { key: 'regular', label: 'Regular Only' },
              { key: 'non-regular', label: 'Non-Regular Only' },
            ]}
            activeKey={filter}
            onChange={(tab) => setFilter(tab as 'all' | 'regular' | 'non-regular')}
          />
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
      ) : customersWithLoyalty.length === 0 ? (
        <Card>
          <EmptyState
            title="No customers found"
            description="Adjust your search or add a new customer."
            action={
              <Button onClick={() => setShowForm(true)}>
                <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
                Add Customer
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {/* Desktop view with DataTable component */}
          <div className="hidden md:block">
            <Card>
              <DataTable
                data={customersWithLoyalty}
                getRowKey={(customer) => customer.id}
                columns={[
                  {
                    key: 'name',
                    header: 'Name',
                    cell: (customer) => (
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
                    cell: (customer) => (
                      <div className="space-y-1">
                        {customer.mobile_number ? (
                          <a href={`tel:${customer.mobile_number}`} className="text-blue-600 hover:text-blue-700">
                            {customer.mobile_number}
                          </a>
                        ) : (
                          '-'
                        )}
                        {customer.mobile_number && customer.sms_opt_in === false && (
                          <Badge variant="error" size="sm">
                            <XCircleIcon className="h-3 w-3 mr-1" />
                            SMS Deactivated
                          </Badge>
                        )}
                      </div>
                    ),
                  },
                  ...(loyaltyProgramEnabled
                    ? [
                        {
                          key: 'vip_status',
                          header: 'VIP Status',
                          cell: (customer: CustomerWithLoyalty) => {
                            if (customer.mobile_number && loyaltyMembers[customer.mobile_number]) {
                              const member = loyaltyMembers[customer.mobile_number];
                              const tier = LOYALTY_CONFIG.tiers[member.tier as keyof typeof LOYALTY_CONFIG.tiers];
                              return (
                                <div className="flex items-center space-x-2">
                                  <span style={{ color: tier.color }}>
                                    {tier.icon}
                                  </span>
                                  <span className="font-medium" style={{ color: tier.color }}>
                                    {tier.name}
                                  </span>
                                  <span className="text-xs text-gray-500">
                                    ({member.availablePoints} pts)
                                  </span>
                                </div>
                              );
                            }
                            return (
                              <div className="flex items-center space-x-2">
                                <span className="text-gray-400">Not enrolled</span>
                                {hasPermission('loyalty', 'enroll') && customer.mobile_number && (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={async (e: React.MouseEvent) => {
                                      e.stopPropagation();
                                      const formData = new FormData();
                                      formData.append('customerId', customer.id);
                                      formData.append('phoneNumber', customer.mobile_number);
                                      
                                      const { enrollCustomer } = await import('@/app/actions/loyalty');
                                      const result = await enrollCustomer(formData);
                                      
                                      if (result.error) {
                                        toast.error(result.error);
                                      } else {
                                        toast.success('Customer enrolled in VIP Club!');
                                        // Reload loyalty data
                                        const member = await LoyaltyService.getMemberByPhone(customer.mobile_number);
                                        if (member) {
                                          setLoyaltyMembers(prev => ({
                                            ...prev,
                                            [customer.mobile_number]: member
                                          }));
                                        }
                                      }
                                    }}
                                  >
                                    Enroll
                                  </Button>
                                )}
                              </div>
                            );
                          },
                        },
                      ]
                    : []),
                  {
                    key: 'event_preferences',
                    header: 'Event Preferences',
                    cell: (customer) => {
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
                        );
                      }
                      return <span className="text-gray-400">No preferences yet</span>;
                    },
                  },
                  {
                    key: 'actions',
                    header: '',
                    cell: (customer) => (
                      <div className="flex items-center justify-end space-x-2">
                        <IconButton
                          onClick={() => {
                            setEditingCustomer(customer);
                            setShowForm(true);
                          }}
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
                    ),
                  },
                ]}
              />
            </Card>
          </div>
          
          {/* Mobile view */}
          <div className="block md:hidden">
            <Card className="divide-y divide-gray-200">
              {customersWithLoyalty.map(customer => (
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
                    <div className="ml-2 flex-shrink-0 flex space-x-2">
                      <IconButton
                        onClick={() => {
                          setEditingCustomer(customer)
                          setShowForm(true)
                        }}
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
                        {customer.mobile_number && customer.sms_opt_in === false && (
                          <Badge variant="error" size="sm" className="mt-1">
                            <XCircleIcon className="h-3 w-3 mr-1" />
                            SMS Deactivated
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  {loyaltyProgramEnabled && (
                    <div className="mt-2">
                      {customer.mobile_number && loyaltyMembers[customer.mobile_number] ? (
                        <div className="flex items-center space-x-2">
                          <span style={{ color: LOYALTY_CONFIG.tiers[loyaltyMembers[customer.mobile_number].tier as keyof typeof LOYALTY_CONFIG.tiers].color }}>
                            {LOYALTY_CONFIG.tiers[loyaltyMembers[customer.mobile_number].tier as keyof typeof LOYALTY_CONFIG.tiers].icon}
                          </span>
                          <span className="text-sm font-medium" style={{ color: LOYALTY_CONFIG.tiers[loyaltyMembers[customer.mobile_number].tier as keyof typeof LOYALTY_CONFIG.tiers].color }}>
                            {LOYALTY_CONFIG.tiers[loyaltyMembers[customer.mobile_number].tier as keyof typeof LOYALTY_CONFIG.tiers].name}
                          </span>
                          <span className="text-xs text-gray-500">
                            ({loyaltyMembers[customer.mobile_number].availablePoints} pts)
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-2">
                          <span className="text-sm text-gray-400">Not enrolled</span>
                          {hasPermission('loyalty', 'enroll') && customer.mobile_number && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={async (e: React.MouseEvent) => {
                                e.stopPropagation();
                                const formData = new FormData();
                                formData.append('customerId', customer.id);
                                formData.append('phoneNumber', customer.mobile_number);
                                
                                const { enrollCustomer } = await import('@/app/actions/loyalty');
                                const result = await enrollCustomer(formData);
                                
                                if (result.error) {
                                  toast.error(result.error);
                                } else {
                                  toast.success('Customer enrolled in VIP Club!');
                                  // Reload loyalty data
                                  const member = await LoyaltyService.getMemberByPhone(customer.mobile_number);
                                  if (member) {
                                    setLoyaltyMembers(prev => ({
                                      ...prev,
                                      [customer.mobile_number]: member
                                    }));
                                  }
                                }
                              }}
                            >
                              Enroll
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
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
    </Page>
  )
}