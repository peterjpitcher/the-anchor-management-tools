'use client'

import { useSupabase } from '@/components/providers/SupabaseProvider'
import { useEffect, useState, useMemo } from 'react'
import type { Customer } from '@/types/database'
import { CustomerForm } from '@/components/CustomerForm'
import { CustomerImport } from '@/components/CustomerImport'
import { PlusIcon, ArrowUpOnSquareIcon, PencilIcon, TrashIcon, FunnelIcon, XCircleIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { CustomerName } from '@/components/CustomerName'
import { CustomerWithLoyalty, getLoyalCustomers } from '@/lib/customerUtils'
import { Button } from '@/components/ui/Button'
import Link from 'next/link'
import { getUnreadMessageCounts } from '@/app/actions/messageActions'
import { ChatBubbleLeftIcon } from '@heroicons/react/24/solid'
import { getConstraintErrorMessage, isPostgrestError } from '@/lib/dbErrorHandler'
import { usePagination } from '@/hooks/usePagination'
import { Pagination } from '@/components/Pagination'
import { CustomerLabelDisplay } from '@/components/CustomerLabelDisplay'
import { usePermissions } from '@/contexts/PermissionContext'
import { TagIcon } from '@heroicons/react/24/outline'
import { getBulkCustomerLabels } from '@/app/actions/customer-labels-bulk'
import type { CustomerLabel, CustomerLabelAssignment } from '@/app/actions/customer-labels'
import { LoyaltyService } from '@/lib/services/loyalty'
import { LOYALTY_CONFIG } from '@/lib/config/loyalty'

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
  const [loyaltyMembers, setLoyaltyMembers] = useState<Record<string, any>>({}) // phoneNumber -> member data
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
    const handleSettingsChange = (event: CustomEvent) => {
      // Keep UI enabled regardless of operational status
      setLoyaltyProgramEnabled(true);
    };

    window.addEventListener('loyalty-settings-changed' as any, handleSettingsChange);

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
      window.removeEventListener('loyalty-settings-changed' as any, handleSettingsChange);
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
          const loyaltyData: Record<string, any> = {}
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
          stats?.forEach((stat: any) => {
            if (!preferencesByCustomer[stat.customer_id]) {
              preferencesByCustomer[stat.customer_id] = []
            }
            preferencesByCustomer[stat.customer_id].push({
              customer_id: stat.customer_id,
              category_id: stat.category_id,
              times_attended: stat.times_attended,
              last_attended_date: stat.last_attended_date,
              event_categories: stat.event_categories
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
      <div className="space-y-6">
        <div className="bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h2 className="text-xl font-semibold mb-4">
              {editingCustomer ? 'Edit Customer' : 'Create New Customer'}
            </h2>
            <CustomerForm
              customer={editingCustomer ?? undefined}
              onSubmit={editingCustomer ? handleUpdateCustomer : handleCreateCustomer}
              onCancel={() => {
                setShowForm(false)
                setEditingCustomer(null)
              }}
            />
          </div>
        </div>
      </div>
    )
  }

  if (showImport) {
    return (
      <div className="space-y-6">
        <CustomerImport
          onImportComplete={handleImportCustomers}
          onCancel={() => setShowImport(false)}
          existingCustomers={customers}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
              <p className="mt-1 text-sm text-gray-500">
                A list of all customers including their name and mobile number.
              </p>
            </div>
            <div className="flex space-x-3">
              {hasPermission('customers', 'manage') && (
                <Link href="/settings/customer-labels">
                  <Button variant="outline">
                    <TagIcon className="-ml-1 mr-2 h-5 w-5" />
                    Manage Labels
                  </Button>
                </Link>
              )}
              <Button variant="outline" onClick={() => setShowImport(true)}>
                <ArrowUpOnSquareIcon className="-ml-1 mr-2 h-5 w-5" />
                Import
              </Button>
              <Button onClick={() => setShowForm(true)}>
                <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
                Add Customer
              </Button>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <input
              type="text"
              placeholder="Search customers..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              autoComplete="off"
            />
            <div className="flex items-center space-x-2">
              <FunnelIcon className="h-5 w-5 text-gray-400" />
              <div className="flex space-x-2">
                <button
                  onClick={() => setFilter('all')}
                  className={`px-3 py-1 text-sm rounded-full transition-colors ${
                    filter === 'all' 
                      ? 'bg-green-600 text-white' 
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  All Customers
                </button>
                <button
                  onClick={() => setFilter('regular')}
                  className={`px-3 py-1 text-sm rounded-full transition-colors ${
                    filter === 'regular' 
                      ? 'bg-green-600 text-white' 
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  Regular Only
                </button>
                <button
                  onClick={() => setFilter('non-regular')}
                  className={`px-3 py-1 text-sm rounded-full transition-colors ${
                    filter === 'non-regular' 
                      ? 'bg-green-600 text-white' 
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  Non-Regular Only
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white shadow sm:rounded-lg">
          <div className="animate-pulse p-6">
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      ) : customersWithLoyalty.length === 0 ? (
        <div className="bg-white shadow sm:rounded-lg text-center py-12">
            <h3 className="text-lg font-medium text-gray-900">No customers found</h3>
            <p className="mt-1 text-sm text-gray-500">
                Adjust your search or add a new customer.
            </p>
        </div>
      ) : (
        <>
          <div className="hidden md:block bg-white shadow overflow-hidden sm:rounded-lg">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Mobile
                  </th>
                  {loyaltyProgramEnabled && (
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      VIP Status
                    </th>
                  )}
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Event Preferences
                  </th>
                  <th scope="col" className="relative px-6 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {customersWithLoyalty.map((customer) => (
                  <tr key={customer.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="space-y-2">
                        <div className="flex items-center">
                          <div className="font-medium text-gray-900">
                             <Link href={`/customers/${customer.id}`} className="text-blue-600 hover:text-blue-700">
                              <CustomerName customer={customer} />
                            </Link>
                            {unreadCounts[customer.id] > 0 && (
                              <span className="ml-2 inline-flex items-center">
                                <ChatBubbleLeftIcon className="h-5 w-5 text-blue-500" />
                                <span className="ml-1 text-sm font-medium text-blue-600">
                                  {unreadCounts[customer.id]}
                                </span>
                              </span>
                            )}
                          </div>
                        </div>
                        <CustomerLabelDisplay assignments={customerLabels[customer.id] || []} />
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="space-y-1">
                        {customer.mobile_number ? (
                          <a href={`tel:${customer.mobile_number}`} className="text-blue-600 hover:text-blue-700">
                            {customer.mobile_number}
                          </a>
                        ) : (
                          '-'
                        )}
                        {customer.mobile_number && customer.sms_opt_in === false && (
                          <div className="flex items-center">
                            <XCircleIcon className="h-4 w-4 text-red-500 mr-1" />
                            <span className="text-xs text-red-600">SMS Deactivated</span>
                          </div>
                        )}
                      </div>
                    </td>
                    {loyaltyProgramEnabled && (
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {customer.mobile_number && loyaltyMembers[customer.mobile_number] ? (
                          <div className="flex items-center space-x-2">
                            <span style={{ color: LOYALTY_CONFIG.tiers[loyaltyMembers[customer.mobile_number].tier as keyof typeof LOYALTY_CONFIG.tiers].color }}>
                              {LOYALTY_CONFIG.tiers[loyaltyMembers[customer.mobile_number].tier as keyof typeof LOYALTY_CONFIG.tiers].icon}
                            </span>
                            <span className="font-medium" style={{ color: LOYALTY_CONFIG.tiers[loyaltyMembers[customer.mobile_number].tier as keyof typeof LOYALTY_CONFIG.tiers].color }}>
                              {LOYALTY_CONFIG.tiers[loyaltyMembers[customer.mobile_number].tier as keyof typeof LOYALTY_CONFIG.tiers].name}
                            </span>
                            <span className="text-xs text-gray-500">
                              ({loyaltyMembers[customer.mobile_number].availablePoints} pts)
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-2">
                            <span className="text-gray-400">Not enrolled</span>
                            {hasPermission('loyalty', 'enroll') && (
                              <button
                                onClick={async (e) => {
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
                                className="text-xs px-2 py-1 bg-amber-600 text-white rounded hover:bg-amber-700"
                              >
                                Enroll
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {customerPreferences[customer.id] ? (
                        <div className="flex flex-wrap gap-1">
                          {customerPreferences[customer.id].slice(0, 3).map((pref) => (
                            <span
                              key={pref.category_id}
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"
                              title={`Attended ${pref.times_attended} times`}
                            >
                              {pref.event_categories.name}
                              {pref.times_attended > 1 && (
                                <span className="ml-1 text-green-600">×{pref.times_attended}</span>
                              )}
                            </span>
                          ))}
                          {customerPreferences[customer.id].length > 3 && (
                            <span className="text-xs text-gray-500">
                              +{customerPreferences[customer.id].length - 3} more
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">No preferences yet</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => {
                          setEditingCustomer(customer)
                          setShowForm(true)
                        }}
                        className="text-blue-600 hover:text-blue-700"
                        aria-label="Edit customer"
                      >
                        <PencilIcon className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => handleDeleteCustomer(customer)}
                        className="text-red-600 hover:text-red-900 ml-4"
                        aria-label="Delete customer"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          
          <div className="block md:hidden">
            <ul className="divide-y divide-gray-200 bg-white shadow overflow-hidden sm:rounded-lg">
            {customersWithLoyalty.map(customer => (
              <li key={customer.id} className="px-4 py-4 sm:px-6">
                 <div className="flex items-center justify-between">
                   <Link href={`/customers/${customer.id}`} className="block hover:bg-gray-50 flex-1 min-w-0">
                      <div className="flex items-center">
                          <p className="text-sm font-medium text-blue-600 truncate">
                              <CustomerName customer={customer} />
                          </p>
                          {unreadCounts[customer.id] > 0 && (
                            <span className="ml-2 inline-flex items-center flex-shrink-0">
                              <ChatBubbleLeftIcon className="h-4 w-4 text-blue-500" />
                              <span className="ml-1 text-xs font-medium text-blue-600">
                                {unreadCounts[customer.id]}
                              </span>
                            </span>
                          )}
                      </div>
                   </Link>
                   <div className="ml-2 flex-shrink-0 flex space-x-2">
                      <button
                        onClick={() => {
                          setEditingCustomer(customer)
                          setShowForm(true)
                        }}
                        className="p-1 text-gray-500 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                        aria-label="Edit customer"
                      >
                        <PencilIcon className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => handleDeleteCustomer(customer)}
                        className="p-1 text-red-500 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                        aria-label="Delete customer"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
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
                        <div className="flex items-center">
                          <XCircleIcon className="h-4 w-4 text-red-500 mr-1" />
                          <span className="text-xs text-red-600">SMS Deactivated</span>
                        </div>
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
                          <button
                            onClick={async (e) => {
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
                            className="text-xs px-2 py-1 bg-amber-600 text-white rounded hover:bg-amber-700"
                          >
                            Enroll
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {customerPreferences[customer.id] && customerPreferences[customer.id].length > 0 && (
                  <div className="mt-2">
                    <div className="flex flex-wrap gap-1">
                      {customerPreferences[customer.id].slice(0, 2).map((pref) => (
                        <span
                          key={pref.category_id}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"
                          title={`Attended ${pref.times_attended} times`}
                        >
                          {pref.event_categories.name}
                          {pref.times_attended > 1 && (
                            <span className="ml-1 text-green-600">×{pref.times_attended}</span>
                          )}
                        </span>
                      ))}
                      {customerPreferences[customer.id].length > 2 && (
                        <span className="text-xs text-gray-500">
                          +{customerPreferences[customer.id].length - 2}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <div className="mt-2">
                  <CustomerLabelDisplay assignments={customerLabels[customer.id] || []} />
                </div>
              </li>
            ))}
            </ul>
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalCount}
              itemsPerPage={pageSize}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  )
}