import { z } from 'zod'

import { escapeEmailText } from '../escape'

/**
 * The document shell every marketing email is wrapped in.
 *
 * Taken verbatim from the designer's campaign file. All of it matters:
 *
 * - The VML/Office namespaces and the MSO conditional (PixelsPerInch 96, Arial override)
 *   are what stop Outlook picking its own fallback font and shifting the layout.
 * - `color-scheme` and `supported-color-schemes` plus the warm mid-tone palette are what
 *   stop iOS and Outlook dark mode inverting the design into something unreadable.
 * - The `<style>` block carries only media queries and resets. Several clients drop it
 *   entirely, so it is progressive enhancement and never load-bearing; the email reads
 *   correctly from inline styles alone.
 * - The hidden preheader div is the ~85 characters shown next to the subject line in the
 *   inbox. The zero-width joiners after it stop body copy leaking into that preview.
 */

/** Padding that stops the inbox preview spilling into body copy. Count is from the source. */
const PREHEADER_PADDING = '&#8203;' + '&#847;'.repeat(56)

export const shellSchema = z.object({
  /** Shown in the browser tab of "view in browser" and by a few clients. */
  title: z.string().min(1).max(200),
  /** Aim for roughly 85 characters. Always set this per send. */
  preheader: z.string().min(1).max(300),
})

export type ShellData = z.infer<typeof shellSchema>

export function renderShellHead(data: ShellData): string {
  return `<!DOCTYPE html>
<html lang="en-GB" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeEmailText(data.title)}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<style>table,td,div,p,a{font-family:Arial,Helvetica,sans-serif !important;}</style>
<![endif]-->
<style>
  body{margin:0;padding:0;width:100% !important;background-color:#e6e0d4;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}
  img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
  a{color:#8b6914;}
  @media only screen and (max-width:620px){
    .wrap{width:100% !important;max-width:100% !important;}
    .stack{display:block !important;width:100% !important;max-width:100% !important;box-sizing:border-box !important;}
    .gutter{padding-left:20px !important;padding-right:20px !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#e6e0d4">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#e6e0d4">${escapeEmailText(data.preheader)}${PREHEADER_PADDING}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#e6e0d4"><tbody><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#faf8f3">
<tbody>
`
}

export function renderShellFoot(): string {
  return `</tbody></table>
</td></tr></tbody></table>
</body>
</html>
`
}

export const SHELL_HEAD_FIXTURE = 'shell_head.html'
export const SHELL_FOOT_FIXTURE = 'shell_foot.html'

/** The handover's own values, used by the fidelity test. */
export const shellSample: ShellData = {
  title: 'Christmas bookings are open at The Anchor',
  preheader: 'Christmas dinner 10 November to 20 December, and lunch is back from midday, Tuesday to Friday.',
}
