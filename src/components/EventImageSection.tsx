'use client'

import { EventImageUpload } from './EventImageUpload'

interface EventImageSectionProps {
  eventId?: string
  heroImageUrl?: string
  onHeroImageChange?: (url: string) => void
}

export function EventImageSection({ 
  eventId, 
  heroImageUrl,
  onHeroImageChange 
}: EventImageSectionProps) {
  // For new events without an ID yet, we'll handle uploads after creation
  if (!eventId) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900">Event Image</h3>
        <div className="rounded-lg bg-gray-50 p-4">
          <p className="text-sm text-gray-600">
            Save the event first to upload images. You can add images after creating the event.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium text-gray-900">Event Image</h3>
      
      <EventImageUpload
        eventId={eventId}
        imageType="hero"
        currentImageUrl={heroImageUrl}
        label="Event Image"
        helpText="Upload the main image for this event"
        onImageUploaded={(url) => onHeroImageChange?.(url)}
        onImageDeleted={() => onHeroImageChange?.('')}
      />

      {/* Optional: Manual URL input */}
      <details className="border rounded-lg p-4">
        <summary className="cursor-pointer text-sm font-medium text-gray-700">
          Or enter image URL manually
        </summary>
        <div className="mt-4">
          <label htmlFor="hero_image_url_manual" className="block text-sm font-medium text-gray-700">
            Image URL
          </label>
          <input
            type="url"
            id="hero_image_url_manual"
            value={heroImageUrl || ''}
            onChange={(e) => onHeroImageChange?.(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            placeholder="https://example.com/event-image.jpg"
          />
        </div>
      </details>
    </div>
  )
}