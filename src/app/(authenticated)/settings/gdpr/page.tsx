'use client'

import { useState } from 'react'
import { exportUserData, exportGuestData, deleteUserData } from '@/app/actions/gdpr'
import { Alert, Button, Card, CardBody, CardHeader, Icon, Input, Modal, PageLayout, toast } from '@/ds'

export default function GDPRSettingsPage() {
  const [isExporting, setIsExporting] = useState(false)
  const [guestIdentifier, setGuestIdentifier] = useState('')
  const [isExportingGuest, setIsExportingGuest] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteEmail, setDeleteEmail] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  const downloadJson = (data: string, fileName: string, mimeType: string | undefined) => {
    const blob = new Blob([data], { type: mimeType || 'application/json' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }

  const handleExportData = async () => {
    setIsExporting(true)
    try {
      const result = await exportUserData()
      
      if (result.error) {
        toast.error(result.error)
        return
      }
      
      if (result.success && result.data) {
        downloadJson(result.data, result.fileName, result.mimeType)
        toast.success('Your data has been exported successfully')
      }
    } catch (error) {
      toast.error('Failed to export data')
    } finally {
      setIsExporting(false)
    }
  }

  // A guest's request for their data (BK-081): the same tables an erasure clears.
  const handleExportGuestData = async () => {
    if (!guestIdentifier.trim()) {
      toast.error('Enter the guest\'s email address, phone number or record id')
      return
    }
    setIsExportingGuest(true)
    try {
      const result = await exportGuestData(guestIdentifier.trim())
      if (result.error) {
        toast.error(result.error)
        return
      }
      if (result.success && result.data && result.fileName) {
        downloadJson(result.data, result.fileName, result.mimeType)
        toast.success('The guest\'s data has been exported')
        setGuestIdentifier('')
      }
    } catch (error) {
      toast.error('Failed to export the guest\'s data')
    } finally {
      setIsExportingGuest(false)
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

      {/* A guest's data request (BK-081). Super admins only: the server checks. */}
      <Card>
        <CardHeader title="Export a Guest's Data" />
        <CardBody className="space-y-4">
          <p className="max-w-xl text-sm text-text-muted">
            Answer a guest&apos;s request for a copy of their data. Enter the email address, phone
            number or customer record id they are known by. The file covers everything an erasure
            would clear: their bookings, each ticket&apos;s guest names and answers, messages and the
            audit history about them.
          </p>
          <form
            className="flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault()
              void handleExportGuestData()
            }}
          >
            <div className="flex-1">
              <Input
                label="Guest email, phone or record id"
                value={guestIdentifier}
                onChange={(e) => setGuestIdentifier(e.target.value)}
                placeholder="guest@example.com or 07700 900123"
              />
            </div>
            <Button type="submit" variant="secondary" loading={isExportingGuest} icon={<Icon name="download" size={16} />}>
              Export Guest Data
            </Button>
          </form>
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
