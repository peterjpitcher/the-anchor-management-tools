/**
 * The Anchor's Google write-a-review link, used only by the /feedback pages.
 *
 * Built from the Place ID, never a `g.page` short link: two `g.page` links on the
 * website rotted silently (one encoded the wrong business, one became a Google
 * search for its own vanity name), and nothing reported either for months. The
 * Place ID is the one the website records in `docs/SSOT.md` (section 12) and
 * `lib/constants.ts`, and matches the CID 17928230944823812473 there.
 */
const GOOGLE_PLACE_ID = 'ChIJDcbcERJxdkgReaFjdQ7fzfg'

export const GOOGLE_REVIEW_URL = `https://search.google.com/local/writereview?placeid=${GOOGLE_PLACE_ID}`
