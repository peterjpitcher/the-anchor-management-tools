'use client'

import { memo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { CheckCircleIcon, UserIcon, TicketIcon } from '@heroicons/react/24/solid'
import { CheckIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { Badge } from '@/components/ui-v2/display/Badge'
import { formatPhoneForDisplay } from '@/lib/validation'

export type GuestRecord = {
    id: string // Customer ID
    firstName: string
    lastName: string | null
    mobileNumber: string | null
    email: string | null
    bookingId?: string
    seats: number | null
    notes?: string | null
    checkInId?: string // If present, they are checked in
    checkInTime?: string
}

interface DoorListProps {
    guests: GuestRecord[]
    onCheckIn: (guest: GuestRecord) => void
    onUndoCheckIn: (guest: GuestRecord) => void
    isPending?: boolean
}

function DoorListItem({
    guest,
    onCheckIn,
    onUndoCheckIn,
    disabled
}: {
    guest: GuestRecord
    onCheckIn: (g: GuestRecord) => void
    onUndoCheckIn: (g: GuestRecord) => void
    disabled?: boolean
}) {
    const isCheckedIn = !!guest.checkInId

    return (
        <div className={`
      relative flex items-center gap-3 p-4 border-b border-gray-100 bg-white
      ${isCheckedIn ? 'bg-green-50/30' : ''}
    `}>
            {/* Avatar / Status Icon */}
            <div className="flex-shrink-0">
                {isCheckedIn ? (
                    <div className="h-10 w-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                        <CheckIcon className="h-6 w-6 stroke-[3]" />
                    </div>
                ) : (
                    <div className="h-10 w-10 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center">
                        <UserIcon className="h-6 w-6" />
                    </div>
                )}
            </div>

            {/* Guest Details */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <h3 className={`text-base font-semibold truncate ${isCheckedIn ? 'text-green-900' : 'text-gray-900'}`}>
                        {guest.firstName} {guest.lastName}
                    </h3>
                    {guest.notes && (
                        <span className="inline-block w-2 h-2 rounded-full bg-yellow-400" title="Has notes" />
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
                    {guest.seats ? (
                        <span className="flex items-center gap-1 text-blue-600 font-medium bg-blue-50 px-1.5 py-0.5 rounded text-xs">
                            <TicketIcon className="h-3 w-3" />
                            {guest.seats}
                        </span>
                    ) : (
                        <span>No booking</span>
                    )}

                    {guest.mobileNumber && (
                        <span className="text-xs">{formatPhoneForDisplay(guest.mobileNumber)}</span>
                    )}
                </div>

                {isCheckedIn && guest.checkInTime && (
                    <p className="text-xs text-green-700 mt-0.5">
                        Arrived {formatDistanceToNow(new Date(guest.checkInTime), { addSuffix: true })}
                    </p>
                )}
            </div>

            {/* Action Button */}
            <div className="flex-shrink-0">
                {isCheckedIn ? (
                    <button
                        onClick={() => onUndoCheckIn(guest)}
                        disabled={disabled}
                        className="p-2 text-gray-400 hover:text-gray-600 active:text-gray-800 disabled:opacity-50"
                        title="Undo check-in"
                    >
                        <span className="text-xs font-medium underline decoration-dashed">Undo</span>
                    </button>
                ) : (
                    <button
                        onClick={() => onCheckIn(guest)}
                        disabled={disabled}
                        className="
              h-9 px-4 rounded-full bg-gray-900 text-white font-medium text-sm
              active:scale-95 transition-transform disabled:opacity-50 disabled:scale-100
              shadow-sm hover:bg-gray-800
            "
                    >
                        Check In
                    </button>
                )}
            </div>
        </div>
    )
}

export const DoorList = memo(function DoorList({ guests, onCheckIn, onUndoCheckIn, isPending }: DoorListProps) {
    if (guests.length === 0) {
        return (
            <div className="p-12 text-center text-gray-400">
                <p>No guests found matching your search.</p>
            </div>
        )
    }

    return (
        <div className="pb-20">
            {guests.map(guest => (
                <DoorListItem
                    key={guest.id}
                    guest={guest}
                    onCheckIn={onCheckIn}
                    onUndoCheckIn={onUndoCheckIn}
                    disabled={isPending}
                />
            ))}
        </div>
    )
})
