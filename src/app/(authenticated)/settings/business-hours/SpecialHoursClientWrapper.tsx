'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SpecialHours } from '@/types/business-hours'
import { Alert, Button, Card, CardBody, CardHeader, Empty, Icon, PageLayout } from '@/ds'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { SPECIAL_HOURS_TEXT_CLASSES } from '../_shared/status-ui'
import { SpecialHoursModal } from './SpecialHoursModal'
import { SpecialHoursCalendar } from './SpecialHoursCalendar'
import type { ServiceStatusOverride } from '@/types/business-hours'

interface SpecialHoursClientWrapperProps {
  canManage: boolean
  initialSpecialHours: SpecialHours[]
  specialHoursError?: string
  initialOverrides?: ServiceStatusOverride[]
  /** The regular weekly schedule card, rendered on the server and shown first. */
  weeklySchedule: React.ReactNode
}

/**
 * The Business Hours page. It owns the page header so that "New Exception", the page's main
 * action, sits in the header beside the title while the dialog it opens lives here too. The
 * weekly schedule is rendered by the server page and passed in.
 */
export function SpecialHoursClientWrapper({
  canManage,
  initialSpecialHours,
  specialHoursError,
  initialOverrides,
  weeklySchedule,
}: SpecialHoursClientWrapperProps) {
  const router = useRouter()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalDate, setModalDate] = useState<Date | null>(null)
  const [modalInitialData, setModalInitialData] = useState<SpecialHours | null>(null)

  const handleModalClose = () => {
    setIsModalOpen(false)
    setModalDate(null)
    setModalInitialData(null)
  }

  const handleModalSave = () => {
    router.refresh()
  }

  const handleCreateNew = () => {
    setModalDate(new Date()) // Default to today
    setModalInitialData(null)
    setIsModalOpen(true)
  }

  const handleEditException = (exception: SpecialHours) => {
    setModalDate(new Date(exception.date + 'T00:00:00')) // Set date for modal
    setModalInitialData(exception)
    setIsModalOpen(true)
  }

  return (
    <PageLayout
      title="Business Hours"
      subtitle="Manage your regular opening hours and special dates"
      backButton={{ label: 'Back to Settings', href: '/settings' }}
      headerActions={
        <Button
          size="sm"
          variant="primary"
          onClick={handleCreateNew}
          icon={<Icon name="plus" size={16} />}
          disabled={!canManage}
        >
          New Exception
        </Button>
      }
    >
      {weeklySchedule}

      {specialHoursError ? (
        <Card>
          <CardHeader title="Exceptions & Holidays Calendar" />
          <CardBody>
            <Alert tone="danger">{specialHoursError}</Alert>
          </CardBody>
        </Card>
      ) : (
        <SpecialHoursCalendar
          canManage={canManage}
          initialSpecialHours={initialSpecialHours}
          initialOverrides={initialOverrides}
        />
      )}

      <Card>
        <CardHeader title="Upcoming Exceptions List" />
        {specialHoursError ? (
          <CardBody>
            <Alert tone="danger">{specialHoursError}</Alert>
          </CardBody>
        ) : initialSpecialHours.length === 0 ? (
          <Empty size="sm" title="No exceptions yet" description="Dates with different hours appear here once they are added." />
        ) : (
          <div className="divide-y divide-border">
            {initialSpecialHours.map((exception) => (
              <div key={exception.id} className="flex items-center justify-between gap-4 px-pad-card py-4">
                <div className="flex-1">
                  <p className="font-medium text-text">
                    {format(new Date(exception.date + 'T00:00:00'), 'EEEE, d MMMM yyyy')}
                  </p>
                  <p className="mt-1 text-sm text-text-muted">
                    {exception.is_closed ? (
                      <span className={SPECIAL_HOURS_TEXT_CLASSES.closed}>Closed all day</span>
                    ) : (
                      <>
                        <span>Open: {exception.opens || 'N/A'} - {exception.closes || 'N/A'}</span>
                        {exception.is_kitchen_closed ? (
                          <span className={cn('ml-4', SPECIAL_HOURS_TEXT_CLASSES.kitchenClosed)}>Kitchen closed</span>
                        ) : exception.kitchen_opens && exception.kitchen_closes ? (
                          <span className="ml-4">
                            Kitchen: {exception.kitchen_opens} - {exception.kitchen_closes}
                          </span>
                        ) : null}
                      </>
                    )}
                  </p>
                  {exception.note && (
                    <p className="mt-1 text-sm text-text-muted italic">Note: {exception.note}</p>
                  )}
                </div>
                <Button
                  onClick={() => handleEditException(exception)}
                  variant="secondary"
                  size="sm"
                  icon={<Icon name="edit" size={16} />}
                  disabled={!canManage}
                >
                  Edit
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {isModalOpen && modalDate && (
        <SpecialHoursModal
          isOpen={isModalOpen}
          onClose={handleModalClose}
          date={modalDate}
          initialData={modalInitialData}
          canManage={canManage}
          onSave={handleModalSave}
        />
      )}
    </PageLayout>
  )
}
