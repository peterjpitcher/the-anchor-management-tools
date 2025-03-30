'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Customer } from '@/types/database'
import { CustomerForm } from '@/components/CustomerForm'
import { CustomerImport } from '@/components/CustomerImport'
import toast from 'react-hot-toast'
import { PlusIcon, PencilIcon, TrashIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { CustomerName } from '@/components/CustomerName'
import { CustomerWithLoyalty, getLoyalCustomers, sortCustomersByLoyalty } from '@/lib/customerUtils'
import Link from 'next/link'

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerWithLoyalty[]>([])
  const [filteredCustomers, setFilteredCustomers] = useState<CustomerWithLoyalty[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<CustomerWithLoyalty | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  async function loadData() {
    try {
      setIsLoading(true)
      const { data: customersData, error } = await supabase
        .from('customers')
        .select('*')
        .order('first_name')

      if (error) throw error

      // Get loyal customer IDs
      const loyalCustomerIds = await getLoyalCustomers(supabase)

      // Mark loyal customers
      const customersWithLoyalty = (customersData || []).map(customer => ({
        ...customer,
        isLoyal: loyalCustomerIds.includes(customer.id)
      }))

      setCustomers(sortCustomersByLoyalty(customersWithLoyalty))
    } catch (error) {
      console.error('Error loading customers:', error)
      toast.error('Failed to load customers')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (searchTerm.trim() === '') {
      setFilteredCustomers(customers)
      return
    }

    const searchTermLower = searchTerm.toLowerCase()
    const searchTermDigits = searchTerm.replace(/\D/g, '') // Remove non-digits for phone number search
    const filtered = customers.filter(customer => {
      const fullName = `${customer.first_name} ${customer.last_name}`.toLowerCase()
      const reversedFullName = `${customer.last_name} ${customer.first_name}`.toLowerCase()
      const mobileDigits = customer.mobile_number.replace(/\D/g, '')
      
      return fullName.includes(searchTermLower) ||
             reversedFullName.includes(searchTermLower) ||
             customer.first_name.toLowerCase().includes(searchTermLower) ||
             customer.last_name.toLowerCase().includes(searchTermLower) ||
             mobileDigits.includes(searchTermDigits)
    })
    setFilteredCustomers(filtered)
  }, [searchTerm, customers])

  async function handleCreateCustomer(
    customerData: Omit<Customer, 'id' | 'created_at'>
  ) {
    try {
      const { error } = await supabase.from('customers').insert([customerData])
      if (error) throw error

      toast.success('Customer created successfully')
      setShowForm(false)
      loadData()
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
      loadData()
    } catch (error) {
      console.error('Error updating customer:', error)
      toast.error('Failed to update customer')
    }
  }

  async function handleDeleteCustomer(customer: Customer) {
    if (
      !confirm(
        'Are you sure you want to delete this customer? This will also delete all their bookings.'
      )
    )
      return

    try {
      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', customer.id)

      if (error) throw error

      toast.success('Customer deleted successfully')
      loadData()
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
      loadData()
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
      <div className="max-w-2xl mx-auto py-6 pb-20 sm:pb-6">
        <h1 className="text-2xl font-bold mb-6">
          {editingCustomer ? 'Edit Customer' : 'Create New Customer'}
        </h1>
        <CustomerForm
          customer={editingCustomer ?? undefined}
          onSubmit={editingCustomer ? handleUpdateCustomer : handleCreateCustomer}
          onCancel={() => {
            setShowForm(false)
            setEditingCustomer(null)
          }}
        />
      </div>
    )
  }

  if (showImport) {
    return (
      <div className="pb-20 sm:pb-6">
        <CustomerImport
          onImportComplete={handleImportCustomers}
          onCancel={() => setShowImport(false)}
          existingCustomers={customers}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-20 sm:pb-6">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-xl font-semibold text-black">Customers</h1>
          <p className="mt-2 text-sm text-black">
            A list of all customers and their contact information.
          </p>
        </div>
        <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none space-x-3">
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:w-auto"
          >
            <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
            Add Customer
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="hidden md:inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:w-auto"
          >
            Import Customers
          </button>
        </div>
      </div>

      <div className="max-w-3xl">
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <MagnifyingGlassIcon className="h-5 w-5 text-gray-600" aria-hidden="true" />
          </div>
          <input
            type="text"
            placeholder="Search by name or mobile number"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="block w-full rounded-lg border-gray-300 pl-10 focus:border-indigo-500 focus:ring-indigo-500 text-base md:text-sm py-3 md:py-2 text-black placeholder-gray-600 shadow-sm"
          />
        </div>
      </div>

      <div className="mt-8 flex flex-col">
        <div className="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
              <table className="min-w-full divide-y divide-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-black sm:pl-6">
                      Name
                    </th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-black">
                      Mobile
                    </th>
                    <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {filteredCustomers.map((customer) => (
                    <tr key={customer.id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-black sm:pl-6">
                        <Link href={`/customers/${customer.id}`} className="hover:text-indigo-600">
                          <CustomerName customer={customer} />
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-black">
                        {customer.mobile_number}
                      </td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button
                          onClick={() => setEditingCustomer(customer)}
                          className="text-indigo-600 hover:text-indigo-900"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteCustomer(customer)}
                          className="ml-4 text-red-600 hover:text-red-900"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-3">
              {filteredCustomers.map((customer) => (
                <div key={customer.id} className="bg-white shadow rounded-lg p-4">
                  <div className="flex justify-between items-start">
                    <Link href={`/customers/${customer.id}`} className="flex-1">
                      <h3 className="text-base font-medium text-black hover:text-indigo-600">
                        <CustomerName customer={customer} />
                      </h3>
                      <p className="mt-1 text-sm text-gray-500">{customer.mobile_number}</p>
                    </Link>
                    <div className="flex space-x-2 ml-4">
                      <button
                        onClick={() => setEditingCustomer(customer)}
                        className="p-2 text-indigo-600 hover:text-indigo-900"
                      >
                        <PencilIcon className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => handleDeleteCustomer(customer)}
                        className="p-2 text-red-600 hover:text-red-900"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 