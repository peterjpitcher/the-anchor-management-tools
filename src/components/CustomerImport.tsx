import { useState } from 'react'
import { ArrowDownTrayIcon, ArrowUpTrayIcon } from '@heroicons/react/24/outline'
import { Customer } from '@/types/database'
import toast from 'react-hot-toast'

interface CustomerImportProps {
  onImportComplete: (customers: Omit<Customer, 'id' | 'created_at'>[]) => void
  onCancel: () => void
  existingCustomers: Customer[]
}

interface ParsedCustomer {
  first_name: string
  last_name?: string
  mobile_number: string
  isValid: boolean
  errors: string[]
}

export function CustomerImport({ onImportComplete, onCancel, existingCustomers }: CustomerImportProps) {
  const [parsedData, setParsedData] = useState<ParsedCustomer[]>([])
  const [isPreviewMode, setIsPreviewMode] = useState(false)

  const downloadTemplate = () => {
    const headers = ['first_name', 'last_name', 'mobile_number']
    const sampleData = ['John', 'Doe', '07123456789']
    const csvContent = [
      headers.join(','),
      sampleData.join(',')
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', 'customer_import_template.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const formatPhoneNumber = (number: string): string => {
    // Remove any non-digit characters
    const cleaned = number.replace(/\D/g, '')
    
    // Handle different UK number formats
    if (cleaned.startsWith('44')) {
      return '+' + cleaned
    } else if (cleaned.startsWith('0')) {
      return '+44' + cleaned.substring(1)
    }
    return cleaned
  }

  const validatePhoneNumber = (number: string): boolean => {
    const formatted = formatPhoneNumber(number)
    // Check if it's a valid UK mobile number in E.164 format
    return /^\+447\d{9}$/.test(formatted)
  }

  const validateCustomer = (customer: Partial<Customer>, rowIndex: number): ParsedCustomer => {
    const errors: string[] = []
    
    if (!customer.first_name?.trim()) {
      errors.push('First name is required')
    }

    if (!customer.mobile_number) {
      errors.push('Mobile number is required')
    } else if (!validatePhoneNumber(customer.mobile_number)) {
      errors.push('Invalid UK mobile number format')
    } else {
      const formattedNumber = formatPhoneNumber(customer.mobile_number)
      // Check for duplicates within the CSV
      const duplicateInCsv = parsedData.some((c, i) => 
        i !== rowIndex && formatPhoneNumber(c.mobile_number) === formattedNumber
      )
      // Check for duplicates in existing customers
      const duplicateInDb = existingCustomers.some(c => 
        formatPhoneNumber(c.mobile_number) === formattedNumber
      )
      
      if (duplicateInCsv || duplicateInDb) {
        errors.push('Duplicate mobile number found')
      }
    }

    return {
      first_name: customer.first_name?.trim() ?? '',
      last_name: customer.last_name?.trim(),
      mobile_number: customer.mobile_number ? formatPhoneNumber(customer.mobile_number) : '',
      isValid: errors.length === 0,
      errors
    }
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.type !== 'text/csv') {
      toast.error('Please upload a CSV file')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const lines = text.split('\n')
      const headers = lines[0].toLowerCase().split(',').map(h => h.trim())

      // Validate headers
      const requiredHeaders = ['first_name', 'mobile_number']
      const missingHeaders = requiredHeaders.filter(h => !headers.includes(h))
      if (missingHeaders.length > 0) {
        toast.error(`Missing required headers: ${missingHeaders.join(', ')}`)
        return
      }

      // Parse and validate data
      const parsedCustomers: ParsedCustomer[] = []
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue

        const values = line.split(',').map(v => v.trim())
        const customer: Partial<Customer> = {}
        headers.forEach((header, index) => {
          if (header === 'first_name') customer.first_name = values[index]
          if (header === 'last_name') customer.last_name = values[index]
          if (header === 'mobile_number') customer.mobile_number = values[index]
        })

        parsedCustomers.push(validateCustomer(customer, parsedCustomers.length))
      }

      setParsedData(parsedCustomers)
      setIsPreviewMode(true)
    }

    reader.readAsText(file)
  }

  const handleImport = async () => {
    if (!parsedData.every(customer => customer.isValid)) {
      toast.error('Please fix all errors before importing')
      return
    }

    try {
      const customersToImport = parsedData.map(({ first_name, last_name, mobile_number }) => ({
        first_name,
        last_name: last_name || '',
        mobile_number
      }))

      onImportComplete(customersToImport)
    } catch (error) {
      console.error('Error importing customers:', error)
      toast.error('Failed to import customers')
    }
  }

  return (
    <div className="max-w-4xl mx-auto py-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">Import Customers</h2>
        <div className="space-x-4">
          <button
            onClick={downloadTemplate}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <ArrowDownTrayIcon className="-ml-1 mr-2 h-5 w-5" />
            Download Template
          </button>
          {!isPreviewMode && (
            <label className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 cursor-pointer">
              <ArrowUpTrayIcon className="-ml-1 mr-2 h-5 w-5" />
              Upload CSV
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          )}
        </div>
      </div>

      {isPreviewMode && parsedData.length > 0 && (
        <>
          <div className="mb-4">
            <h3 className="text-lg font-medium">Preview</h3>
            <p className="text-sm text-gray-500">
              Review the data before importing. All records must be valid to proceed.
            </p>
          </div>

          <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
            <table className="min-w-full divide-y divide-gray-300">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    First Name
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Last Name
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Mobile Number
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {parsedData.map((customer, index) => (
                  <tr key={index} className={customer.isValid ? '' : 'bg-red-50'}>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">
                      {customer.first_name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">
                      {customer.last_name || '-'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">
                      {customer.mobile_number}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm">
                      {customer.isValid ? (
                        <span className="text-green-600">Valid</span>
                      ) : (
                        <span className="text-red-600">{customer.errors.join(', ')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex justify-end space-x-4">
            <button
              onClick={onCancel}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={!parsedData.every(customer => customer.isValid)}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Import Customers
            </button>
          </div>
        </>
      )}
    </div>
  )
} 