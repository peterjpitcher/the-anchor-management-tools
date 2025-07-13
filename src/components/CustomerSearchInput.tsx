'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { MagnifyingGlassIcon, UserIcon, PhoneIcon, CheckIcon } from '@heroicons/react/24/outline'
import { createClient } from '@/lib/supabase/client'

interface Customer {
  id: string
  first_name: string
  last_name: string
  mobile_number: string | null
  email: string | null
}

interface CustomerSearchInputProps {
  onCustomerSelect: (customer: Customer | null) => void
  selectedCustomerId?: string | null
  placeholder?: string
}

export default function CustomerSearchInput({ 
  onCustomerSelect, 
  selectedCustomerId,
  placeholder = "Search by name or phone..." 
}: CustomerSearchInputProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const searchTimeout = useRef<NodeJS.Timeout | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  const loadCustomer = useCallback(async (customerId: string) => {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single()

    if (data && !error) {
      setSelectedCustomer(data)
      setSearchTerm(`${data.first_name} ${data.last_name}`)
    }
  }, [supabase])

  // Load selected customer on mount if ID provided
  useEffect(() => {
    if (selectedCustomerId) {
      loadCustomer(selectedCustomerId)
    }
  }, [selectedCustomerId, loadCustomer])

  // Handle clicks outside dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const searchCustomers = async (term: string) => {
    if (term.length < 2) {
      setSearchResults([])
      return
    }

    setIsSearching(true)

    // Build search query
    let query = supabase
      .from('customers')
      .select('*')
      .order('first_name', { ascending: true })
      .limit(10)

    // Check if search term looks like a phone number
    const phonePattern = /^[0-9\s\-\+\(\)]+$/
    if (phonePattern.test(term)) {
      // Search by phone number
      const cleanPhone = term.replace(/\D/g, '')
      query = query.or(`mobile_number.ilike.%${cleanPhone}%`)
    } else {
      // Search by name
      const searchWords = term.toLowerCase().split(' ').filter(word => word.length > 0)
      
      if (searchWords.length === 1) {
        // Single word - search in both first and last name
        query = query.or(`first_name.ilike.%${searchWords[0]}%,last_name.ilike.%${searchWords[0]}%`)
      } else {
        // Multiple words - try to match first and last name
        query = query.or(
          `and(first_name.ilike.%${searchWords[0]}%,last_name.ilike.%${searchWords[1]}%),` +
          `and(first_name.ilike.%${searchWords[1]}%,last_name.ilike.%${searchWords[0]}%)`
        )
      }
    }

    const { data, error } = await query

    if (!error && data) {
      setSearchResults(data)
      setShowDropdown(true)
    } else {
      setSearchResults([])
    }

    setIsSearching(false)
  }

  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    
    // Clear previous timeout
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current)
    }

    // Clear selection if user is typing
    if (selectedCustomer) {
      setSelectedCustomer(null)
      onCustomerSelect(null)
    }

    // Debounce search - longer delay on mobile for better performance
    const delay = typeof window !== 'undefined' && window.innerWidth < 768 ? 500 : 300
    searchTimeout.current = setTimeout(() => {
      searchCustomers(value)
    }, delay)
  }

  const handleCustomerSelect = (customer: Customer) => {
    setSelectedCustomer(customer)
    setSearchTerm(`${customer.first_name} ${customer.last_name}`)
    setShowDropdown(false)
    onCustomerSelect(customer)
  }

  const clearSelection = () => {
    setSelectedCustomer(null)
    setSearchTerm('')
    setSearchResults([])
    onCustomerSelect(null)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          {isSearching ? (
            <div className="animate-spin h-5 w-5 border-2 border-gray-300 border-t-blue-600 rounded-full" />
          ) : selectedCustomer ? (
            <CheckIcon className="h-5 w-5 text-green-500" />
          ) : (
            <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
          )}
        </div>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="block w-full pl-10 pr-10 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base min-h-[44px]"
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
        />
        {(searchTerm || selectedCustomer) && (
          <button
            type="button"
            onClick={clearSelection}
            className="absolute inset-y-0 right-0 pr-3 flex items-center min-w-[44px] justify-center"
          >
            <span className="text-gray-400 hover:text-gray-600 text-sm">Clear</span>
          </button>
        )}
      </div>

      {/* Selected Customer Display */}
      {selectedCustomer && (
        <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-900 text-sm sm:text-base">
                {selectedCustomer.first_name} {selectedCustomer.last_name}
              </p>
              {selectedCustomer.mobile_number && (
                <p className="text-xs sm:text-sm text-gray-600 flex items-center mt-1">
                  <PhoneIcon className="h-3 w-3 sm:h-4 sm:w-4 mr-1 flex-shrink-0" />
                  <span className="truncate">{selectedCustomer.mobile_number}</span>
                </p>
              )}
              {selectedCustomer.email && (
                <p className="text-xs sm:text-sm text-gray-600 truncate">{selectedCustomer.email}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Search Results Dropdown */}
      {showDropdown && searchResults.length > 0 && !selectedCustomer && (
        <div className="absolute z-50 mt-1 w-full bg-white shadow-lg rounded-md border border-gray-200 max-h-60 sm:max-h-80 overflow-auto">
          {searchResults.map((customer) => (
            <button
              key={customer.id}
              type="button"
              onClick={() => handleCustomerSelect(customer)}
              className="w-full text-left px-4 py-3 sm:py-2 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none border-b border-gray-100 last:border-b-0 min-h-[50px] sm:min-h-0"
            >
              <div className="flex items-center">
                <UserIcon className="h-5 w-5 text-gray-400 mr-3 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm sm:text-base font-medium text-gray-900">
                    {customer.first_name} {customer.last_name}
                  </p>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-xs sm:text-sm text-gray-500 mt-0.5">
                    {customer.mobile_number && (
                      <span className="flex items-center">
                        <PhoneIcon className="h-3 w-3 mr-1 flex-shrink-0" />
                        <span className="truncate">{customer.mobile_number}</span>
                      </span>
                    )}
                    {customer.email && (
                      <span className="truncate max-w-[200px] sm:max-w-none">{customer.email}</span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* No Results Message */}
      {showDropdown && searchResults.length === 0 && searchTerm.length >= 2 && !isSearching && (
        <div className="absolute z-50 mt-1 w-full bg-white shadow-lg rounded-md border border-gray-200 p-4">
          <p className="text-sm text-gray-500 text-center">No customers found</p>
        </div>
      )}
    </div>
  )
}