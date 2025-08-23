'use client'

import { useEffect, useState } from 'react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { upsertRightToWork, getRightToWorkPhotoUrl, deleteRightToWorkPhoto } from '@/app/actions/employeeActions'
import type { EmployeeRightToWork } from '@/types/database'
import { AlertCircle, CheckCircle, Clock, Upload, Eye, Download, Trash2 } from 'lucide-react'

interface RightToWorkTabProps {
  employeeId: string
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 disabled:opacity-50"
    >
      {pending ? 'Saving...' : 'Save Right to Work'}
    </button>
  )
}

export default function RightToWorkTab({ employeeId }: RightToWorkTabProps) {
  const supabase = useSupabase()
  const [rightToWork, setRightToWork] = useState<EmployeeRightToWork | null>(null)
  const [loading, setLoading] = useState(true)
  const [state, formAction] = useActionState(upsertRightToWork, null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [loadingPhoto, setLoadingPhoto] = useState(false)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [deletingPhoto, setDeletingPhoto] = useState(false)

  useEffect(() => {
    async function fetchRightToWork() {
      const { data, error } = await supabase
        .from('employee_right_to_work')
        .select('*')
        .eq('employee_id', employeeId)
        .single()

      if (!error && data) {
        setRightToWork(data)
        
        // Load photo URL if exists
        if ((data as any).photo_storage_path) {
          setLoadingPhoto(true)
          const { url } = await getRightToWorkPhotoUrl((data as any).photo_storage_path)
          if (url) {
            setPhotoUrl(url)
          }
          setLoadingPhoto(false)
        }
      }
      setLoading(false)
    }

    fetchRightToWork()
  }, [employeeId, supabase])

  // Handle successful form submission
  useEffect(() => {
    if (state?.type === 'success') {
      // Reset selected file name
      setSelectedFileName(null)
      // Refetch the data to get updated photo
      async function refetch() {
        const { data, error } = await supabase
          .from('employee_right_to_work')
          .select('*')
          .eq('employee_id', employeeId)
          .single()

        if (!error && data) {
          setRightToWork(data)
          
          // Load new photo URL if exists
          if ((data as any).photo_storage_path) {
            setLoadingPhoto(true)
            const { url } = await getRightToWorkPhotoUrl((data as any).photo_storage_path)
            if (url) {
              setPhotoUrl(url)
            }
            setLoadingPhoto(false)
          }
        }
      }
      refetch()
    }
  }, [state, employeeId, supabase])

  // Check if document is expiring soon (within 30 days)
  const isExpiringSoon = () => {
    if (!rightToWork?.document_expiry_date) return false
    const expiryDate = new Date(rightToWork.document_expiry_date)
    const thirtyDaysFromNow = new Date()
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)
    return expiryDate <= thirtyDaysFromNow
  }

  // Check if follow-up is due
  const isFollowUpDue = () => {
    if (!rightToWork?.follow_up_date) return false
    const followUpDate = new Date(rightToWork.follow_up_date)
    const today = new Date()
    return followUpDate <= today
  }

  // Handle photo deletion
  const handleDeletePhoto = async () => {
    if (!confirm('Are you sure you want to delete this photo?')) {
      return
    }

    setDeletingPhoto(true)
    const result = await deleteRightToWorkPhoto(employeeId)
    
    if (result.success) {
      setPhotoUrl(null)
      // Update local state
      if (rightToWork) {
        setRightToWork({ ...rightToWork, photo_storage_path: null })
      }
    } else {
      alert(result.error || 'Failed to delete photo')
    }
    
    setDeletingPhoto(false)
  }

  if (loading) {
    return <div className="p-4">Loading right to work information...</div>
  }

  return (
    <div className="space-y-6">
      {/* Status Alerts */}
      {rightToWork && (
        <div className="space-y-3">
          {isExpiringSoon() && (
            <div className="rounded-md bg-yellow-50 p-4">
              <div className="flex">
                <Clock className="h-5 w-5 text-yellow-400 flex-shrink-0" />
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-yellow-800">Document Expiring Soon</h3>
                  <p className="mt-1 text-sm text-yellow-700">
                    This employee&apos;s right to work document expires on {new Date(rightToWork.document_expiry_date!).toLocaleDateString()}.
                    Please ensure you obtain updated documentation before expiry.
                  </p>
                </div>
              </div>
            </div>
          )}
          
          {isFollowUpDue() && (
            <div className="rounded-md bg-red-50 p-4">
              <div className="flex">
                <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">Follow-up Required</h3>
                  <p className="mt-1 text-sm text-red-700">
                    A follow-up check was due on {new Date(rightToWork.follow_up_date!).toLocaleDateString()}.
                    Please verify the employee&apos;s right to work status immediately.
                  </p>
                </div>
              </div>
            </div>
          )}
          
          {rightToWork.document_type && !isExpiringSoon() && !isFollowUpDue() && (
            <div className="rounded-md bg-green-50 p-4">
              <div className="flex">
                <CheckCircle className="h-5 w-5 text-green-400 flex-shrink-0" />
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-green-800">Right to Work Verified</h3>
                  <p className="mt-1 text-sm text-green-700">
                    This employee&apos;s right to work has been verified and is currently valid.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Form */}
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="employee_id" value={employeeId} />
        
        <div className="sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2">
          <label htmlFor="document_type" className="block text-sm font-medium text-gray-700 sm:col-span-1">
            Document Type <span className="text-red-500">*</span>
          </label>
          <div className="mt-1 sm:col-span-3 sm:mt-0">
            <select
              id="document_type"
              name="document_type"
              className="block w-full max-w-lg rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              defaultValue={rightToWork?.document_type || ''}
              required
            >
              <option value="">Select document type</option>
              <option value="List A">List A - Permanent right to work</option>
              <option value="List B">List B - Temporary right to work</option>
            </select>
            <p className="mt-1 text-sm text-gray-500">
              List A: British passport, EEA/Swiss passport, Biometric Residence Permit with indefinite leave<br />
              List B: Passport with valid UK work endorsement, Biometric Residence Permit with limited leave
            </p>
          </div>
        </div>

        <div className="sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2">
          <label htmlFor="document_details" className="block text-sm font-medium text-gray-700 sm:col-span-1">
            Document Details
          </label>
          <div className="mt-1 sm:col-span-3 sm:mt-0">
            <input
              type="text"
              name="document_details"
              id="document_details"
              className="block w-full max-w-lg rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              defaultValue={rightToWork?.document_details || ''}
              placeholder="e.g., British Passport, Biometric Residence Permit"
            />
          </div>
        </div>

        <div className="sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2">
          <label htmlFor="verification_date" className="block text-sm font-medium text-gray-700 sm:col-span-1">
            Verification Date <span className="text-red-500">*</span>
          </label>
          <div className="mt-1 sm:col-span-3 sm:mt-0">
            <input
              type="date"
              name="verification_date"
              id="verification_date"
              className="block w-full max-w-lg rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              defaultValue={rightToWork?.verification_date?.split('T')[0] || ''}
              required
            />
          </div>
        </div>

        <div className="sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2">
          <label htmlFor="document_expiry_date" className="block text-sm font-medium text-gray-700 sm:col-span-1">
            Document Expiry Date
          </label>
          <div className="mt-1 sm:col-span-3 sm:mt-0">
            <input
              type="date"
              name="document_expiry_date"
              id="document_expiry_date"
              className="block w-full max-w-lg rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              defaultValue={rightToWork?.document_expiry_date?.split('T')[0] || ''}
            />
            <p className="mt-1 text-sm text-gray-500">
              Required for List B documents with expiry dates
            </p>
          </div>
        </div>

        <div className="sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2">
          <label htmlFor="follow_up_date" className="block text-sm font-medium text-gray-700 sm:col-span-1">
            Follow-up Date
          </label>
          <div className="mt-1 sm:col-span-3 sm:mt-0">
            <input
              type="date"
              name="follow_up_date"
              id="follow_up_date"
              className="block w-full max-w-lg rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              defaultValue={rightToWork?.follow_up_date?.split('T')[0] || ''}
            />
            <p className="mt-1 text-sm text-gray-500">
              Set a reminder date for follow-up checks on temporary right to work
            </p>
          </div>
        </div>

        <div className="sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2">
          <label htmlFor="document_photo" className="block text-sm font-medium text-gray-700 sm:col-span-1">
            Document Photo
          </label>
          <div className="mt-1 sm:col-span-3 sm:mt-0">
            <div className="space-y-3">
              {/* File upload input */}
              <div>
                <input
                  id="document_photo"
                  name="document_photo"
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      setSelectedFileName(file.name)
                    } else {
                      setSelectedFileName(null)
                    }
                  }}
                  className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none file:mr-4 file:py-2 file:px-4 file:rounded-l-lg file:border-0 file:text-sm file:font-semibold file:bg-green-100 file:text-green-700 hover:file:bg-green-200"
                />
                <p className="mt-1 text-sm text-gray-500">
                  {selectedFileName ? `Selected: ${selectedFileName}` : 'JPG, PNG or PDF up to 10MB'}
                </p>
              </div>
              
              {/* Display existing photo */}
              {photoUrl && (
                <div className="rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-gray-900">Current Document Photo</h4>
                    <div className="flex space-x-2">
                      <a
                        href={photoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-800"
                      >
                        <Eye className="h-4 w-4" />
                        <span>View</span>
                      </a>
                      <a
                        href={photoUrl}
                        download
                        className="inline-flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-800"
                      >
                        <Download className="h-4 w-4" />
                        <span>Download</span>
                      </a>
                      <button
                        onClick={handleDeletePhoto}
                        disabled={deletingPhoto}
                        className="inline-flex items-center space-x-1 text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>{deletingPhoto ? 'Deleting...' : 'Delete'}</span>
                      </button>
                    </div>
                  </div>
                  {photoUrl.match(/\.(jpg|jpeg|png)$/i) && (
                    <img
                      src={photoUrl}
                      alt="Right to work document"
                      className="max-w-full h-auto rounded-md"
                      style={{ maxHeight: '300px' }}
                    />
                  )}
                  {photoUrl.match(/\.pdf$/i) && (
                    <p className="text-sm text-gray-500">PDF document uploaded</p>
                  )}
                </div>
              )}
              
              {loadingPhoto && (
                <div className="text-sm text-gray-500">Loading document photo...</div>
              )}
            </div>
          </div>
        </div>

        {state?.type === 'error' && (
          <div className="rounded-md bg-red-50 p-4">
            <p className="text-sm text-red-800">{state.message}</p>
            {state.errors && (
              <ul className="mt-2 text-sm text-red-800">
                {Object.entries(state.errors).map(([field, errors]) => (
                  <li key={field}>
                    {field}: {Array.isArray(errors) ? errors.join(', ') : errors}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {state?.type === 'success' && (
          <div className="rounded-md bg-green-50 p-4">
            <p className="text-sm text-green-800">{state.message}</p>
          </div>
        )}

        <div className="pt-5">
          <div className="flex justify-end">
            <SubmitButton />
          </div>
        </div>
      </form>

      {/* Information Section */}
      <div className="mt-8 border-t pt-8">
        <h4 className="text-sm font-medium text-gray-900">Important Information</h4>
        <div className="mt-4 prose prose-sm text-gray-500">
          <ul>
            <li>You must check original documents - copies are not acceptable</li>
            <li>Documents must be valid at the time of checking</li>
            <li>You must check that photos match the employee&apos;s appearance</li>
            <li>For List B documents, you must conduct follow-up checks before expiry</li>
            <li>Keep copies of all documents checked for your records</li>
            <li>Failure to conduct proper checks can result in civil penalties</li>
          </ul>
        </div>
      </div>
    </div>
  )
}