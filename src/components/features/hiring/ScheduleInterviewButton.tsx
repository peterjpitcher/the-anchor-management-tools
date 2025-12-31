'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { CalendarIcon } from '@heroicons/react/24/outline'
import { scheduleInterviewAction } from '@/actions/hiring'
import { toast } from 'react-hot-toast'

interface ScheduleInterviewButtonProps {
    applicationId: string
    candidateName: string
}

export function ScheduleInterviewButton({ applicationId, candidateName }: ScheduleInterviewButtonProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const router = useRouter()

    // Default start time to next round hour + 24h
    const defaultDate = new Date()
    defaultDate.setDate(defaultDate.getDate() + 1)
    defaultDate.setMinutes(0, 0, 0)
    const defaultDateString = defaultDate.toISOString().slice(0, 16)

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setLoading(true)

        const formData = new FormData(e.currentTarget)
        const data = {
            applicationId,
            startTime: formData.get('startTime'),
            durationMinutes: Number(formData.get('durationMinutes')),
            location: formData.get('location'),
            interviewerEmails: formData.get('interviewerEmails'),
        }

        try {
            const result = await scheduleInterviewAction(data)
            if (result.success) {
                toast.success('Interview scheduled successfully')
                if (result.eventUrl && result.eventUrl !== 'created') {
                    window.open(result.eventUrl, '_blank')
                }
                setIsOpen(false)
                router.refresh()
            } else {
                toast.error(result.error || 'Failed to schedule interview')
            }
        } catch (error) {
            toast.error('An unexpected error occurred')
        } finally {
            setLoading(false)
        }
    }

    return (
        <>
            <Button
                variant="primary"
                leftIcon={<CalendarIcon className="w-5 h-5" />}
                onClick={() => setIsOpen(true)}
            >
                Schedule Interview
            </Button>

            <Modal
                open={isOpen}
                onClose={() => setIsOpen(false)}
                title="Schedule Interview"
                description={`Set up an interview with ${candidateName}`}
                size="md"
            >
                <form onSubmit={handleSubmit} className="space-y-4">
                    <FormGroup label="Date & Time" required>
                        <Input
                            name="startTime"
                            type="datetime-local"
                            defaultValue={defaultDateString}
                            required
                        />
                    </FormGroup>

                    <FormGroup label="Duration">
                        <Select name="durationMinutes" defaultValue="60">
                            <option value="15">15 minutes</option>
                            <option value="30">30 minutes</option>
                            <option value="45">45 minutes</option>
                            <option value="60">1 hour</option>
                            <option value="90">1.5 hours</option>
                            <option value="120">2 hours</option>
                        </Select>
                    </FormGroup>

                    <FormGroup label="Location">
                        <Input
                            name="location"
                            defaultValue="The Anchor Pub"
                            required
                        />
                    </FormGroup>

                    <FormGroup label="Interviewers (emails, comma-separated)">
                        <Input
                            name="interviewerEmails"
                            placeholder="alice@example.com, bob@example.com"
                        />
                        <p className="text-xs text-gray-500 mt-1">Candidate invites are sent automatically when an email is on file.</p>
                    </FormGroup>

                    <div className="flex justify-end gap-3 pt-4">
                        <Button variant="secondary" onClick={() => setIsOpen(false)} disabled={loading} type="button">
                            Cancel
                        </Button>
                        <Button type="submit" loading={loading}>
                            Confirm Schedule
                        </Button>
                    </div>
                </form>
            </Modal>
        </>
    )
}
