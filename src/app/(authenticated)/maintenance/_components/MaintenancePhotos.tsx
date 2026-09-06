'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Empty,
  Modal,
  Spinner,
  Textarea,
  toast,
} from '@/ds'
import { formatDateDdMmmmYyyy } from '@/lib/dateUtils'
import {
  listMaintenancePhotos,
  redactMaintenancePhoto,
  type MaintenancePhotoView,
} from '@/app/actions/maintenance-photos'
import { MAINTENANCE_PHOTO_ACCEPT } from '@/lib/maintenance/photo-normalise'
import {
  uploadMaintenancePhoto,
  type MaintenancePhotoUploadStage,
} from './photoClient'

/**
 * Photos for one maintenance item.
 *
 * Two separate controls on purpose. `capture` is a hint browsers may ignore, and
 * a single camera-only control makes attaching an older photo impossible.
 *
 * Display uses a plain <img> on a one hour signed URL. next/image is wrong here:
 * images.remotePatterns allows only the public storage path, and the production
 * optimiser rejects a /sign/ path with 400. The signed URL is held in memory for
 * the life of the page and is never persisted.
 */

export interface MaintenancePhotosProps {
  itemId: string
  /** Used for alternative text, so a screen reader hears which item this is. */
  itemTitle?: string
  /** Set false to render the gallery read only. The server checks regardless. */
  canUpload?: boolean
}

interface UploadTask {
  id: string
  fileName: string
  stage: MaintenancePhotoUploadStage
  error?: string
}

/** Re-signs before the one hour URLs expire. */
const SIGNED_URL_REFRESH_MS = 50 * 60 * 1000

/**
 * A server action can reject as well as return an error, and on pub wifi it
 * regularly does. Every await below is wrapped so a dropped connection shows one
 * of these rather than leaving a spinner running forever.
 */
const LOAD_FAILED = 'The photos could not be loaded. Check your connection and try again.'
const UPLOAD_FAILED = 'Could not upload that photo. Check your connection and try again.'
const REMOVE_FAILED = 'Could not remove that photo. Check your connection and try again.'
const REASON_REQUIRED = 'Please say briefly why this photo is being removed.'

/** Matches the server-side minimum, so the modal never sends a reason it will refuse. */
const MIN_REASON_LENGTH = 3

const STAGE_LABELS: Record<MaintenancePhotoUploadStage, string> = {
  preparing: 'Preparing',
  uploading: 'Uploading',
  saving: 'Saving',
  done: 'Added',
  failed: 'Failed',
}

export function MaintenancePhotos({
  itemId,
  itemTitle,
  canUpload = true,
}: MaintenancePhotosProps): React.JSX.Element {
  const [photos, setPhotos] = useState<MaintenancePhotoView[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tasks, setTasks] = useState<UploadTask[]>([])
  const [announcement, setAnnouncement] = useState('')
  const [redactTarget, setRedactTarget] = useState<MaintenancePhotoView | null>(null)
  const [redactReason, setRedactReason] = useState('')
  const [redactError, setRedactError] = useState<string | null>(null)
  const [redacting, setRedacting] = useState(false)

  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    let result: Awaited<ReturnType<typeof listMaintenancePhotos>>

    try {
      result = await listMaintenancePhotos(itemId)
    } catch (error) {
      // The call never came back. Shown as an error with a retry, never as a
      // gallery that loads for ever.
      console.error('[maintenance-photos] listing photos failed:', error)
      if (!mountedRef.current) return
      setLoadError(LOAD_FAILED)
      setLoading(false)
      return
    }

    if (!mountedRef.current) return

    if ('error' in result) {
      // A failed read is shown as an explicit error, never as an empty gallery.
      setLoadError(result.error)
      setLoading(false)
      return
    }

    setPhotos(result.photos)
    setLoadError(null)
    setLoading(false)
  }, [itemId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const timer = setInterval(() => {
      void refresh()
    }, SIGNED_URL_REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const updateTask = useCallback((taskId: string, patch: Partial<UploadTask>) => {
    setTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, ...patch } : task))
    )
  }, [])

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return

      // Each photo succeeds or fails on its own, so one bad file never discards
      // the others.
      for (const file of files) {
        const taskId = `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 8)}`
        setTasks((current) => [
          ...current,
          { id: taskId, fileName: file.name, stage: 'preparing' },
        ])
        setAnnouncement(`Preparing ${file.name}.`)

        let result: Awaited<ReturnType<typeof uploadMaintenancePhoto>>

        try {
          result = await uploadMaintenancePhoto({
            itemId,
            file,
            onStage: (stage) => {
              if (!mountedRef.current) return
              updateTask(taskId, { stage })
              setAnnouncement(`${STAGE_LABELS[stage]} ${file.name}.`)
            },
          })
        } catch (error) {
          // The upload never came back. The task is settled as failed with a
          // retry rather than left sitting on "Preparing" for ever.
          console.error('[maintenance-photos] the upload threw:', error)
          if (!mountedRef.current) return
          updateTask(taskId, { stage: 'failed', error: UPLOAD_FAILED })
          setAnnouncement(`${file.name} failed. ${UPLOAD_FAILED}`)
          toast.error(UPLOAD_FAILED)
          continue
        }

        if (!mountedRef.current) return

        if ('error' in result) {
          updateTask(taskId, { stage: 'failed', error: result.error })
          setAnnouncement(`${file.name} failed. ${result.error}`)
          toast.error(result.error)
          continue
        }

        setPhotos((current) => [result.photo, ...current])
        setTasks((current) => current.filter((task) => task.id !== taskId))
        setAnnouncement(`${file.name} added.`)
        toast.success('Photo added.')
      }
    },
    [itemId, updateTask]
  )

  const onInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget
      // Copied before the input is cleared, because clearing empties input.files.
      const files = Array.from(input.files ?? [])
      // Cleared first, so choosing the same file twice still fires a change
      // event. Doing it after the await left a failed photo unpickable.
      input.value = ''
      await handleFiles(files)
    },
    [handleFiles]
  )

  const dismissTask = useCallback((taskId: string) => {
    setTasks((current) => current.filter((task) => task.id !== taskId))
  }, [])

  const openRedact = useCallback((photo: MaintenancePhotoView) => {
    setRedactTarget(photo)
    setRedactReason('')
    setRedactError(null)
  }, [])

  const closeRedact = useCallback(() => {
    // Never closed from under a request that is still running.
    if (redacting) return
    setRedactTarget(null)
    setRedactReason('')
    setRedactError(null)
  }, [redacting])

  const confirmRedact = useCallback(async () => {
    const target = redactTarget
    if (!target) return

    const reason = redactReason.trim()
    if (reason.length < MIN_REASON_LENGTH) {
      setRedactError(REASON_REQUIRED)
      return
    }

    setRedacting(true)
    setRedactError(null)

    try {
      const result = await redactMaintenancePhoto(target.id, reason)
      if (!mountedRef.current) return

      if ('error' in result) {
        setRedactError(result.error)
        return
      }

      setPhotos((current) => current.filter((photo) => photo.id !== target.id))
      setAnnouncement('Photo removed. The record of it stays on this item.')
      toast.success('Photo removed.')
      setRedactTarget(null)
      setRedactReason('')
    } catch (error) {
      // The call never came back, so nothing is assumed about what happened to
      // the file. The dialog stays open with a message and the button live.
      console.error('[maintenance-photos] removing a photo failed:', error)
      if (!mountedRef.current) return
      setRedactError(REMOVE_FAILED)
    } finally {
      if (mountedRef.current) setRedacting(false)
    }
  }, [redactReason, redactTarget])

  const describe = (photo: MaintenancePhotoView, index: number): string => {
    if (photo.caption && photo.caption.trim().length > 0) return photo.caption
    const subject = itemTitle ? ` of ${itemTitle}` : ''
    return `Maintenance photo ${index + 1} of ${photos.length}${subject}`
  }

  return (
    <Card>
      <CardHeader
        title="Photos"
        subtitle="Photos are resized on your device before they are uploaded."
      />
      <CardBody>
        {canUpload ? (
          <div className="flex flex-wrap gap-2">
            {/*
              Two controls, not one. capture is only a hint, and a camera-only
              control would make attaching an older photo impossible.
            */}
            <Button
              type="button"
              variant="primary"
              onClick={() => cameraInputRef.current?.click()}
            >
              Take photo
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => libraryInputRef.current?.click()}
            >
              Choose existing photo
            </Button>

            {/*
              HEIC is deliberately absent from accept. It also stops Safari 17+
              turning a JPEG into HEIC on the way out of the picker.
            */}
            <input
              ref={cameraInputRef}
              type="file"
              accept={MAINTENANCE_PHOTO_ACCEPT}
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={onInputChange}
            />
            <input
              ref={libraryInputRef}
              type="file"
              accept={MAINTENANCE_PHOTO_ACCEPT}
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={onInputChange}
            />
          </div>
        ) : null}

        {/* Upload progress is announced politely rather than stealing focus. */}
        <p aria-live="polite" role="status" className="sr-only">
          {announcement}
        </p>

        {tasks.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {tasks.map((task) => (
              <li key={task.id}>
                {task.stage === 'failed' ? (
                  <Alert tone="danger" title={`${task.fileName} could not be added`}>
                    <div className="space-y-2">
                      <p>{task.error}</p>
                      <Button type="button" size="sm" variant="secondary" onClick={() => dismissTask(task.id)}>
                        Dismiss
                      </Button>
                    </div>
                  </Alert>
                ) : (
                  <span className="flex items-center gap-2 text-sm text-text-muted">
                    <Spinner size="sm" />
                    {STAGE_LABELS[task.stage]} {task.fileName}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {loadError ? (
          <div className="mt-4">
            <Alert tone="danger" title="The photos could not be loaded">
              <div className="space-y-2">
                <p>{loadError}</p>
                <Button type="button" size="sm" variant="secondary" onClick={() => void refresh()}>
                  Try again
                </Button>
              </div>
            </Alert>
          </div>
        ) : null}

        {loading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-text-muted">
            <Spinner size="sm" />
            Loading photos
          </p>
        ) : null}

        {!loading && !loadError && photos.length === 0 ? (
          <div className="mt-4">
            <Empty
              title="No photos yet"
              description="Add a photo so the problem is easy to recognise later."
            />
          </div>
        ) : null}

        {photos.length > 0 ? (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((photo, index) => (
              <li key={photo.id} className="space-y-1">
                <a
                  href={photo.signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block overflow-hidden rounded-md border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  {/*
                    A plain img, not next/image. The optimiser rejects a signed
                    /sign/ path with 400 and remotePatterns does not cover it.
                  */}
                  <img
                    src={photo.signedUrl}
                    alt={describe(photo, index)}
                    loading="lazy"
                    decoding="async"
                    width={photo.width ?? undefined}
                    height={photo.height ?? undefined}
                    className="h-32 w-full object-cover"
                    onError={() => {
                      // Most likely an expired signature. Re-sign once.
                      void refresh()
                    }}
                  />
                </a>
                <p className="text-xs text-text-muted">
                  {formatDateDdMmmmYyyy(photo.takenOn ?? photo.uploadedAt)}
                </p>
                {canUpload ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    // Several buttons read "Remove", so each is named for the
                    // photo it belongs to.
                    aria-label={`Remove ${describe(photo, index)}`}
                    onClick={() => openRedact(photo)}
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {/*
          Exceptional removal, per spec section 5. The file goes for good, the
          record of it stays on the item, so the wording says both.
        */}
        <Modal
          open={redactTarget !== null}
          onClose={closeRedact}
          title="Remove this photo"
          footer={
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeRedact} disabled={redacting}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => void confirmRedact()}
                loading={redacting}
                disabled={redacting}
              >
                Remove photo
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-text">
              The photo file is deleted permanently and cannot be recovered. The record that
              it was here, who removed it and why stays on this item.
            </p>
            <Textarea
              label="Why is it being removed?"
              value={redactReason}
              onChange={(event) => setRedactReason(event.target.value)}
              rows={3}
              maxLength={500}
              disabled={redacting}
              error={redactError ?? undefined}
            />
          </div>
        </Modal>
      </CardBody>
    </Card>
  )
}

export default MaintenancePhotos
