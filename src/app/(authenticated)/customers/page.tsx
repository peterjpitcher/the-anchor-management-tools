'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Customer } from '@/types/database'
import { CustomerForm } from '@/components/CustomerForm'
import { CustomerImport } from '@/components/CustomerImport'
import toast from 'react-hot-toast'
import { PlusIcon } from '@heroicons/react/24/outline'
import { CustomerName } from '@/components/CustomerName'
import { CustomerWithLoyalty, getLoyalCustomers } from '@/lib/customerUtils'

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerWithLoyalty[]>([])
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

      setCustomers(customersWithLoyalty)
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
    return <div className="text-black">Loading customers...</div>
  }

  if (showForm || editingCustomer) {
    return (
      <div className="max-w-2xl mx-auto py-6">
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
      <CustomerImport
        onImportComplete={handleImportCustomers}
        onCancel={() => setShowImport(false)}
        existingCustomers={customers}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-xl font-semibold text-black">Customers</h1>
          <p className="mt-2 text-sm text-gray-700">
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

      <div className="mt-8 flex flex-col">
        <div className="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
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
                  {customers.map((customer) => (
                    <tr key={customer.id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-black sm:pl-6">
                        <CustomerName customer={customer} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-700">
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
          </div>
        </div>
      </div>
    </div>
  )
} 