import { Card, CardBody, CardHeader, LinkButton } from '@/ds'
import { Icon } from '@/ds/icons'
import type { Event } from '@/types/database'
import {
  EVENT_IMAGE_VARIANTS,
  EVENT_IMAGE_VARIANT_ORDER,
  buildEventImageDownloadFileName,
  buildEventImageDownloadUrl,
  eventImageFileExtension,
} from '@/lib/events/imageVariants'

export function EventArtworkDownloadsCard({ event }: { event: Event }) {
  const assets = EVENT_IMAGE_VARIANT_ORDER.flatMap((variant) => {
    const config = EVENT_IMAGE_VARIANTS[variant]
    const url = event[config.cacheColumn]
    return url ? [{ variant, config, url }] : []
  })

  return (
    <Card>
      <CardHeader
        title="Event Artwork"
        subtitle="Download ready-to-use artwork for this event."
      />
      <CardBody>
        {assets.length === 0 ? (
          <p className="text-sm text-text-muted">No artwork has been added yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {assets.map(({ variant, config, url }) => {
              const fileName = buildEventImageDownloadFileName(event.name, variant, url)
              const isPdf = eventImageFileExtension(url) === 'pdf'

              return (
                <div key={variant} className="flex flex-col rounded-lg border border-border p-3">
                  <div className="flex h-28 items-center justify-center overflow-hidden rounded-md bg-surface-2">
                    {isPdf ? (
                      <span className="text-sm font-semibold text-text-muted">PDF</span>
                    ) : (
                      <img
                        src={url}
                        alt={`${config.label} artwork for ${event.name}`}
                        className="h-full w-full object-contain"
                      />
                    )}
                  </div>
                  <p className="mt-3 text-sm font-semibold text-text-strong">{config.label}</p>
                  <p className="mt-0.5 min-h-8 text-xs text-text-muted">{config.helpText}</p>
                  <LinkButton
                    href={buildEventImageDownloadUrl(url, fileName)}
                    variant="secondary"
                    size="sm"
                    className="mt-3 w-full"
                    icon={<Icon name="download" size={14} />}
                  >
                    Download
                  </LinkButton>
                </div>
              )
            })}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
