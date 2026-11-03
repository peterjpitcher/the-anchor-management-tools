/**
 * Size limits for staff training uploads, in one place so the browser forms and the server
 * actions never disagree. Plain numbers only: client components import this file, so nothing here
 * may touch the database or Node APIs (src/lib/training/storage.ts re-exports them for the server).
 *
 * Why 4 MB: every training upload goes through a server action, which posts the whole file in the
 * request body, and Vercel refuses a body over about 4.49 MB at its proxy before the action runs
 * (measured against production, see src/lib/maintenance/photo-normalise.ts). A bigger file fails
 * with a bare 413 the page cannot explain, so a higher limit could never be reached. Receipts cap
 * their statement upload at 4 MB for the same reason (src/lib/receipts/upload-constraints.ts). The
 * same platform cap applies to a response, so the routes that stream these files back (course
 * images, certificate downloads) stay under it too.
 *
 * The build contract (5.2) said 10 MB for a certificate; that cannot work on this platform, so it
 * is 4 MB until certificates are uploaded straight to storage instead of through the action.
 */

/** One external certificate file (pdf, jpg or png). */
export const EXTERNAL_CERTIFICATE_MAX_BYTES = 4 * 1024 * 1024

/** One course image, as uploaded and as served by the images route. */
export const COURSE_IMAGE_MAX_BYTES = 4 * 1024 * 1024

/** Every file in one course upload together (course.json and its images, or one zip), as sent. */
export const COURSE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024
