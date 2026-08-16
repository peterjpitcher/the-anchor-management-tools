'use client'

import { Alert, Button, Card, Input } from '@/ds'
import { Icon } from '@/ds/icons'
import { DAY_NAMES, type BusinessHours } from '@/types/business-hours'
import {
  applyServiceWindows,
  describeGaps,
  readServiceWindows,
  validateServiceWindows,
  toClock,
  type ServiceWindowInput,
} from '@/lib/business-hours/service-windows'

interface FoodServiceEditorProps {
  hours: BusinessHours[]
  editable: boolean
  onChange: (dayOfWeek: number, schedule: BusinessHours['schedule_config']) => void
}

/**
 * Food service times, one list per day.
 *
 * The kitchen hours above are the outer bound: when the kitchen is staffed. These
 * are when food can actually be booked inside it. Most days that is a single
 * service covering the whole window, and the two look redundant. They stop being
 * redundant the moment a day has a break in the middle, which is what this exists
 * for: the grid above has one kitchen start and one kitchen end and cannot express
 * lunch, a gap, then dinner.
 *
 * Sunday lunch keeps its own control in the grid, so this only manages the
 * ordinary food services and leaves that slot untouched.
 */
export function FoodServiceEditor({ hours, editable, onChange }: FoodServiceEditorProps) {
  // Monday-first, matching the grid above.
  const ordered = [
    ...hours.filter(h => h.day_of_week >= 1 && h.day_of_week <= 6),
    ...hours.filter(h => h.day_of_week === 0),
  ]

  const update = (day: BusinessHours, services: ServiceWindowInput[]) => {
    onChange(day.day_of_week, applyServiceWindows(day.schedule_config, services))
  }

  return (
    <div className="space-y-3 p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Food service times</h3>
        <p className="mt-1 text-sm text-gray-600">
          When food can be booked, inside the kitchen hours above. Add a second service on a
          day that has a break in the middle. A time in a gap cannot be booked.
        </p>
      </div>

      {ordered.map(day => {
        if (day.is_closed || day.is_kitchen_closed) return null

        const services = readServiceWindows(day.schedule_config)
        const problems = validateServiceWindows(services, day.kitchen_opens, day.kitchen_closes)
        const gaps = describeGaps(services, day.kitchen_opens, day.kitchen_closes)
        const generalProblem = problems.find(p => p.index === null)

        return (
          <Card key={day.day_of_week} variant="bordered" padding="sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-sm font-medium text-gray-900">{DAY_NAMES[day.day_of_week]}</span>
                <span className="ml-2 text-xs text-gray-500">
                  kitchen {toClock(day.kitchen_opens) || '?'} to {toClock(day.kitchen_closes) || '?'}
                </span>
              </div>
              {editable && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={<Icon name="plus" size={14} />}
                  onClick={() =>
                    update(day, [
                      ...services,
                      {
                        name: services.length === 0 ? 'food service' : 'dinner',
                        starts_at: toClock(day.kitchen_opens),
                        ends_at: toClock(day.kitchen_closes),
                      },
                    ])
                  }
                >
                  Add a service
                </Button>
              )}
            </div>

            {generalProblem && (
              <Alert variant="warning" className="mb-2">
                {generalProblem.message}
              </Alert>
            )}

            {services.length === 0 ? (
              <p className="text-sm text-gray-500">
                No services set, so food is bookable across the whole kitchen window.
              </p>
            ) : (
              <div className="space-y-2">
                {services.map((service, index) => {
                  const problem = problems.find(p => p.index === index)
                  return (
                    <div key={index} className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          aria-label={`${DAY_NAMES[day.day_of_week]} service ${index + 1} name`}
                          value={service.name}
                          placeholder="lunch"
                          disabled={!editable}
                          className="w-32"
                          onChange={e => {
                            const next = [...services]
                            next[index] = { ...service, name: e.target.value }
                            update(day, next)
                          }}
                        />
                        <Input
                          type="time"
                          aria-label={`${DAY_NAMES[day.day_of_week]} service ${index + 1} start`}
                          value={service.starts_at}
                          disabled={!editable}
                          className="w-32"
                          onChange={e => {
                            const next = [...services]
                            next[index] = { ...service, starts_at: e.target.value }
                            update(day, next)
                          }}
                        />
                        <span className="text-sm text-gray-500">to</span>
                        <Input
                          type="time"
                          aria-label={`${DAY_NAMES[day.day_of_week]} service ${index + 1} end`}
                          value={service.ends_at}
                          disabled={!editable}
                          className="w-32"
                          onChange={e => {
                            const next = [...services]
                            next[index] = { ...service, ends_at: e.target.value }
                            update(day, next)
                          }}
                        />
                        {editable && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            aria-label={`Remove ${DAY_NAMES[day.day_of_week]} service ${index + 1}`}
                            onClick={() => update(day, services.filter((_, i) => i !== index))}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                      {problem && <p className="text-xs text-red-600">{problem.message}</p>}
                    </div>
                  )
                })}
              </div>
            )}

            {gaps.length > 0 && problems.length === 0 && (
              <p className="mt-2 text-xs text-gray-600">
                Not bookable: {gaps.join(', ')}.
              </p>
            )}
          </Card>
        )
      })}
    </div>
  )
}
