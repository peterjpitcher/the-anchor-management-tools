'use client'

import { useState } from 'react'
import { exportUserData, deleteUserData } from '@/app/actions/gdpr'
import { Alert, Button, Card, CardBody, CardHeader, Icon, Input, Modal, PageLayout, toast } from '@/ds'

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

  const closeDeleteConfirm = () => {
    if (isDeleting) return
    setShowDeleteConfirm(false)
    setDeleteEmail('')
  }

  const handleDeleteData = async () => {
    if (!deleteEmail) {
      toast.error('Please enter your email to confirm')
      return
    }

    setIsDeleting(true)
    try {
      const result = await deleteUserData(deleteEmail)
      
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
    <PageLayout
      title="GDPR & Privacy"
      subtitle="Manage your personal data in compliance with GDPR regulations"
      backButton={{ label: 'Back to Settings', href: '/settings' }}
    >
      {/* Data Export Card */}
      <Card>
        <CardHeader title="Export Your Data" />
        <CardBody className="space-y-4">
          <p className="max-w-xl text-sm text-text-muted">
            Download a copy of all your personal data stored in our system.
            This includes your profile, bookings, messages, and activity logs.
          </p>
          <Button variant="primary"
            onClick={handleExportData}
            loading={isExporting}
            icon={<Icon name="download" size={16} />}
          >
            Export My Data
          </Button>
        </CardBody>
      </Card>

      {/* Data Deletion Card */}
      <Card>
        <CardHeader title="Delete Your Data" />
        <CardBody className="space-y-4">
          <p className="max-w-xl text-sm text-text-muted">
            Permanently delete all your personal data from our system.
            This action cannot be undone.
          </p>
          <Button
            variant="danger"
            onClick={() => setShowDeleteConfirm(true)}
            icon={<Icon name="trash" size={16} />}
          >
            Request Data Deletion
          </Button>
        </CardBody>
      </Card>

      {/* A confirmation with a field, so a Modal whose footer mirrors ConfirmDialog. */}
      <Modal
        open={showDeleteConfirm}
        onClose={closeDeleteConfirm}
        title="Request Data Deletion"
        description="Enter your email address to confirm. This cannot be undone."
        width="sm"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeDeleteConfirm} disabled={isDeleting}>
              Cancel
            </Button>
            <Button type="submit" form="gdpr-delete-form" variant="danger" loading={isDeleting}>
              Request Deletion
            </Button>
          </>
        }
      >
        <form
          id="gdpr-delete-form"
          onSubmit={(event) => {
            event.preventDefault()
            void handleDeleteData()
          }}
        >
          <Input
            type="email"
            label="Your email address"
            value={deleteEmail}
            onChange={(e) => setDeleteEmail(e.target.value)}
            placeholder="your@email.com"
          />
        </form>
      </Modal>

      {/* Privacy Rights Information */}
      <Alert tone="info" title="Your Privacy Rights">
        <div className="space-y-2">
          <p>Under GDPR, you have the following rights:</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>Right to access your personal data</li>
            <li>Right to rectification of inaccurate data</li>
            <li>Right to erasure (&quot;right to be forgotten&quot;)</li>
            <li>Right to data portability</li>
            <li>Right to object to processing</li>
            <li>Right to withdraw consent</li>
          </ul>
          <p className="mt-4">
            For more information, please refer to our{' '}
            <a href="/privacy" className="rounded-sm text-primary underline hover:text-primary-hover focus-visible:outline-hidden focus-visible:shadow-ring">
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </Alert>
    </PageLayout>
  )
}
