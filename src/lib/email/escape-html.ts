/**
 * Escapes text for an HTML email body or attribute.
 *
 * Anything a person typed (a name, a job title, a note) must go through this before it is put
 * into an email's HTML: a name such as `Sam <b>` or `O'Neil & Co` otherwise breaks the markup,
 * and a crafted one could inject links or images into a message staff trust.
 *
 * Several senders still keep a private copy of this function; new code imports this one.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
