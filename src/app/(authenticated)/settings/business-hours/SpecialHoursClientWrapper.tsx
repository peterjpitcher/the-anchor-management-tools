'use client'

import { useState } from 'react'
import { SpecialHours } from '@/types/business-hours'
import { Button } from '@/components/ui-v2/forms/Button'
import { Section } from '@/components/ui-v2/layout/Section'
import { Card } from '@/components/ui-v2/layout/Card'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { PlusIcon, PencilIcon } from '@heroicons/react/24/outline'
import { format } from 'date-fns'
import { SpecialHoursModal } from './SpecialHoursModal'
import { SpecialHoursCalendar } from './SpecialHoursCalendar'
import type { ServiceStatusOverride } from '@/types/business-hours'

interface SpecialHoursClientWrapperProps {
  canManage: boolean
  initialSpecialHours: SpecialHours[]
  specialHoursError?: string
  initialOverrides?: ServiceStatusOverride[]
}

export function SpecialHoursClientWrapper({
  canManage,
  initialSpecialHours,
  specialHoursError,
  initialOverrides,
}: SpecialHoursClientWrapperProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalDate, setModalDate] = useState<Date | null>(null)
  const [modalInitialData, setModalInitialData] = useState<SpecialHours | null>(null)
  const [refreshKey, setRefreshKey] = useState(0) // To trigger re-fetch in calendar/list

  const handleModalClose = () => {
    setIsModalOpen(false)
    setModalDate(null)
    setModalInitialData(null)
    setRefreshKey(prev => prev + 1) // Trigger refresh
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
    <>
      {specialHoursError ? (
        <Section title="Calendar & Exceptions">
          <Card padding="lg">
            <Alert variant="error">{specialHoursError}</Alert>
          </Card>
        </Section>
      ) : (
        <SpecialHoursCalendar
          key={refreshKey} // Force refresh when refreshKey changes
          canManage={canManage}
          initialSpecialHours={initialSpecialHours}
          initialOverrides={initialOverrides}
        />
      )}

      {/* New Section for List View */}
      <Section title="Upcoming Exceptions List">
          <Card>
              <div className="flex justify-end p-4">
                  <Button
                      onClick={handleCreateNew}
                      leftIcon={<PlusIcon className="h-5 w-5" />}
                      disabled={!canManage}
                  >
                      Add New Exception
                  </Button>
              </div>
              {specialHoursError ? (
                <div className="p-4">
                  <Alert variant="error">{specialHoursError}</Alert>
                </div>
              ) : initialSpecialHours.length === 0 ? (
                  <p className="p-4 text-center text-gray-500">No special hours configured.</p>
              ) : (
                  <div className="divide-y divide-gray-200">
                      {initialSpecialHours.map((exception) => (
                          <div key={exception.id} className="flex items-center justify-between p-4">
                              <div className="flex-1">
                                  <p className="font-medium text-gray-900">
                                      {format(new Date(exception.date + 'T00:00:00'), 'EEEE, d MMMM yyyy')}
                                  </p>
                                  <p className="mt-1 text-sm text-gray-600">
                                      {exception.is_closed ? (
                                          <span className="text-red-600">Closed all day</span>
                                      ) : (
                                          <>
                                              <span>Open: {exception.opens || 'N/A'} - {exception.closes || 'N/A'}</span>
                                              {exception.is_kitchen_closed ? (
                                                  <span className="ml-4 text-orange-600">Kitchen closed</span>
                                              ) : exception.kitchen_opens && exception.kitchen_closes ? (
                                                  <span className="ml-4">
                                                      Kitchen: {exception.kitchen_opens} - {exception.kitchen_closes}
                                                  </span>
                                              ) : null}
                                          </>
                                      )}
                                  </p>
                                  {exception.note && (
                                      <p className="mt-1 text-sm text-gray-500 italic">Note: {exception.note}</p>
                                  )}
                              </div>
                              <div className="flex items-center space-x-2">
                                <Button
                                  onClick={() => handleEditException(exception)}
                                  variant="secondary"
                                  size="sm"
                                  leftIcon={<PencilIcon className="h-4 w-4" />}
                                  disabled={!canManage}
                                >
                                  Edit
                                </Button>
                              </div>
                          </div>
                      ))}
                  </div>
              )}
          </Card>
      </Section>

      {isModalOpen && modalDate && (
        <SpecialHoursModal
          isOpen={isModalOpen}
          onClose={handleModalClose}
          date={modalDate}
          initialData={modalInitialData}
          canManage={canManage}
          onSave={handleModalClose} // onClose also triggers refresh, so this is fine
        />
      )}
    </>
  )
}
