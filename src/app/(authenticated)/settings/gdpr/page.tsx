'use client'

import { useState } from 'react'
import { 
  ShieldCheckIcon, 
  ArrowDownTrayIcon, 
  TrashIcon
} from '@heroicons/react/24/outline'
import { exportUserData, deleteUserData } from '@/app/actions/gdpr'
import toast from 'react-hot-toast'
import { Page } from '@/components/ui-v2/layout/Page'
import { Section } from '@/components/ui-v2/layout/Section'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Alert } from '@/components/ui-v2/feedback/Alert'

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
    <Page
      title="GDPR & Privacy Settings"
      description="Manage your personal data in compliance with GDPR regulations"
      breadcrumbs={[
        { label: 'Settings', href: '/settings' },
        { label: 'GDPR & Privacy' }
      ]}
    >

      <Section className="space-y-6">
        {/* Data Export Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <ArrowDownTrayIcon className="h-5 w-5 mr-2 text-gray-400" />
              Export Your Data
            </CardTitle>
            <CardDescription className="mt-2 max-w-xl">
              Download a copy of all your personal data stored in our system. 
              This includes your profile, bookings, messages, and activity logs.
            </CardDescription>
          </CardHeader>
          <div className="px-5 pb-5 sm:px-6 sm:pb-6">
            <Button variant="primary"
              onClick={handleExportData}
              loading={isExporting}
              leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
            >
              {isExporting ? 'Exporting...' : 'Export My Data'}
            </Button>
          </div>
        </Card>

        {/* Data Deletion Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <TrashIcon className="h-5 w-5 mr-2 text-red-500" />
              Delete Your Data
            </CardTitle>
            <CardDescription className="mt-2 max-w-xl">
              Permanently delete all your personal data from our system. 
              This action cannot be undone.
            </CardDescription>
          </CardHeader>
          <div className="px-5 pb-5 sm:px-6 sm:pb-6">
            {!showDeleteConfirm ? (
              <Button
                variant="danger"
                onClick={() => setShowDeleteConfirm(true)}
                leftIcon={<TrashIcon className="h-4 w-4" />}
              >
                Request Data Deletion
              </Button>
            ) : (
              <Alert
                variant="error"
                title="Confirm Data Deletion"
                
              >
                <div className="mt-4 space-y-4">
                  <Input
                    type="email"
                    value={deleteEmail}
                    onChange={(e) => setDeleteEmail(e.target.value)}
                    placeholder="your@email.com"
                    error={false}
                  />
                  <div className="flex gap-3">
                    <Button
                      variant="danger"
                      onClick={handleDeleteData}
                      loading={isDeleting}
                      size="sm"
                    >
                      {isDeleting ? 'Processing...' : 'Confirm Deletion'}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setShowDeleteConfirm(false)
                        setDeleteEmail('')
                      }}
                      size="sm"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              
            This will permanently delete all your data. To confirm, please enter your email address:</Alert>
            )}
          </div>
        </Card>

        {/* Privacy Rights Information */}
        <Card variant="bordered" className="bg-blue-50 border-blue-200">
          <CardHeader>
            <CardTitle>Your Privacy Rights</CardTitle>
          </CardHeader>
          <div className="px-5 pb-5 sm:px-6 sm:pb-6">
            <div className="text-sm text-gray-700 space-y-2">
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
        </Card>
      </Section>
    </Page>
  )
}