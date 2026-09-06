/**
 * Applies and removes the branding on one event image variant.
 *
 * This is the piece that turns the pure compositor into a live change: it reads
 * the ORIGINAL image out of storage, has `compositeArtwork` paint the logo and
 * (on print variants) the booking QR onto it, and makes the result the file the
 * website and the print pack actually serve. `revertEventImageBranding` puts the
 * original back.
 *
 * Everything here is deliberate. The notes below are the ones that have to
 * survive future editing.
 *
 * 1. THE COMPOSITE SOURCE IS ALWAYS THE ORIGINAL, NEVER THE PREVIOUS COMPOSITE.
 *    Compositing a composite stamps a second logo onto an image that already
 *    carries one, and a second QR beside the first. Nothing downstream can undo
 *    it, because the unbranded pixels are gone. Every path below that resolves a
 *    source proves it is the original before it reads a byte, and the one case
 *    where the recorded original cannot be read is a hard refusal rather than a
 *    fallback to whatever is live.
 *
 * 2. Bytes never travel in a request or a response. The caller sends a small
 *    JSON placement and this module fetches the image from storage itself.
 *    Vercel's platform body limit is 4.49MB and it is enforced at the proxy
 *    before the function runs, so a server-side catch would never see an
 *    oversized body. That is the same reason uploads already go browser-direct
 *    through a signed URL.
 *
 * 3. Placement geometry is never computed here. `compositeArtwork` takes the
 *    placement fractions and resolves them through
 *    `src/lib/events/artwork/geometry.ts`, which the browser preview imports as
 *    well. That shared module is the only reason what a member of staff drags on
 *    screen is what the printed file gets.
 *
 * 4. Geometry runs against the original's REAL decoded pixel size, not the
 *    variant's nominal target. The upload path has only ever checked aspect
 *    ratio, so a real A4 poster in production is about 1055x1491, not the
 *    nominal 2480x3508. Fractions of the edge scale to whatever was actually
 *    uploaded; a nominal size would put the logo somewhere else entirely.
 *
 * 5. Branding failure is visible. A missing logo asset returns a failure and
 *    leaves the live image exactly as it was. Quietly publishing unbranded
 *    artwork would be discovered on a printed poster.
 *
 * 6. `sharp` is imported dynamically, never statically, as it is at every other
 *    call site in this repo. It is a native module and a static import risks the
 *    serverless bundle.
 *
 * Storage layout, which is load bearing rather than cosmetic:
 *
 *   events/{eventId}/{variant}/{ts}_{name}            a staff upload
 *   events/{eventId}/{variant}/original-{ts}.{ext}    the kept original
 *   events/{eventId}/{variant}/branded/{ts}-{v}.png   a composite
 *
 * A composite lives in its own `branded/` folder and nothing else ever does,
 * because `buildEventImageStoragePath` puts uploads directly under the variant
 * folder. That one path segment is what lets this module tell an original from a
 * composite without trusting a database column that a failed write may have
 * left behind, and it is what makes the stale-original repair in
 * `resolveOriginal` possible.
 */

import { logAuditEvent } from '@/app/actions/audit'
import {
  EVENT_IMAGE_BUCKET,
  EVENT_IMAGE_VARIANTS,
  isOwnedByEvent,
  storagePathFromPublicUrl,
  type EventImageVariant,
} from '@/lib/events/imageVariants'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  compositeArtwork,
  type CompositeSpec,
  type LogoColour,
} from './composite'
import type { LogoPlacement } from './geometry'
import { validateCompositeOutput } from './output'
import { resolvePosterLink, type PosterLinkBlockReason } from './poster-link'

/**
 * Which variants carry a QR code.
 *
 * One helper, one place, so adding a future print variant is a one-line change
 * here rather than a hunt through the route, the editor and the tests. The logo
 * deliberately has no equivalent: it applies to all five variants, because the
 * complaint that started this work was adding it by hand to every image before
 * upload.
 */
export function isPrintVariant(variant: EventImageVariant): boolean {
  return variant === 'print_poster'
}

/** Marks a stored object as a composite this module produced. */
const COMPOSITE_FOLDER = 'branded'

export interface BrandingLogoInput {
  placement: LogoPlacement
  colour: LogoColour
}

export interface BrandingQrInput {
  centreXFrac: number
  centreYFrac: number
  widthFrac: number
}

export interface ApplyBrandingInput {
  eventId: string
  variant: EventImageVariant
  /** Null means the staff member deliberately chose no logo. */
  logo: BrandingLogoInput | null
  /** Null means no QR code. Only print variants may ask for one. */
  qr: BrandingQrInput | null
  /** Who is doing this, for the audit row and the variant metadata. */
  userId: string | null
  /**
   * Overrides the on-disk logo paths, passed straight to `compositeArtwork`.
   *
   * The only way to exercise a missing logo asset against the real filesystem,
   * which is the one branding failure that must never publish silently. The
   * route never passes this and it is not part of the request schema, so it
   * cannot be set from outside the process.
   */
  logoSources?: Record<LogoColour, string>
}

export interface RevertBrandingInput {
  eventId: string
  variant: EventImageVariant
  userId: string | null
}

/**
 * Every way this can fail, as a stable string the interface can branch on.
 *
 * The five in the middle are `CompositeFailure` codes, passed through unchanged
 * rather than flattened into one "compositing failed", because the difference
 * between a missing logo file and a QR that overlaps the logo is the difference
 * between an operations problem and a placement the person can simply move.
 */
export type BrandingErrorCode =
  | 'event_not_found'
  | 'image_missing'
  | 'image_not_owned'
  | 'source_unsupported'
  | 'qr_not_supported'
  | 'poster_link_blocked'
  | 'original_unavailable'
  | 'logo_asset_missing'
  | 'logo_asset_invalid'
  | 'qr_render_failed'
  | 'placement_invalid'
  | 'source_invalid'
  | 'output_invalid'
  | 'storage_failed'
  | 'save_failed'
  | 'nothing_to_revert'

export interface BrandingFailure {
  ok: false
  code: BrandingErrorCode
  /** The HTTP status the route should send. */
  status: number
  /** Plain English, safe to show a member of staff. */
  error: string
  /** Present only for `poster_link_blocked`: why the poster is blocked. */
  reason?: PosterLinkBlockReason
}

export interface BrandingQrOutcome {
  shortLinkId: string
  shortCode: string
  shortUrl: string
  destinationUrl: string
  /** True when a stale destination was corrected on the way through. */
  wasRepaired: boolean
}

export interface BrandingSuccess {
  ok: true
  variant: EventImageVariant
  /** False after a revert, when the live file is the original again. */
  branded: boolean
  /** The live file after this call. */
  imageUrl: string
  storagePath: string
  originalStoragePath: string | null
  width: number
  height: number
  bytes: number
  qr: BrandingQrOutcome | null
  /**
   * False when the image is correct but its branding columns could not be
   * written, so the editor should tell the person the placement was not saved.
   * See `writeBrandingColumns` for why that state is recoverable.
   */
  placementSaved: boolean
}

export type BrandingResult = BrandingSuccess | BrandingFailure

/**
 * The `event_images` row, hand written.
 *
 * Migration `20260906140000_event_image_branding.sql` adds the ten branding
 * columns and has not been applied to any database, so
 * `src/types/database.generated.ts` does not carry them and a generated-typed
 * `select` of `original_storage_path` will not compile. `snake_case` to
 * `camelCase` is mapped by hand below, as everywhere else in this repo.
 */
interface EventImageRow {
  id: string
  storage_path: string | null
  file_name: string | null
  mime_type: string | null
  file_size_bytes: number | null
  original_storage_path: string | null
  logo_corner: string | null
  logo_centre_x_frac: number | null
  logo_centre_y_frac: number | null
  logo_colour: string | null
  logo_width_frac: number | null
  qr_centre_x_frac: number | null
  qr_centre_y_frac: number | null
  qr_width_frac: number | null
  qr_short_link_id: string | null
}

interface EventImageState {
  rowId: string | null
  livePath: string | null
  originalPath: string | null
  mimeType: string | null
}

/** The ten branding columns, written together or cleared together. */
interface BrandingColumns {
  original_storage_path: string | null
  logo_corner: string | null
  logo_centre_x_frac: number | null
  logo_centre_y_frac: number | null
  logo_colour: string | null
  logo_width_frac: number | null
  qr_centre_x_frac: number | null
  qr_centre_y_frac: number | null
  qr_width_frac: number | null
  qr_short_link_id: string | null
}

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * The shape of an UPDATE on the branding columns.
 *
 * Cast to rather than reached for with `any`: the generated `Update` type
 * rejects the ten columns until the migration is applied, and narrowing to
 * exactly the call made keeps the cast honest.
 */
interface BrandingColumnUpdate {
  update(values: BrandingColumns): {
    eq(
      column: string,
      value: string
    ): {
      eq(column: string, value: string): Promise<{ error: { message: string } | null }>
    }
  }
}

const EXTENSION_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fail(
  code: BrandingErrorCode,
  status: number,
  error: string,
  reason?: PosterLinkBlockReason
): BrandingFailure {
  return reason ? { ok: false, code, status, error, reason } : { ok: false, code, status, error }
}

function fileExtension(storagePath: string): string | null {
  const name = storagePath.split('/').pop() ?? ''
  const match = name.match(/\.([a-z0-9]+)$/i)
  return match ? match[1].toLowerCase() : null
}

function mimeTypeFor(storagePath: string, recorded: string | null): string {
  if (recorded && recorded.length > 0) return recorded
  const extension = fileExtension(storagePath)
  return (extension && EXTENSION_MIME_TYPES[extension]) || 'application/octet-stream'
}

/** True when this object is a composite this module wrote. */
function isCompositePath(storagePath: string): boolean {
  return storagePath.includes(`/${COMPOSITE_FOLDER}/`)
}

/**
 * Where the kept original lives.
 *
 * The extension follows the file being copied rather than being fixed at
 * `.png`, because a revert makes this object the live one again and a JPEG
 * served under a `.png` name would download with the wrong name from the
 * marketing tab.
 */
function buildOriginalPath(
  eventId: string,
  variant: EventImageVariant,
  sourcePath: string,
  now: number
): string {
  const extension = fileExtension(sourcePath) ?? 'png'
  return `events/${eventId}/${variant}/original-${now}.${extension}`
}

/**
 * Where a composite lives.
 *
 * Built here rather than through `buildEventImageStoragePath` for two reasons:
 * every part of it is server-constructed from an id, a variant and a clock, so
 * there is no staff file name to sanitise, and it has to sit in the `branded/`
 * folder that tells this module a composite from an original.
 */
function buildCompositePath(
  eventId: string,
  variant: EventImageVariant,
  now: number
): string {
  return `events/${eventId}/${variant}/${COMPOSITE_FOLDER}/${now}-${variant}.png`
}

async function downloadObject(
  supabase: AdminClient,
  storagePath: string
): Promise<{ ok: true; buffer: Buffer } | { ok: false; detail: string }> {
  const { data, error } = await supabase.storage.from(EVENT_IMAGE_BUCKET).download(storagePath)

  if (error || !data) {
    return { ok: false, detail: error?.message ?? 'The file was not found in storage.' }
  }

  try {
    return { ok: true, buffer: Buffer.from(await data.arrayBuffer()) }
  } catch (readError) {
    return { ok: false, detail: describe(readError) }
  }
}

/** Remove an object, never failing the caller over it. */
async function removeObject(
  supabase: AdminClient,
  storagePath: string,
  context: string
): Promise<void> {
  const { error } = await supabase.storage.from(EVENT_IMAGE_BUCKET).remove([storagePath])
  if (error) {
    console.error(`[artwork:branding] failed to remove ${context}`, storagePath, error)
  }
}

/**
 * Load what the app currently believes about this variant.
 *
 * `events` is authoritative for which file is live: 51 events have artwork but
 * only 36 have an `event_images` row, so reading the metadata table alone would
 * report no image for artwork the website is happily serving. The metadata row
 * supplies the branding columns and the mime type when it exists.
 */
async function loadState(
  supabase: AdminClient,
  eventId: string,
  variant: EventImageVariant
): Promise<{ ok: true; state: EventImageState } | { ok: false; failure: BrandingFailure }> {
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select(
      'id, hero_image_url, landscape_image_url, social_image_url, story_image_url, print_poster_url'
    )
    .eq('id', eventId)
    .maybeSingle()

  if (eventError) {
    console.error('[artwork:branding] failed to load the event', eventId, eventError)
    return {
      ok: false,
      failure: fail('event_not_found', 500, 'Could not load this event. Try again in a moment.'),
    }
  }

  if (!event) {
    return { ok: false, failure: fail('event_not_found', 404, 'Event not found.') }
  }

  const { data: imageRow, error: imageError } = await supabase
    .from('event_images')
    .select('*')
    .eq('event_id', eventId)
    .eq('image_type', variant)
    .maybeSingle()

  if (imageError) {
    console.error('[artwork:branding] failed to load the image row', eventId, variant, imageError)
    return {
      ok: false,
      failure: fail('image_missing', 500, 'Could not load this image. Try again in a moment.'),
    }
  }

  const row = (imageRow ?? null) as unknown as EventImageRow | null
  const cachedUrl = (event as unknown as Record<string, unknown>)[
    EVENT_IMAGE_VARIANTS[variant].cacheColumn
  ]

  return {
    ok: true,
    state: {
      rowId: row?.id ?? null,
      livePath: row?.storage_path ?? storagePathFromPublicUrl(
        typeof cachedUrl === 'string' ? cachedUrl : null
      ),
      originalPath: row?.original_storage_path ?? null,
      mimeType: row?.mime_type ?? null,
    },
  }
}

interface ResolvedOriginal {
  path: string
  buffer: Buffer
  /** Set when this call made the copy, so a later failure can take it back out. */
  created: boolean
  /** A recorded original this call superseded, to delete once the swap is done. */
  supersededPath: string | null
}

/**
 * Produce the ORIGINAL image for this variant, copying it out of the live object
 * the first time branding is applied.
 *
 * Three cases, and the third is the one that stops a subtle corruption:
 *
 * 1. A recorded original and a composite live: reuse the recorded original. This
 *    is every re-placement, and it is why moving the logo does not compound.
 *
 * 2. No recorded original: the live object IS the original. Copy it, so the
 *    composite can replace it without the unbranded pixels being lost.
 *
 * 3. A recorded original but the live object is NOT a composite: somebody
 *    uploaded a new file to this tile after it was branded.
 *    `confirmEventImageUpload` replaces `storage_path` and does not clear the
 *    branding columns, so the recorded original now describes an image nobody is
 *    looking at. Compositing from it would silently brand the OLD artwork and
 *    publish it over the new upload. So the new upload becomes the original and
 *    the stale one is deleted once the swap has succeeded.
 *
 * A recorded original that cannot be read is a refusal, never a fallback to the
 * live object. The live object is the previous composite in that state, and
 * falling back to it is precisely how branding compounds.
 */
async function resolveOriginal(
  supabase: AdminClient,
  eventId: string,
  variant: EventImageVariant,
  state: EventImageState,
  now: number
): Promise<{ ok: true; original: ResolvedOriginal } | { ok: false; failure: BrandingFailure }> {
  const livePath = state.livePath as string

  if (state.originalPath && isCompositePath(livePath)) {
    const download = await downloadObject(supabase, state.originalPath)
    if (!download.ok) {
      console.error(
        '[artwork:branding] the recorded original could not be read',
        state.originalPath,
        download.detail
      )
      return {
        ok: false,
        failure: fail(
          'original_unavailable',
          409,
          'The unbranded original for this image could not be read, so branding it again would stamp a second logo onto the branded copy. Upload the artwork again to start from a clean original.'
        ),
      }
    }

    return {
      ok: true,
      original: {
        path: state.originalPath,
        buffer: download.buffer,
        created: false,
        supersededPath: null,
      },
    }
  }

  if (isCompositePath(livePath)) {
    // No recorded original and the live object is one of our composites: the
    // pointer was lost. Copying this would bake a second logo in permanently.
    return {
      ok: false,
      failure: fail(
        'original_unavailable',
        409,
        'This image is already branded but its unbranded original is not recorded, so it cannot be branded again. Upload the artwork again to start from a clean original.'
      ),
    }
  }

  const download = await downloadObject(supabase, livePath)
  if (!download.ok) {
    return {
      ok: false,
      failure: fail(
        'original_unavailable',
        409,
        `The image file for this variant could not be read from storage: ${download.detail}`
      ),
    }
  }

  const originalPath = buildOriginalPath(eventId, variant, livePath, now)
  const { error: uploadError } = await supabase.storage
    .from(EVENT_IMAGE_BUCKET)
    .upload(originalPath, download.buffer, {
      contentType: mimeTypeFor(livePath, state.mimeType),
      upsert: false,
    })

  if (uploadError) {
    console.error('[artwork:branding] failed to keep the original', originalPath, uploadError)
    return {
      ok: false,
      failure: fail(
        'storage_failed',
        500,
        'Could not keep a copy of the unbranded original, so branding was not applied.'
      ),
    }
  }

  return {
    ok: true,
    original: {
      path: originalPath,
      buffer: download.buffer,
      created: true,
      // Only when a recorded original has been superseded by a fresh upload.
      supersededPath: state.originalPath && state.originalPath !== originalPath
        ? state.originalPath
        : null,
    },
  }
}

/**
 * Write the ten branding columns.
 *
 * Deliberately not atomic with the variant upsert that made the composite live,
 * as the migration documents. The two orderings fail differently and only one of
 * them is safe, so this runs AFTER the swap and the caller rolls the image back
 * if it fails: leaving the image branded with no `original_storage_path` is the
 * one state that would let a later edit compound the branding, and it is the
 * only state neither the app nor a person can recover from.
 *
 * Every value written here was validated against the same bounds as the CHECK
 * constraints before any work started, so a constraint violation would be a
 * programming error rather than bad input.
 */
async function writeBrandingColumns(
  supabase: AdminClient,
  eventId: string,
  variant: EventImageVariant,
  columns: BrandingColumns
): Promise<{ ok: boolean; detail?: string }> {
  const table = supabase.from('event_images') as unknown as BrandingColumnUpdate

  const { error } = await table
    .update(columns)
    .eq('event_id', eventId)
    .eq('image_type', variant)

  if (error) {
    console.error('[artwork:branding] failed to write the branding columns', eventId, variant, error)
    return { ok: false, detail: error.message }
  }

  return { ok: true }
}

/**
 * Make one stored object the live file for a variant, through the same RPC the
 * upload path uses, and clear up whatever it replaced.
 *
 * `upsert_event_image_variant` keeps the metadata row and the cached URL column
 * on `events` in one transaction, which is why nothing here writes either by
 * hand. It returns the object it replaced.
 */
async function publishVariant(
  supabase: AdminClient,
  params: {
    eventId: string
    variant: EventImageVariant
    storagePath: string
    fileName: string
    mimeType: string
    sizeBytes: number
    userId: string | null
    /** Never deleted even when it is what was replaced. */
    protectedPath: string | null
  }
): Promise<{ ok: true; publicUrl: string; replacedPath: string | null } | { ok: false; detail: string }> {
  const {
    data: { publicUrl },
  } = supabase.storage.from(EVENT_IMAGE_BUCKET).getPublicUrl(params.storagePath)

  const { data: replacedPath, error } = await supabase.rpc('upsert_event_image_variant', {
    p_event_id: params.eventId,
    p_variant: params.variant,
    p_storage_path: params.storagePath,
    p_public_url: publicUrl,
    p_file_name: params.fileName,
    p_mime_type: params.mimeType,
    p_file_size_bytes: params.sizeBytes,
    p_uploaded_by: params.userId as string,
  })

  if (error) {
    return { ok: false, detail: error.message }
  }

  const replaced = typeof replacedPath === 'string' ? replacedPath : null

  // Only ever delete a file this event owns, and never the kept original. An
  // inherited category image is shared with every other event in that category.
  if (
    replaced &&
    replaced !== params.storagePath &&
    replaced !== params.protectedPath &&
    isOwnedByEvent(replaced, params.eventId)
  ) {
    await removeObject(supabase, replaced, 'the replaced image')
  }

  return { ok: true, publicUrl, replacedPath: replaced }
}

function brandingColumnsFor(
  originalPath: string,
  logo: BrandingLogoInput | null,
  qr: BrandingQrInput | null,
  shortLinkId: string | null
): BrandingColumns {
  const corner = logo && logo.placement.mode === 'corner' ? logo.placement.corner : null
  const free = logo && logo.placement.mode === 'free' ? logo.placement : null

  return {
    original_storage_path: originalPath,
    logo_corner: corner,
    logo_centre_x_frac: free ? free.centreXFrac : null,
    logo_centre_y_frac: free ? free.centreYFrac : null,
    logo_colour: logo ? logo.colour : null,
    logo_width_frac: logo ? logo.placement.widthFrac : null,
    qr_centre_x_frac: qr ? qr.centreXFrac : null,
    qr_centre_y_frac: qr ? qr.centreYFrac : null,
    qr_width_frac: qr ? qr.widthFrac : null,
    qr_short_link_id: shortLinkId,
  }
}

const CLEARED_BRANDING_COLUMNS: BrandingColumns = {
  original_storage_path: null,
  logo_corner: null,
  logo_centre_x_frac: null,
  logo_centre_y_frac: null,
  logo_colour: null,
  logo_width_frac: null,
  qr_centre_x_frac: null,
  qr_centre_y_frac: null,
  qr_width_frac: null,
  qr_short_link_id: null,
}

async function decodeDimensions(
  buffer: Buffer
): Promise<{ ok: true; width: number; height: number } | { ok: false; detail: string }> {
  const sharp = (await import('sharp')).default

  try {
    const metadata = await sharp(buffer, { failOn: 'none' }).metadata()
    if (!metadata.width || !metadata.height) {
      return { ok: false, detail: 'The image has no readable width and height.' }
    }
    return { ok: true, width: metadata.width, height: metadata.height }
  } catch (error) {
    return { ok: false, detail: describe(error) }
  }
}

async function recordAudit(
  input: {
    userId: string | null
    eventId: string
    operation: 'update' | 'delete'
    newValues: Record<string, unknown>
    additionalInfo: Record<string, unknown>
  }
): Promise<void> {
  try {
    await logAuditEvent({
      user_id: input.userId ?? undefined,
      operation_type: input.operation,
      resource_type: 'event',
      resource_id: input.eventId,
      operation_status: 'success',
      new_values: input.newValues,
      additional_info: input.additionalInfo,
    })
  } catch (error) {
    // The image is already correct. Losing the audit row must not be reported to
    // staff as a failed change.
    console.error('[artwork:branding] failed to write the audit row', input.eventId, error)
  }
}

/**
 * Composite the logo, and on a print variant the booking QR, onto this variant's
 * original and make the result the live file.
 */
export async function applyEventImageBranding(
  input: ApplyBrandingInput
): Promise<BrandingResult> {
  const { eventId, variant, logo, qr, userId } = input
  const supabase = createAdminClient()
  const now = Date.now()

  const loaded = await loadState(supabase, eventId, variant)
  if (!loaded.ok) return loaded.failure
  const state = loaded.state

  if (!state.livePath) {
    return fail(
      'image_missing',
      409,
      `There is no ${EVENT_IMAGE_VARIANTS[variant].label} image on this event yet, so there is nothing to brand.`
    )
  }

  if (!isOwnedByEvent(state.livePath, eventId)) {
    // Artwork inherited from the category is shared with every other event in
    // it, so branding it here would change all of them.
    return fail(
      'image_not_owned',
      409,
      `This ${EVENT_IMAGE_VARIANTS[variant].label} image is inherited from the event category and shared with other events. Upload one for this event before branding it.`
    )
  }

  if (qr && !isPrintVariant(variant)) {
    return fail(
      'qr_not_supported',
      422,
      `A QR code only goes on print artwork, and ${EVENT_IMAGE_VARIANTS[variant].label} is a screen variant.`
    )
  }

  let qrOutcome: BrandingQrOutcome | null = null
  if (qr) {
    const link = await resolvePosterLink(eventId)
    if (!link.ok) {
      // The reason and its wording come straight from `poster-link.ts`, which
      // knows why a poster must not be printed. Rewording it here would leave two
      // explanations to keep in step.
      return fail('poster_link_blocked', 422, link.detail, link.reason)
    }

    qrOutcome = {
      shortLinkId: link.shortLinkId,
      shortCode: link.shortCode,
      shortUrl: link.shortUrl,
      destinationUrl: link.destinationUrl,
      wasRepaired: link.wasRepaired,
    }
  }

  const resolved = await resolveOriginal(supabase, eventId, variant, state, now)
  if (!resolved.ok) return resolved.failure
  const original = resolved.original

  /** Take back a copy this call made, so a failure leaves no stray file. */
  const discardNewOriginal = async (): Promise<void> => {
    if (original.created) {
      await removeObject(supabase, original.path, 'the unused original copy')
    }
  }

  const dimensions = await decodeDimensions(original.buffer)
  if (!dimensions.ok) {
    await discardNewOriginal()
    const isPdf = mimeTypeFor(original.path, state.mimeType) === 'application/pdf'
    return fail(
      'source_unsupported',
      422,
      isPdf
        ? 'This poster is a PDF, which cannot have a logo or a QR code composited onto it. Upload it as a PNG or JPG to brand it.'
        : `This image could not be read: ${dimensions.detail}`
    )
  }

  const spec: CompositeSpec = {
    variant,
    logo: logo ? { placement: logo.placement, colour: logo.colour } : null,
    qr: qr && qrOutcome ? { ...qr, url: qrOutcome.shortUrl } : null,
  }

  const composited = await compositeArtwork(
    original.buffer,
    spec,
    input.logoSources ? { logoSources: input.logoSources } : {}
  )

  if (!composited.ok) {
    // Nothing has been published, so the live image is exactly as it was. This
    // is the visible failure a missing logo asset must produce.
    await discardNewOriginal()
    return fail(composited.failure.code, 422, composited.failure.detail)
  }

  const validated = await validateCompositeOutput(composited.buffer, variant, {
    width: dimensions.width,
    height: dimensions.height,
  })

  if (!validated.ok) {
    await discardNewOriginal()
    return fail('output_invalid', 422, validated.reason)
  }

  const compositePath = buildCompositePath(eventId, variant, now)
  const { error: uploadError } = await supabase.storage
    .from(EVENT_IMAGE_BUCKET)
    .upload(compositePath, composited.buffer, { contentType: 'image/png', upsert: false })

  if (uploadError) {
    console.error('[artwork:branding] failed to upload the composite', compositePath, uploadError)
    await discardNewOriginal()
    return fail('storage_failed', 500, 'Could not save the branded image. Try again.')
  }

  const published = await publishVariant(supabase, {
    eventId,
    variant,
    storagePath: compositePath,
    fileName: `${variant}-branded.png`,
    mimeType: 'image/png',
    sizeBytes: composited.buffer.length,
    userId,
    protectedPath: original.path,
  })

  if (!published.ok) {
    console.error('[artwork:branding] failed to publish the composite', compositePath, published.detail)
    // Nothing references the composite, so take it back out. The live image is
    // untouched.
    await removeObject(supabase, compositePath, 'the unrecorded composite')
    await discardNewOriginal()
    return fail('save_failed', 500, 'Could not save the branded image. Try again.')
  }

  const columns = brandingColumnsFor(
    original.path,
    logo,
    qr,
    qrOutcome ? qrOutcome.shortLinkId : null
  )
  const written = await writeBrandingColumns(supabase, eventId, variant, columns)

  let placementSaved = true
  if (!written.ok) {
    // The branded image is live but nothing records which file it came from. A
    // later edit would treat the composite as the original and stamp a second
    // logo onto it, which is unrecoverable, so put the original back rather than
    // leave that trap set.
    placementSaved = false
    const rolledBack = await publishVariant(supabase, {
      eventId,
      variant,
      storagePath: original.path,
      fileName: original.path.split('/').pop() ?? `${variant}-original`,
      mimeType: mimeTypeFor(original.path, state.mimeType),
      sizeBytes: original.buffer.length,
      userId,
      protectedPath: null,
    })

    if (rolledBack.ok) {
      return fail(
        'save_failed',
        500,
        'The branded image could not be recorded, so the original has been put back. Try again.'
      )
    }

    console.error(
      '[artwork:branding] branding metadata failed AND the rollback failed',
      eventId,
      variant,
      { compositePath, originalPath: original.path, detail: rolledBack.detail }
    )
  }

  // Only once the swap has succeeded, and only when a fresh upload superseded it.
  if (original.supersededPath && isOwnedByEvent(original.supersededPath, eventId)) {
    await removeObject(supabase, original.supersededPath, 'the superseded original')
  }

  await recordAudit({
    userId,
    eventId,
    operation: 'update',
    newValues: {
      variant,
      logo: logo ? { placement: logo.placement, colour: logo.colour } : null,
      qr: qr ?? null,
    },
    additionalInfo: {
      action: 'artwork_branding_applied',
      storagePath: compositePath,
      originalStoragePath: original.path,
      supersededOriginalPath: original.supersededPath,
      replacedStoragePath: published.replacedPath,
      shortLinkId: qrOutcome?.shortLinkId ?? null,
      shortLinkRepaired: qrOutcome?.wasRepaired ?? false,
      placementSaved,
    },
  })

  return {
    ok: true,
    variant,
    branded: true,
    imageUrl: published.publicUrl,
    storagePath: compositePath,
    originalStoragePath: original.path,
    width: validated.width,
    height: validated.height,
    bytes: validated.bytes,
    qr: qrOutcome,
    placementSaved,
  }
}

/**
 * Put the unbranded original back as the live file and clear the branding.
 *
 * The original object is not copied back, it simply becomes the live one again,
 * so the restored file is byte-identical by construction rather than by a
 * re-encode that would have to be trusted.
 */
export async function revertEventImageBranding(
  input: RevertBrandingInput
): Promise<BrandingResult> {
  const { eventId, variant, userId } = input
  const supabase = createAdminClient()

  const loaded = await loadState(supabase, eventId, variant)
  if (!loaded.ok) return loaded.failure
  const state = loaded.state

  if (!state.originalPath) {
    return fail(
      'nothing_to_revert',
      409,
      `The ${EVENT_IMAGE_VARIANTS[variant].label} image has no branding to remove.`
    )
  }

  // Read the original before anything is swapped: it proves the file is really
  // there, and gives the exact size and format to record against the row rather
  // than the composite's `image/png` being left behind on a JPEG.
  const download = await downloadObject(supabase, state.originalPath)
  if (!download.ok) {
    return fail(
      'original_unavailable',
      409,
      `The unbranded original could not be read from storage, so it cannot be restored: ${download.detail}`
    )
  }

  const dimensions = await decodeDimensions(download.buffer)
  const detected = await detectMimeType(download.buffer)

  const published = await publishVariant(supabase, {
    eventId,
    variant,
    storagePath: state.originalPath,
    fileName: state.originalPath.split('/').pop() ?? `${variant}-original`,
    mimeType: detected ?? mimeTypeFor(state.originalPath, null),
    sizeBytes: download.buffer.length,
    userId,
    protectedPath: null,
  })

  if (!published.ok) {
    console.error('[artwork:branding] failed to restore the original', state.originalPath, published.detail)
    return fail('save_failed', 500, 'Could not restore the original image. Try again.')
  }

  // After the swap, never before. If this fails the row still points at the file
  // that is now live, so a later branding composites the original and nothing
  // compounds; the editor simply shows a placement that is no longer painted.
  const cleared = await writeBrandingColumns(supabase, eventId, variant, CLEARED_BRANDING_COLUMNS)

  await recordAudit({
    userId,
    eventId,
    operation: 'update',
    newValues: { variant, logo: null, qr: null },
    additionalInfo: {
      action: 'artwork_branding_reverted',
      storagePath: state.originalPath,
      removedCompositePath: published.replacedPath,
      placementSaved: cleared.ok,
    },
  })

  return {
    ok: true,
    variant,
    branded: false,
    imageUrl: published.publicUrl,
    storagePath: state.originalPath,
    originalStoragePath: null,
    width: dimensions.ok ? dimensions.width : 0,
    height: dimensions.ok ? dimensions.height : 0,
    bytes: download.buffer.length,
    qr: null,
    placementSaved: cleared.ok,
  }
}

/** The real format of a buffer, so a restored JPEG is not recorded as a PNG. */
async function detectMimeType(buffer: Buffer): Promise<string | null> {
  const sharp = (await import('sharp')).default

  try {
    const { format } = await sharp(buffer, { failOn: 'none' }).metadata()
    if (!format) return null
    return EXTENSION_MIME_TYPES[format] ?? null
  } catch {
    return null
  }
}
