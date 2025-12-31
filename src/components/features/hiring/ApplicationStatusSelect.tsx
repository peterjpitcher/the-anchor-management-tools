'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Select } from '@/components/ui-v2/forms/Select'
import { updateApplicationStatusAction } from '@/actions/hiring'
import { toast } from 'react-hot-toast'
import type { HiringApplication } from '@/types/database'

interface ApplicationStatusSelectProps {
    applicationId: string
    currentStatus: HiringApplication['stage']
}

export function ApplicationStatusSelect({ applicationId, currentStatus }: ApplicationStatusSelectProps) {
    const router = useRouter()
    const [loading, setLoading] = useState(false)

    const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newStatus = e.target.value
        setLoading(true)

        try {
            const result = await updateApplicationStatusAction(applicationId, newStatus)
            if (result.success) {
                toast.success('Status updated')
                router.refresh()
            } else {
                toast.error(result.error || 'Failed to update status')
                // Revert/Refresh to ensure UI consistency if needed, though router.refresh is usually enough if it re-renders
            }
        } catch (err) {
            toast.error('An error occurred')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="w-48">
            <Select
                value={currentStatus}
                onChange={handleChange}
                disabled={loading}
                loading={loading}
                options={[
                    { value: 'new', label: 'New' },
                    { value: 'screening', label: 'Screening' },
                    { value: 'screened', label: 'Screened' },
                    { value: 'in_conversation', label: 'In conversation' },
                    { value: 'interview_scheduled', label: 'Interview scheduled' },
                    { value: 'interviewed', label: 'Interviewed' },
                    { value: 'offer', label: 'Offer' },
                    { value: 'hired', label: 'Hired' },
                    { value: 'rejected', label: 'Rejected' },
                    { value: 'withdrawn', label: 'Withdrawn' },
                ]}
            />
        </div>
    )
}
