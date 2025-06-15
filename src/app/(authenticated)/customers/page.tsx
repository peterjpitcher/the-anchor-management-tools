'use client'

import { supabase } from '@/lib/supabase'
import { useEffect, useState, useMemo } from 'react'
import type { Customer } from '@/types/database'
import { CustomerForm } from '@/components/CustomerForm'
import { CustomerImport } from '@/components/CustomerImport'
import { PlusIcon, ArrowUpOnSquareIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { CustomerName } from '@/components/CustomerName'
import { CustomerWithLoyalty, getLoyalCustomers, sortCustomersByLoyalty } from '@/lib/customerUtils'
import { Button } from '@/components/ui/Button'
import Link from 'next/link'
import { getUnreadMessageCounts } from '@/app/actions/messageActions'
import { ChatBubbleLeftIcon } from '@heroicons/react/24/solid'

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerWithLoyalty[]>([])
  const [filteredCustomers, setFilteredCustomers] = useState<CustomerWithLoyalty[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<CustomerWithLoyalty | null>(null)
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    loadCustomers()
  }, [])

  async function loadCustomers() {
    setIsLoading(true)
    try {
      const { data: customersData, error } = await supabase
        .from('customers')
        .select('*')
        .order('first_name', { ascending: true })

      if (error) throw error

      // Get loyal customer IDs
      const loyalCustomerIds = await getLoyalCustomers(supabase)

      // Mark loyal customers
      const customersWithLoyalty = (customersData || []).map(customer => ({
        ...customer,
        isLoyal: loyalCustomerIds.includes(customer.id)
      }))

      setCustomers(sortCustomersByLoyalty(customersWithLoyalty))
      
      // Load unread message counts
      const counts = await getUnreadMessageCounts()
      setUnreadCounts(counts)
    } catch (error) {
      console.error('Error loading customers:', error)
      toast.error('Failed to load customers')
    } finally {
      setIsLoading(false)
    }
  }

  // A memoized version of the filtered customers
  useEffect(() => {
    if (!searchTerm) {
      setFilteredCustomers(customers)
    } else {
      const searchTermLower = searchTerm.toLowerCase()
      const filtered = customers.filter(customer => {
        const fullName = `${customer.first_name} ${customer.last_name}`.toLowerCase()
        const reversedFullName = `${customer.last_name} ${customer.first_name}`.toLowerCase()
        const mobileDigits = customer.mobile_number ? customer.mobile_number.replace(/\D/g, '') : ''
        return (
          fullName.includes(searchTermLower) ||
          reversedFullName.includes(searchTermLower) ||
          (customer.mobile_number && mobileDigits.includes(searchTermLower)) ||
          (customer.first_name &&
            customer.first_name.toLowerCase().includes(searchTermLower)) ||
          (customer.last_name && customer.last_name.toLowerCase().includes(searchTermLower))
        )
      })
      setFilteredCustomers(filtered)
    }
  }, [searchTerm, customers])

  async function handleCreateCustomer(
    customerData: Omit<Customer, 'id' | 'created_at'>
  ) {
    try {
      const { error } = await supabase.from('customers').insert([customerData])
      if (error) throw error
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

      if (error) throw error
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
      if (error) throw error
      toast.success('Customers imported successfully')
      setShowImport(false)
      await loadCustomers()
    } catch (error) {
      console.error('Error importing customers:', error)
      toast.error('Failed to import customers')
    }
  }

  if (isLoading) {
    return <div className="text-black pb-20 sm:pb-6">Loading customers...</div>
  }

  if (showForm || editingCustomer) {
    return (
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
    )
  }

  if (showImport) {
    return (
      <CustomerImport
        onImportComplete={handleImportCustomers}
        onCancel={() => setShowImport(false)}
        existingCustomers={customers}
      />
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
          <div className="mt-4">
            <input
              type="text"
              placeholder="Search customers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
        </div>
      </div>

      {filteredCustomers.length === 0 ? (
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
                  <th scope="col" className="relative px-6 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredCustomers.map((customer) => (
                  <tr key={customer.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="font-medium text-gray-900">
                           <Link href={`/customers/${customer.id}`} className="text-indigo-600 hover:text-indigo-900">
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
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {customer.mobile_number ? (
                        <a href={`tel:${customer.mobile_number}`} className="text-indigo-600 hover:text-indigo-900">
                          {customer.mobile_number}
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => {
                          setEditingCustomer(customer)
                          setShowForm(true)
                        }}
                        className="text-indigo-600 hover:text-indigo-900"
                      >
                        <PencilIcon className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => handleDeleteCustomer(customer)}
                        className="text-red-600 hover:text-red-900 ml-4"
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
            {filteredCustomers.map(customer => (
              <li key={customer.id} className="px-4 py-4 sm:px-6">
                 <div className="flex items-center justify-between">
                   <Link href={`/customers/${customer.id}`} className="block hover:bg-gray-50 flex-1 min-w-0">
                      <div className="flex items-center">
                          <p className="text-sm font-medium text-indigo-600 truncate">
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
                        className="p-1 text-gray-500 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                      >
                        <PencilIcon className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => handleDeleteCustomer(customer)}
                        className="p-1 text-red-500 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </div>
                </div>
                <div className="mt-2 sm:flex sm:justify-between">
                  <div className="sm:flex">
                    <p className="flex items-center text-sm text-gray-500">
                      {customer.mobile_number ? (
                        <a href={`tel:${customer.mobile_number}`} className="text-indigo-600 hover:text-indigo-900">
                          {customer.mobile_number}
                        </a>
                      ) : (
                        'No mobile'
                      )}
                    </p>
                  </div>
                </div>
              </li>
            ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}