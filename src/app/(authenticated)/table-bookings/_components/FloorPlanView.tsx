'use client'

import { Card, CardBody } from '@/ds'
import type { TableInfo } from './TableBookingsClient'

/* ------------------------------------------------------------------ */
/*  Floor Plan View                                                    */
/* ------------------------------------------------------------------ */

const statusColors: Record<string, { bg: string; text: string; border: string }> = {
  available: { bg: 'bg-success-soft', text: 'text-success-fg', border: 'border-success' },
  occupied: { bg: 'bg-warning-soft', text: 'text-warning-fg', border: 'border-warning' },
  reserved: { bg: 'bg-info-soft', text: 'text-info-fg', border: 'border-info' },
  blocked: { bg: 'bg-surface-2', text: 'text-text-muted', border: 'border-border-strong' },
}

interface FloorPlanViewProps {
  tables: TableInfo[]
}

export function FloorPlanView({ tables }: FloorPlanViewProps) {
  return (
    <Card>
      <CardBody>
        {/* Legend */}
        <div className="flex items-center gap-4 mb-4">
          {Object.entries(statusColors).map(([status, colors]) => (
            <div key={status} className="flex items-center gap-1.5">
              <span className={`w-3 h-3 rounded-full ${colors.bg} border ${colors.border}`} />
              <span className="text-xs text-text-muted capitalize">{status}</span>
            </div>
          ))}
        </div>

        {/* Floor plan canvas */}
        <div className="relative w-full h-[500px] bg-surface-hover rounded-lg border border-border">
          {tables.map((table) => {
            const colors = statusColors[table.status] || statusColors.available
            const isCircle = table.shape === 'circle'

            return (
              <div
                key={table.id}
                className={`absolute flex flex-col items-center justify-center border-2 ${colors.bg} ${colors.text} ${colors.border} cursor-pointer hover:scale-105 transition-transform ${isCircle ? 'rounded-full' : 'rounded-lg'}`}
                style={{
                  left: `${table.x}%`,
                  top: `${table.y}%`,
                  width: isCircle ? '60px' : '80px',
                  height: isCircle ? '60px' : '50px',
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <span className="text-xs font-bold">{table.name.replace('Table ', 'T')}</span>
                <span className="text-[10px]">{table.capacity} pax</span>
              </div>
            )
          })}
        </div>

        <p className="text-xs text-text-muted mt-3">
          Read-only floor plan. Editable layout is planned for a future release.
        </p>
      </CardBody>
    </Card>
  )
}
