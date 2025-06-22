'use client'

import { TrashIcon } from '@heroicons/react/24/outline'

interface DeleteBookingButtonProps {
  bookingId: string
  bookingName: string
  deleteAction: (formData: FormData) => Promise<void>
  eventDate?: string
  status?: string
}

export default function DeleteBookingButton({ bookingId, bookingName, deleteAction, eventDate, status }: DeleteBookingButtonProps) {
  const handleDelete = (e: React.MouseEvent<HTMLButtonElement>) => {
    let message = `Are you sure you want to delete this booking for ${bookingName}?`
    
    if (eventDate) {
      const date = new Date(eventDate).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      })
      message += `\n\nEvent Date: ${date}`
    }
    
    if (status && status !== 'draft') {
      message += `\nStatus: ${status.charAt(0).toUpperCase() + status.slice(1)}`
      message += '\n\n⚠️ Warning: This booking is not in draft status.'
    }
    
    message += '\n\nThis action cannot be undone.'
    
    if (!confirm(message)) {
      e.preventDefault()
    }
  }
  
  return (
    <form action={deleteAction} className="inline">
      <input type="hidden" name="bookingId" value={bookingId} />
      <button
        type="submit"
        className={`p-2 rounded-lg transition-colors ${
          status && status !== 'draft' 
            ? 'text-red-700 hover:bg-red-100 hover:text-red-800' 
            : 'text-red-600 hover:bg-red-50'
        }`}
        title={`Delete ${status || 'draft'} booking`}
        onClick={handleDelete}
      >
        <TrashIcon className="h-5 w-5" />
      </button>
    </form>
  )
}