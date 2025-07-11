import { useState } from 'react'
import { CloudArrowUpIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline'
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
  const [isImporting, setIsImporting] = useState(false)

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

  const validateCustomer = (customer: Partial<Customer>, allCustomersInFile: Partial<Customer>[]): { errors: string[], customer: ParsedCustomer } => {
    const errors: string[] = []
    
    if (!customer.first_name?.trim()) {
      errors.push('First name is required')
    }

    const formattedNumber = customer.mobile_number ? formatPhoneNumber(customer.mobile_number) : ''
    if (!formattedNumber) {
      errors.push('Mobile number is required')
    } else if (!validatePhoneNumber(formattedNumber)) {
      errors.push('Invalid UK mobile number format')
    } else {
      const isDuplicateInFile = allCustomersInFile.filter(c => c.mobile_number && formatPhoneNumber(c.mobile_number) === formattedNumber).length > 1
      const isDuplicateInDb = existingCustomers.some(c => c.mobile_number && formatPhoneNumber(c.mobile_number) === formattedNumber)
      
      if (isDuplicateInFile) {
        errors.push('Duplicate mobile number within this file')
      }
      if (isDuplicateInDb) {
        errors.push('Mobile number already exists in the database')
      }
    }

    return {
      errors,
      customer: {
        first_name: customer.first_name?.trim() ?? '',
        last_name: customer.last_name?.trim(),
        mobile_number: formattedNumber,
        isValid: errors.length === 0,
        errors: [], // This will be populated later
      }
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
      const lines = text.split('\n').filter(line => line.trim() !== '')
      if (lines.length <= 1) {
        toast.error('CSV file is empty or contains only headers.')
        return
      }
      const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''))

      const requiredHeaders = ['first_name', 'mobile_number']
      const missingHeaders = requiredHeaders.filter(h => !headers.includes(h))
      if (missingHeaders.length > 0) {
        toast.error(`Missing required headers: ${missingHeaders.join(', ')}`)
        return
      }

      const fileCustomers: Partial<Customer>[] = []
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''))
        const customerObj: Partial<Customer> = {}
        headers.forEach((header, index) => {
          if (header === 'first_name') customerObj.first_name = values[index]
          if (header === 'last_name') customerObj.last_name = values[index]
          if (header === 'mobile_number') customerObj.mobile_number = values[index]
        })
        fileCustomers.push(customerObj)
      }
      
      const validatedCustomers = fileCustomers.map(c => {
        const { errors, customer } = validateCustomer(c, fileCustomers)
        customer.errors = errors
        customer.isValid = errors.length === 0
        return customer
      })

      setParsedData(validatedCustomers)
      setIsPreviewMode(true)
      // Reset file input
      event.target.value = ''
    }

    reader.readAsText(file)
  }

  const handleImport = async () => {
    setIsImporting(true)
    const validCustomers = parsedData.filter(c => c.isValid)
    if (validCustomers.length === 0) {
      toast.error("No valid customers to import.")
      setIsImporting(false)
      return
    }

    try {
      const customersToImport = validCustomers.map(({ first_name, last_name, mobile_number }) => ({
        first_name,
        last_name: last_name || '',
        mobile_number,
      }))
      onImportComplete(customersToImport)
      toast.success('Customers imported successfully!')
    } catch (error) {
      console.error('Error importing customers:', error)
      toast.error('Failed to import customers')
    } finally {
      setIsImporting(false)
    }
  }

  const handleClose = () => {
    setParsedData([])
    setIsPreviewMode(false)
    onCancel()
  }

  return (
    <div className="py-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">Import Customers</h2>
        <div className="space-x-4">
          <button
            onClick={downloadTemplate}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
          >
            <ArrowDownTrayIcon className="-ml-1 mr-2 h-5 w-5" />
            Download Template
          </button>
          {!isPreviewMode && (
            <label
              htmlFor="csv-upload"
              className="relative inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 cursor-pointer"
            >
              <CloudArrowUpIcon className="w-5 h-5 mr-2" />
              <span>Upload CSV</span>
              <input
                id="csv-upload"
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          )}
        </div>
      </div>

      {isPreviewMode ? (
        <>
          <div className="mb-4">
            <h3 className="text-lg font-medium">Preview Import</h3>
            <p className="text-sm text-gray-500">
              Review the data before importing. Invalid records will be skipped.
            </p>
          </div>

          <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg mb-6">
            <table className="min-w-full divide-y divide-gray-300">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">First Name</th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Last Name</th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Mobile Number</th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {parsedData.map((customer, index) => (
                  <tr key={index} className={!customer.isValid ? 'bg-red-50' : ''}>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">{customer.first_name}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">{customer.last_name || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">{customer.mobile_number}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm">
                      {customer.isValid ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Valid</span>
                      ) : (
                        <span className="text-red-600" title={customer.errors.join(', ')}>Invalid</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <div className="flex justify-end space-x-3">
             <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={parsedData.filter(c => c.isValid).length === 0 || isImporting}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isImporting ? 'Importing...' : `Import ${parsedData.filter(c => c.isValid).length} Customers`}
            </button>
          </div>
        </>
      ) : (
        <div className="text-center py-12">
            <p className="text-gray-500">
                Upload a CSV file to begin importing customers.
            </p>
        </div>
      )}
    </div>
  )
} 