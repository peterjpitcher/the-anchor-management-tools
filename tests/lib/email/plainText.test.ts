import { describe, expect, it } from 'vitest'
import { htmlToPlainText } from '@/lib/email/plain-text'
import { guestContactHtmlBlock, guestContactTextLine } from '@/lib/email/guest-footer'

describe('htmlToPlainText', () => {
  it('keeps a link destination beside its label, because the link is the point of the email', () => {
    const text = htmlToPlainText('<p>Tap <a href="https://l.the-anchor.pub/abc">Manage booking</a> to change it.</p>')
    expect(text).toBe('Tap Manage booking (https://l.the-anchor.pub/abc) to change it.')
  })

  it('does not repeat a URL that is already its own label', () => {
    expect(htmlToPlainText('<a href="https://www.the-anchor.pub">https://www.the-anchor.pub</a>')).toBe(
      'https://www.the-anchor.pub',
    )
  })

  it('leaves a phone or email link as the readable value, not a tel: or mailto: URI', () => {
    const text = htmlToPlainText(guestContactHtmlBlock())
    expect(text).toBe(guestContactTextLine())
    expect(text).toContain('01753 682707')
    expect(text).toContain('manager@the-anchor.pub')
    expect(text).not.toContain('tel:')
    expect(text).not.toContain('mailto:')
  })

  it('keeps paragraphs and list items apart', () => {
    expect(htmlToPlainText('<p>Sunday 20 September</p><ul><li>1pm</li><li>4 people</li></ul>')).toBe(
      'Sunday 20 September\n- 1pm\n- 4 people',
    )
  })

  it('decodes the entities these templates use', () => {
    expect(htmlToPlainText('<p>Siobh&aacute;n O&rsquo;Neill &amp; Co paid &pound;160.00</p>')).toBe(
      'Siobh&aacute;n O’Neill & Co paid £160.00',
    )
    expect(htmlToPlainText('<p>2 &times; &#163;40.00</p>')).toBe('2 x £40.00')
  })

  it('drops styles and comments rather than reading them out', () => {
    const html = '<style>p{color:red}</style><!-- preheader --><p>Your table is confirmed.</p>'
    expect(htmlToPlainText(html)).toBe('Your table is confirmed.')
  })

  it('never leaves a dash the house style bans', () => {
    const text = htmlToPlainText('<p>We owe you &mdash; we will be in touch</p><p>7&ndash;9pm</p>')
    expect(text).not.toContain(String.fromCharCode(0x2014))
    expect(text).not.toContain(String.fromCharCode(0x2013))
    expect(text).toBe('We owe you, we will be in touch\n7 to 9pm')
  })
})
