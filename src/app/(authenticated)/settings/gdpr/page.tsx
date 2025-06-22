'use client'

import { useState } from 'react'
import { 
  ShieldCheckIcon, 
  ArrowDownTrayIcon, 
  TrashIcon,
  ExclamationTriangleIcon 
} from '@heroicons/react/24/outline'
import { exportUserData, deleteUserData } from '@/app/actions/gdpr'
import toast from 'react-hot-toast'

export default function GDPRSettingsPage() {
  const [isExporting, setIsExporting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteEmail, setDeleteEmail] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  const handleExportData = async () => {
    setIsExporting(true)
    try {
      const result = await exportUserData()
      
      if (result.error) {
        toast.error(result.error)
        return
      }
      
      if (result.success && result.data) {
        // Create and download the file
        const blob = new Blob([result.data], { type: result.mimeType })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = result.fileName
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
        
        toast.success('Your data has been exported successfully')
      }
    } catch (error) {
      toast.error('Failed to export data')
    } finally {
      setIsExporting(false)
    }
  }

  const handleDeleteData = async () => {
    if (!deleteEmail) {
      toast.error('Please enter your email to confirm')
      return
    }

    setIsDeleting(true)
    try {
      const result = await deleteUserData('current-user', deleteEmail)
      
      if (result.error) {
        toast.error(result.error)
        return
      }
      
      if (result.success) {
        toast.success(result.message || 'Deletion request submitted')
        setShowDeleteConfirm(false)
        setDeleteEmail('')
      }
    } catch (error) {
      toast.error('Failed to process deletion request')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            <ShieldCheckIcon className="h-8 w-8 mr-3 text-blue-600" />
            GDPR & Privacy Settings
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Manage your personal data in compliance with GDPR regulations
          </p>
        </div>
      </div>

      {/* Data Export Section */}
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900 flex items-center">
            <ArrowDownTrayIcon className="h-5 w-5 mr-2 text-gray-400" />
            Export Your Data
          </h3>
          <div className="mt-2 max-w-xl text-sm text-gray-500">
            <p>
              Download a copy of all your personal data stored in our system. 
              This includes your profile, bookings, messages, and activity logs.
            </p>
          </div>
          <div className="mt-5">
            <button
              type="button"
              onClick={handleExportData}
              disabled={isExporting}
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:bg-gray-300"
            >
              <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
              {isExporting ? 'Exporting...' : 'Export My Data'}
            </button>
          </div>
        </div>
      </div>

      {/* Data Deletion Section */}
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900 flex items-center">
            <TrashIcon className="h-5 w-5 mr-2 text-red-500" />
            Delete Your Data
          </h3>
          <div className="mt-2 max-w-xl text-sm text-gray-500">
            <p>
              Permanently delete all your personal data from our system. 
              This action cannot be undone.
            </p>
          </div>
          
          {!showDeleteConfirm ? (
            <div className="mt-5">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
              >
                <TrashIcon className="h-4 w-4 mr-2" />
                Request Data Deletion
              </button>
            </div>
          ) : (
            <div className="mt-5 rounded-md bg-red-50 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <ExclamationTriangleIcon className="h-5 w-5 text-red-400" aria-hidden="true" />
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">
                    Confirm Data Deletion
                  </h3>
                  <div className="mt-2 text-sm text-red-700">
                    <p>
                      This will permanently delete all your data. To confirm, 
                      please enter your email address:
                    </p>
                  </div>
                  <div className="mt-4">
                    <input
                      type="email"
                      value={deleteEmail}
                      onChange={(e) => setDeleteEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm"
                    />
                  </div>
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={handleDeleteData}
                      disabled={isDeleting}
                      className="inline-flex items-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 disabled:bg-gray-300"
                    >
                      {isDeleting ? 'Processing...' : 'Confirm Deletion'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDeleteConfirm(false)
                        setDeleteEmail('')
                      }}
                      className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Privacy Information */}
      <div className="bg-blue-50 shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900">
            Your Privacy Rights
          </h3>
          <div className="mt-2 text-sm text-gray-700 space-y-2">
            <p>Under GDPR, you have the following rights:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Right to access your personal data</li>
              <li>Right to rectification of inaccurate data</li>
              <li>Right to erasure ("right to be forgotten")</li>
              <li>Right to data portability</li>
              <li>Right to object to processing</li>
              <li>Right to withdraw consent</li>
            </ul>
            <p className="mt-4">
              For more information, please refer to our{' '}
              <a href="/privacy" className="text-blue-600 hover:text-blue-500 underline">
                Privacy Policy
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}