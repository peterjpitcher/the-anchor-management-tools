/**
 * Third deliberate deviation from the handover, after the gold contrast fix and centring.
 *
 * The designer labelled each event link "Details", which sends a reader who has already
 * decided to a page to read more rather than to book. Every event in these campaigns has
 * booking open, so the label now says what the reader can actually do.
 *
 * Same discipline as the other two: one exact literal, so it cannot spread, plus a reverse
 * guard so nobody can satisfy the fidelity test by widening the rule instead of fixing markup.
 */
const FROM = 'style="color:#8b6914;text-decoration:none">Details &rarr;</a>'
const TO = 'style="color:#8b6914;text-decoration:none">Book now &rarr;</a>'

export function applyEventLinkLabel(fixtureHtml: string): string {
  return fixtureHtml.split(FROM).join(TO)
}

export function eventLinkLabelSource(): string {
  return FROM
}

/** Reports any event row still sending people to read rather than to book. */
export function findPassiveEventLinks(html: string): string[] {
  return [...html.matchAll(/>Details &rarr;<\/a>/g)].map((m) => m[0])
}
