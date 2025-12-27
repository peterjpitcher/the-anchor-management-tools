'use client'

import { useState, useEffect } from 'react'
import { registerNewGuest } from '@/app/actions/event-check-in'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Modal } from '@/components/ui-v2/overlay/Modal'

interface WalkInFormProps {
    eventId: string
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    initialPhone?: string
}

export function WalkInForm({ eventId, isOpen, onClose, onSuccess, initialPhone = '' }: WalkInFormProps) {
    const [loading, setLoading] = useState(false)
    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    const [phone, setPhone] = useState(initialPhone)

    // Update phone state if prop changes
    useEffect(() => {
        if (initialPhone) setPhone(initialPhone)
    }, [initialPhone])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)

        try {
            const result = await registerNewGuest({
                eventId,
                firstName,
                lastName,
                phone: phone || '00000000000',
            })

            if (result.success) {
                toast.success(`Checked in ${firstName}`)
                setFirstName('')
                setLastName('')
                setPhone('')
                onSuccess()
                onClose()
            } else {
                toast.error(result.error || 'Failed to check in guest')
            }
        } catch {
            toast.error('Something went wrong')
        } finally {
            setLoading(false)
        }
    }

    return (
        <Modal
            open={isOpen}
            onClose={onClose}
            title="Add Walk-in Guest"
            description="Quickly register a guest who isn't on the list."
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">First Name</label>
                        <Input
                            id="firstName"
                            value={firstName}
                            onChange={e => setFirstName(e.target.value)}
                            required
                            placeholder="Jane"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">Last Name</label>
                        <Input
                            id="lastName"
                            value={lastName}
                            onChange={e => setLastName(e.target.value)}
                            required
                            placeholder="Doe"
                        />
                    </div>
                </div>

                {/* Phone might be needed for record keeping */}
                <div>
                    <label htmlFor="phone" className="block text-sm font-medium text-gray-700">Mobile Number</label>
                    <Input
                        id="phone"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        placeholder="07700..."
                    />
                </div>

                <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={loading || !firstName || !lastName}>
                        {loading ? 'Checking In...' : 'Check In'}
                    </Button>
                </div>
            </form>
        </Modal>
    )
}
