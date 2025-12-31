
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Select } from '@/components/ui-v2/forms/Select'
import { Badge } from '@/components/ui-v2/display/Badge'
import { createCandidateAction, uploadCandidateCVAction, bulkUploadCVsAction } from '@/actions/hiring'
import { toast } from 'react-hot-toast'
import { UsersIcon, DocumentArrowUpIcon, FolderIcon } from '@heroicons/react/24/outline'

type Job = {
    id: string
    title: string
}

interface AddCandidateModalProps {
    isOpen: boolean
    onClose: () => void
    jobs: Job[]
}

export function AddCandidateModal({ isOpen, onClose, jobs }: AddCandidateModalProps) {
    const [activeTab, setActiveTab] = useState<'manual' | 'upload' | 'bulk'>('manual')
    const [loading, setLoading] = useState(false)
    const [bulkResults, setBulkResults] = useState<Array<{
        fileName: string
        success: boolean
        error?: string
        candidateId?: string | null
        applicationId?: string | null
        needsReview?: boolean
    }> | null>(null)
    const [bulkSummary, setBulkSummary] = useState<{
        processed: number
        success: number
        failed: number
        created?: number
        linked?: number
        needsReview?: number
    } | null>(null)
    const [bulkFileCount, setBulkFileCount] = useState<number | null>(null)
    const [bulkProgress, setBulkProgress] = useState<{ current: number, total: number } | null>(null)
    const router = useRouter()

    const tabs = [
        { id: 'manual', name: 'Manual Entry', icon: UsersIcon },
        { id: 'upload', name: 'Upload CV', icon: DocumentArrowUpIcon },
        { id: 'bulk', name: 'Bulk Upload', icon: FolderIcon },
    ] as const

    const sourceOptions = [
        { value: 'walk_in', label: 'Walk-in' },
        { value: 'referral', label: 'Referral' },
        { value: 'indeed', label: 'Indeed' },
        { value: 'linkedin', label: 'LinkedIn' },
        { value: 'agency', label: 'Agency' },
        { value: 'website', label: 'Website' },
        { value: 'other', label: 'Other' },
    ]

    const handleManualSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setLoading(true)
        const formData = new FormData(e.currentTarget)
        const data = Object.fromEntries(formData.entries())

        // Ensure empty jobId is null for optional logic
        if (data.jobId === '') {
            delete data.jobId
        }

        const result = await createCandidateAction(data)
        setLoading(false)

        if (result.success) {
            toast.success('Candidate added successfully')
            onClose()
            router.refresh()
        } else {
            toast.error(result.error || 'Failed to add candidate')
        }
    }

    const handleUploadSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setLoading(true)
        const formData = new FormData(e.currentTarget)

        const result = await uploadCandidateCVAction(formData)
        setLoading(false)

        if (result.success) {
            toast.success(result.message || 'CV Uploaded')
            onClose()
            router.refresh()
        } else {
            toast.error(result.error || 'Upload failed')
        }
    }

    const handleFileSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files
        if (!files) {
            setBulkFileCount(null)
            return
        }

        if (files.length > 20) {
            toast.error('Maximum 20 files allowed per batch')
            e.target.value = '' // Clear selection
            setBulkFileCount(null)
            return
        }

        setBulkFileCount(files.length)
    }

    const handleBulkSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setLoading(true)
        setBulkResults(null)
        setBulkSummary(null)
        setBulkProgress(null)

        const formData = new FormData(e.currentTarget)
        const files = formData.getAll('files') as File[]
        const jobId = formData.get('jobId') as string
        const source = formData.get('source') as string

        if (!files || files.length === 0) {
            setLoading(false)
            return
        }

        // Separate ZIP files from regular files
        const zipFiles = files.filter(f => f.name.toLowerCase().endsWith('.zip') || f.type === 'application/zip')
        const regularFiles = files.filter(f => !zipFiles.includes(f))

        let results: Array<{
            fileName: string
            success: boolean
            error?: string
            candidateId?: string | null
            applicationId?: string | null
            needsReview?: boolean
            candidateCreated?: boolean
            candidateMatched?: boolean
        }> = []

        // 1. Process ZIPs via Server Action (Legacy Bulk Action)
        if (zipFiles.length > 0) {
            const zipFormData = new FormData()
            zipFormData.append('jobId', jobId)
            zipFormData.append('source', source)
            zipFiles.forEach(f => zipFormData.append('files', f))

            setBulkProgress({ current: 0, total: files.length }) // Indeterminate for zip contents

            const zipResult = await bulkUploadCVsAction(zipFormData)
            if (zipResult.results) {
                // Map server results to our local shape
                const mapped = zipResult.results.map(r => ({
                    ...r,
                    candidateCreated: r.candidateCreated ?? false,
                    candidateMatched: r.candidateMatched ?? false
                }))
                results = [...results, ...mapped]
            }
        }

        // 2. Process Regular Files Individually (Client-Side Iteration)
        // processedCount removed as it was unused and causing lint errors
        const totalRegular = regularFiles.length

        // If we had zips, the progress bar might feel jumpy. 
        // Let's just track progress of the "upload actions" we make.
        // Total steps = regularFiles.length + (zipFiles.length > 0 ? 1 : 0)

        const totalSteps = regularFiles.length
        let currentStep = 0

        for (const file of regularFiles) {
            setBulkProgress({ current: currentStep + 1, total: totalSteps })

            const singleFormData = new FormData()
            singleFormData.append('file', file)
            singleFormData.append('jobId', jobId)
            singleFormData.append('source', source)

            try {
                // We use the single upload action but we need it to return details like the bulk one does.
                // Fortunately uploadCandidateCVAction returns applicationId, but maybe not full details 
                // in the simplified signature used by the single form?
                // Let's check uploadCandidateCVAction signature...
                // It returns { success, message, applicationId, error }. 
                // It MISSES candidateId, match status etc compared to bulk.
                // We might need to enhance uploadCandidateCVAction or use a new action?
                // Wait, processResumeUpload (server side) returns rich data. 
                // uploadCandidateCVAction wraps it but simplifies return.
                // Actually, looking at the code, `uploadCandidateCVAction` returns limited info.
                // However, `bulkUploadCVsAction` iterates `processResumeUpload`. 
                // We could just call `bulkUploadCVsAction` with ONE file at a time!

                const singleBatchData = new FormData()
                singleBatchData.append('jobId', jobId)
                singleBatchData.append('source', source)
                singleBatchData.append('files', file)

                const batchResult = await bulkUploadCVsAction(singleBatchData)
                if (batchResult.results) {
                    const mapped = batchResult.results.map(r => ({
                        ...r,
                        candidateCreated: r.candidateCreated ?? false,
                        candidateMatched: r.candidateMatched ?? false
                    }))
                    results = [...results, ...mapped]
                }
            } catch (err) {
                results.push({
                    fileName: file.name,
                    success: false,
                    error: 'Upload request failed'
                })
            }
            currentStep++
        }

        // Calculate Summary
        const successCount = results.filter(r => r.success).length
        const failCount = results.length - successCount
        const createdCount = results.filter(r => r.success && r.candidateCreated).length
        const linkedCount = results.filter(r => r.success && r.candidateMatched).length
        const needsReviewCount = results.filter(r => r.success && r.needsReview).length

        setBulkSummary({
            processed: results.length,
            success: successCount,
            failed: failCount,
            created: createdCount,
            linked: linkedCount,
            needsReview: needsReviewCount
        })
        setBulkResults(results)
        setLoading(false)
        setBulkProgress(null)

        if (successCount > 0) {
            toast.success(`Processed ${results.length} files`)
            router.refresh()
        } else {
            toast.error('All uploads failed')
        }
    }

    return (
        <Modal
            open={isOpen}
            onClose={onClose}
            title="Add Candidate"
            description="Add a new candidate manually or upload CVs."
            size="lg"
        >
            {/* Tabs */}
            <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`
              flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors
              ${activeTab === tab.id
                                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                            }
            `}
                    >
                        <tab.icon className="w-5 h-5" />
                        {tab.name}
                    </button>
                ))}
            </div>

            {activeTab === 'manual' && (
                <form onSubmit={handleManualSubmit} className="space-y-4">
                    <FormGroup label="Job Role">
                        <Select name="jobId">
                            <option value="">Unassigned (General Pool)</option>
                            {jobs.map(job => (
                                <option key={job.id} value={job.id}>{job.title}</option>
                            ))}
                        </Select>
                    </FormGroup>

                    <FormGroup label="Source">
                        <Select name="source" defaultValue="walk_in">
                            {sourceOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </Select>
                    </FormGroup>

                    <div className="grid grid-cols-2 gap-4">
                        <FormGroup label="First Name" required>
                            <Input name="firstName" required placeholder="John" />
                        </FormGroup>
                        <FormGroup label="Last Name" required>
                            <Input name="lastName" required placeholder="Doe" />
                        </FormGroup>
                    </div>

                    <FormGroup label="Email" required>
                        <Input name="email" type="email" required placeholder="john@example.com" />
                    </FormGroup>

                    <div className="grid grid-cols-2 gap-4">
                        <FormGroup label="Phone">
                            <Input name="phone" placeholder="+44 7700 900000" />
                        </FormGroup>
                        <FormGroup label="Location">
                            <Input name="location" placeholder="London, UK" />
                        </FormGroup>
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                        <Button variant="secondary" onClick={onClose} type="button">Cancel</Button>
                        <Button type="submit" loading={loading}>Add Candidate</Button>
                    </div>
                </form>
            )}

            {activeTab === 'upload' && (
                <form onSubmit={handleUploadSubmit} className="space-y-4">
                    <FormGroup label="Job Role">
                        <Select name="jobId">
                            <option value="">Unassigned (General Pool)</option>
                            {jobs.map(job => (
                                <option key={job.id} value={job.id}>{job.title}</option>
                            ))}
                        </Select>
                    </FormGroup>

                    <FormGroup label="Source">
                        <Select name="source" defaultValue="other">
                            {sourceOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </Select>
                    </FormGroup>

                    <FormGroup label="Resume (PDF/DOCX)" required>
                        <input
                            type="file"
                            name="file"
                            required
                            accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.gif"
                            className="block w-full text-sm text-gray-500
                        file:mr-4 file:py-2 file:px-4
                        file:rounded-md file:border-0
                        file:text-sm file:font-semibold
                        file:bg-indigo-50 file:text-indigo-700
                        hover:file:bg-indigo-100
                        dark:file:bg-gray-800 dark:file:text-gray-300
                    "
                        />
                        <p className="mt-1 text-xs text-gray-500">
                            AI will automatically extract candidate details from the CV.
                        </p>
                    </FormGroup>

                    <div className="flex justify-end gap-3 pt-4">
                        <Button variant="secondary" onClick={onClose} type="button">Cancel</Button>
                        <Button type="submit" loading={loading} leftIcon={<DocumentArrowUpIcon className="w-5 h-5" />}>
                            Upload & Parse
                        </Button>
                    </div>
                </form>
            )}

            {activeTab === 'bulk' && (
                <form onSubmit={handleBulkSubmit} className="space-y-4">
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-md mb-4">
                        <p className="text-sm text-blue-700 dark:text-blue-300">
                            <strong>Bulk Upload:</strong> Select multiple CVs to create candidates automatically.
                        </p>
                    </div>

                    <FormGroup label="Job Role">
                        <Select name="jobId">
                            <option value="">Unassigned (General Pool)</option>
                            {jobs.map(job => (
                                <option key={job.id} value={job.id}>{job.title}</option>
                            ))}
                        </Select>
                    </FormGroup>

                    <FormGroup label="Source">
                        <Select name="source" defaultValue="other">
                            {sourceOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </Select>
                    </FormGroup>

                    <FormGroup label="Resumes (Multiple)" required>
                        <input
                            type="file"
                            name="files"
                            required
                            multiple
                            accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.gif,.zip"
                            onChange={handleFileSelection}
                            className="block w-full text-sm text-gray-500
                        file:mr-4 file:py-2 file:px-4
                        file:rounded-md file:border-0
                        file:text-sm file:font-semibold
                        file:bg-indigo-50 file:text-indigo-700
                        hover:file:bg-indigo-100
                        dark:file:bg-gray-800 dark:file:text-gray-300
                    "
                        />
                        <p className="mt-1 text-xs text-gray-500 flex justify-between">
                            <span>
                                {bulkFileCount != null
                                    ? `${bulkFileCount} file${bulkFileCount === 1 ? '' : 's'} selected`
                                    : 'Select files'
                                }
                            </span>
                            <span className="font-medium text-amber-600">Max 20 files per batch</span>
                        </p>
                    </FormGroup>

                    {loading && (
                        <div className="space-y-2">
                            <div className="rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-600">
                                {bulkProgress
                                    ? `Processing file ${bulkProgress.current} of ${bulkProgress.total}...`
                                    : 'Initializing upload...'
                                }
                            </div>
                            {bulkProgress && (
                                <div className="w-full bg-gray-200 rounded-full h-1.5 dark:bg-gray-700">
                                    <div
                                        className="bg-indigo-600 h-1.5 rounded-full transition-all duration-300"
                                        style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                                    ></div>
                                </div>
                            )}
                        </div>
                    )}

                    {bulkSummary && (
                        <div className="rounded-md border border-gray-200 bg-white p-4 space-y-3">
                            <div className="flex flex-wrap gap-2">
                                <Badge variant="info" size="sm">Processed: {bulkSummary.processed}</Badge>
                                <Badge variant="success" size="sm">Success: {bulkSummary.success}</Badge>
                                <Badge variant="error" size="sm">Failed: {bulkSummary.failed}</Badge>
                                {typeof bulkSummary.created === 'number' && (
                                    <Badge variant="default" size="sm">Created: {bulkSummary.created}</Badge>
                                )}
                                {typeof bulkSummary.linked === 'number' && (
                                    <Badge variant="default" size="sm">Linked: {bulkSummary.linked}</Badge>
                                )}
                                {typeof bulkSummary.needsReview === 'number' && (
                                    <Badge variant="warning" size="sm">Needs review: {bulkSummary.needsReview}</Badge>
                                )}
                            </div>
                            {bulkResults && bulkResults.length > 0 && (
                                <div className="space-y-2 max-h-48 overflow-auto">
                                    {bulkResults.map((result) => (
                                        <div key={result.fileName} className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between">
                                            <div className="text-gray-700">{result.fileName}</div>
                                            <div className="flex items-center gap-3">
                                                <span className={result.success ? 'text-green-600' : 'text-red-600'}>
                                                    {result.success ? 'Uploaded' : result.error || 'Failed'}
                                                </span>
                                                {result.needsReview && (
                                                    <Badge variant="warning" size="sm">Needs review</Badge>
                                                )}
                                                {result.success && result.candidateId && (
                                                    <div className="flex items-center gap-2 text-xs">
                                                        <Link
                                                            href={`/hiring/candidates/${result.candidateId}`}
                                                            className="text-blue-600 hover:text-blue-500"
                                                        >
                                                            Candidate
                                                        </Link>
                                                        {result.applicationId && (
                                                            <Link
                                                                href={`/hiring/applications/${result.applicationId}`}
                                                                className="text-blue-600 hover:text-blue-500"
                                                            >
                                                                Application
                                                            </Link>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex justify-end gap-3 pt-4">
                        <Button variant="secondary" onClick={onClose} type="button">Close</Button>
                        <Button type="submit" loading={loading} leftIcon={<FolderIcon className="w-5 h-5" />}>
                            Upload All
                        </Button>
                    </div>
                </form>
            )}
        </Modal>
    )
}
