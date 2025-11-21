'use client'

import { useMemo } from 'react'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { ClipboardDocumentIcon, ArrowDownTrayIcon, ArrowPathIcon, LinkIcon } from '@heroicons/react/24/outline'
import type { EventMarketingLink } from '@/app/actions/event-marketing-links'

interface EventMarketingLinksCardProps {
  links: EventMarketingLink[]
  loading?: boolean
  error?: string | null
  onRegenerate?: () => Promise<void>
}

export function EventMarketingLinksCard({ links, loading = false, error, onRegenerate }: EventMarketingLinksCardProps) {
  const digitalLinks = useMemo(() => links.filter((link) => link.type === 'digital'), [links])
  const printLinks = useMemo(() => links.filter((link) => link.type === 'print'), [links])

  const handleCopy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied to clipboard`)
    } catch (err) {
      console.error('Copy failed', err)
      toast.error('Failed to copy to clipboard')
    }
  }

  const handleDownloadQr = (link: EventMarketingLink) => {
    if (!link.qrCode) return
    const anchor = document.createElement('a')
    anchor.href = link.qrCode
    anchor.download = `${link.channel}-${link.shortCode}.png`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  }

  return (
    <Card padding="lg" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Marketing Links &amp; QR Codes</h2>
          <p className="mt-1 text-sm text-gray-500">
            Channel-ready links with tracking for campaigns and print assets.
          </p>
        </div>
        {onRegenerate && (
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              if (loading) return
              await onRegenerate()
            }}
            disabled={loading}
            leftIcon={<ArrowPathIcon className="h-4 w-4" />}
          >
            Refresh links
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="text-gray-400" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : links.length === 0 ? (
        <EmptyState
          size="sm"
          variant="minimal"
          centered={false}
          icon={<LinkIcon className="h-10 w-10 text-blue-400" />}
          title="No marketing links"
          description="Marketing links will appear here once generated."
        />
      ) : (
        <div className="space-y-8">
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Digital channels</h3>
            <div className="mt-3 space-y-3">
              {digitalLinks.length === 0 ? (
                <p className="text-sm text-gray-500">No digital links generated yet.</p>
              ) : (
                digitalLinks.map((link) => (
                  <div key={link.id} className="rounded-lg border border-gray-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{link.label}</p>
                        {link.description && (
                          <p className="text-xs text-gray-500">{link.description}</p>
                        )}
                      </div>
                      <Badge variant="info" size="sm">Digital</Badge>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-blue-600">{link.shortUrl}</span>
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => handleCopy(link.shortUrl, `${link.label} link`)}
                        leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                      >
                        Copy link
                      </Button>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-gray-600 break-all">{link.destinationUrl}</span>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => handleCopy(link.destinationUrl, `${link.label} destination`)}
                        leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                      >
                        Copy URL
                      </Button>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <Badge variant="secondary" size="sm">source: {link.utm.utm_source}</Badge>
                      <Badge variant="secondary" size="sm">medium: {link.utm.utm_medium}</Badge>
                      <Badge variant="secondary" size="sm">campaign: {link.utm.utm_campaign}</Badge>
                      {link.utm.utm_content && (
                        <Badge variant="secondary" size="sm">content: {link.utm.utm_content}</Badge>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Print assets</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {printLinks.length === 0 ? (
                <p className="text-sm text-gray-500 sm:col-span-2">No print QR codes generated yet.</p>
              ) : (
                printLinks.map((link) => (
                  <div key={link.id} className="flex flex-col justify-between rounded-lg border border-gray-200 p-4">
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{link.label}</p>
                          {link.description && (
                            <p className="text-xs text-gray-500">{link.description}</p>
                          )}
                        </div>
                        <Badge variant="secondary" size="sm">Print</Badge>
                      </div>

                      <div className="mt-3 flex items-center gap-3">
                        {link.qrCode ? (
                          <img
                            src={link.qrCode}
                            alt={`${link.label} QR`}
                            className="h-28 w-28 rounded-md border border-gray-200 bg-white object-contain p-2"
                          />
                        ) : (
                          <div className="flex h-28 w-28 items-center justify-center rounded-md border border-dashed border-gray-300 text-xs text-gray-400">
                            QR unavailable
                          </div>
                        )}
                        <div className="flex-1">
                          <p className="font-mono text-sm text-blue-600 break-all">{link.shortUrl}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Button
                              size="xs"
                              variant="secondary"
                              onClick={() => handleCopy(link.shortUrl, `${link.label} link`)}
                              leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                            >
                              Copy link
                            </Button>
                            <Button
                              size="xs"
                              variant="secondary"
                              onClick={() => handleDownloadQr(link)}
                              leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
                              disabled={!link.qrCode}
                            >
                              Download QR
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <Badge variant="secondary" size="sm">source: {link.utm.utm_source}</Badge>
                      <Badge variant="secondary" size="sm">medium: {link.utm.utm_medium}</Badge>
                      <Badge variant="secondary" size="sm">campaign: {link.utm.utm_campaign}</Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </Card>
  )
}
