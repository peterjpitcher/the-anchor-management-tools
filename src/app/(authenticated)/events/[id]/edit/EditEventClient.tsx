'use client'

import { useRouter } from 'next/navigation'
import { EventFormGrouped } from '@/components/features/events/EventFormGrouped'
import { updateEvent } from '@/app/actions/events'
import { Event } from '@/types/database'
import { EventCategory } from '@/types/event-categories'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { toast } from '@/components/ui-v2/feedback/Toast'

interface EditEventClientProps {
    event: Event
    categories: EventCategory[]
}

export default function EditEventClient({ event, categories }: EditEventClientProps) {
    const router = useRouter()

    const handleSubmit = async (data: Partial<Event>) => {
        try {
            const formData = new FormData()

            // Add all fields to formData
            Object.entries(data).forEach(([key, value]) => {
                if (value !== null && value !== undefined) {
                    if (typeof value === 'object') {
                        formData.append(key, JSON.stringify(value))
                    } else {
                        formData.append(key, value.toString())
                    }
                }
            })

            const result = await updateEvent(event.id, formData)

            if (result.error) {
                toast.error(result.error)
            } else {
                toast.success('Event updated successfully')
                router.push(`/events/${event.id}`)
            }
        } catch (error) {
            console.error('Error updating event:', error)
            toast.error('Failed to update event')
        }
    }

    const handleCancel = () => {
        router.push(`/events/${event.id}`)
    }

    return (
        <PageLayout
            title="Edit Event"
            subtitle={`Update the details for ${event.name}`}
            backButton={{
                label: 'Back to Event',
                href: `/events/${event.id}`,
            }}
            containerSize="xl"
        >
            <Card>
                <EventFormGrouped
                    event={event}
                    categories={categories}
                    onSubmit={handleSubmit}
                    onCancel={handleCancel}
                />
            </Card>
        </PageLayout>
    )
}
