# Research Notes — Rota Calendar Feed v2

_Compiled: 2026-03-15. Sources: RFC 5545 (rfc-editor.org), icalendar.org, Google Calendar Help, Stack Overflow (SO #17152251), prior codebase analysis reports._

---

## 1. Google Calendar ICS Refresh Frequency

### What Google documents

Google does not publish a precise polling interval in its public help documentation. The "Other calendars" help page describes subscribing via URL but gives no SLA on refresh cadence. However, community sources and developer experience consistently report:

- **Minimum interval: 12–24 hours.** Google polls subscribed ICS feeds roughly once per day. The exact timing is server-side and not disclosed.
- **Maximum interval: up to 7 days** if Google's heuristics determine the feed content is unlikely to have changed.
- There is **no mechanism within the ICS standard** that forces Google to poll sooner. The interval is entirely controlled by Google's backend infrastructure.

### REFRESH-INTERVAL and X-PUBLISHED-TTL

- `REFRESH-INTERVAL;VALUE=DURATION:PT1H` is defined in [draft-daboo-icalendar-extensions](https://datatracker.ietf.org/doc/html/draft-daboo-icalendar-extensions-06) (not in the base RFC 5545).
- `X-PUBLISHED-TTL:PT1H` is a non-standard extension used by Apple Calendar and older Outlook builds.
- **Google Calendar ignores both properties entirely.** Setting either to `PT1H` has no effect on Google's polling frequency.
- Apple Calendar and Outlook do honour `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` — so including these properties is still worthwhile for non-Google clients, but they must not be described as fixing Google's refresh behaviour.

### Workarounds

The only documented paths to near-real-time Google Calendar updates are:
1. **Google Calendar API with push notifications** (webhook/watch channel) — bypasses ICS polling entirely.
2. **Manual user refresh** — via Google Calendar settings → "Other calendars" → refresh icon.
3. **Correct SEQUENCE and DTSTAMP** — ensures that when Google _does_ poll, it processes updates correctly rather than silently ignoring them.

**Sources:** Google Calendar Help (support.google.com/calendar/answer/37100); SO #17152251; prior codebase analysis reports.

---

## 2. HTTP ETag / Last-Modified for ICS Feeds

### How these headers should work

- **`ETag`**: A hash (or opaque token) representing the current version of the response body. The server computes it (e.g. SHA-256 of the ICS content) and returns it as `ETag: "abc123"`. On subsequent requests the client sends `If-None-Match: "abc123"`; if content is unchanged the server returns `304 Not Modified` with no body.
- **`Last-Modified`**: An RFC 7231 HTTP date representing when the resource was last changed. Clients send `If-Modified-Since: <date>`; the server returns `304` if nothing changed since then.

### Does Google Calendar use them?

- Google Calendar's ICS subscription polling engine **does issue conditional GET requests** using `If-None-Match` and `If-Modified-Since` when the server supplies these headers.
- Without `ETag` or `Last-Modified`, every Google poll is a full blind fetch — Google has no standard mechanism to determine whether content changed since the last poll.
- The **absence** of these headers may cause some versions of Google's sync engine to treat the feed as having unpredictable content, potentially reducing polling frequency further.
- A `304 Not Modified` response is a strong signal to the client that nothing changed; a `200 OK` with identical body content is a weaker signal.

### Correct implementation pattern

```typescript
// ETag: hash of ICS body content
const etag = `"${createHash('sha256').update(icsBody).digest('hex').substring(0, 16)}"`;
const ifNoneMatch = request.headers.get('if-none-match');
if (ifNoneMatch === etag) {
  return new Response(null, { status: 304, headers: { ETag: etag } });
}

// Last-Modified: most recent published_at across all shifts in the result set
const lastModified = new Date(Math.max(...shifts.map(s => new Date(s.published_at).getTime())));
return new Response(icsBody, {
  headers: {
    'Content-Type': 'text/calendar; charset=utf-8',
    'ETag': etag,
    'Last-Modified': lastModified.toUTCString(),
    'Cache-Control': 'no-cache',
  }
});
```

**Sources:** RFC 7232 (HTTP Conditional Requests); prior codebase analysis (DEF-003).

---

## 3. webcal:// vs https:// for Google Calendar

### Does Google handle them differently?

- `webcal://` is the IANA-registered URI scheme for iCalendar subscriptions (RFC 2368 analogue for calendar). It is syntactically identical to `https://` except for the scheme prefix — most implementations simply convert `webcal://` to `https://` before fetching.
- **Google Calendar's "From URL" subscription dialog accepts both `webcal://` and `https://`** without any functional difference. The scheme does not affect Google's polling frequency or how it processes the feed content.

### Where webcal:// does matter

- **Apple Calendar**: responds to `webcal://` links by opening a one-click "subscribe" dialog. An `https://` link downloads the file instead.
- **Outlook**: similarly uses `webcal://` for the subscribe-from-link experience.
- The `CalendarSubscribeButton` component in this codebase already converts `https://` → `webcal://` via `.replace(/^https?:\/\//, 'webcal://')` — this is correct for Apple/Outlook deep-linking.

### Effect on refresh frequency

None. The URL scheme has no effect on how often Google Calendar polls the feed.

**Sources:** IANA URI scheme registry; prior codebase analysis (T041, F6); community knowledge.

---

## 4. RFC 5545 SEQUENCE Semantics

### RFC 5545 §3.8.7.4 — exact wording

> "When a calendar component is created, its sequence number is 0. It is monotonically incremented by the 'Organizer's' CUA each time the 'Organizer' makes a significant revision to the calendar component."

> "The 'Organizer' MUST increment this value when making any change to the calendar component."

Full definition (from rfc-editor.org §3.8.7.4):

- **Property Name:** SEQUENCE
- **Purpose:** Defines the revision sequence number of the calendar component within a sequence of revisions.
- **Value Type:** INTEGER
- **Conformance:** The property CAN be specified in VEVENT, VTODO, or VJOURNAL.
- **Starting value:** 0 (on creation)
- **Increment rule:** MUST be monotonically incremented on each significant revision.

### Will Google update an event if SEQUENCE stays at 0?

When Google polls and finds a VEVENT with the same UID and same SEQUENCE as it already has stored, it is **not obligated** to replace its cached version. Per RFC 5545, a higher SEQUENCE number signals a newer revision. A SEQUENCE:0 on re-poll means "this is still the original, unmodified event." Google Calendar uses this to avoid unnecessarily reprocessing events.

**Practical consequence:** If SEQUENCE never increments past 0 on a feed that deletes-and-reinserts records (the current snapshot model), Google may silently ignore event property changes (e.g. changed shift time) even when DTSTAMP has changed.

### What happens when SEQUENCE does NOT increment

- Clients conforming to RFC 5545 should treat the re-received event as identical to the stored one and leave it unchanged.
- Google Calendar's observed behaviour matches this: events with unchanged SEQUENCE and UID are not updated even if DTSTART/DTEND changed.
- The correct fix requires persisting a `sequence` integer counter per event UID in the database and incrementing it on each modification.

**Sources:** RFC 5545 §3.8.7.4 (rfc-editor.org); icalendar.org §3.8.7.4; prior codebase analysis (DEF-002, T022).

---

## 5. Cancelled Events in ICS Feeds

### RFC 5545 specification

RFC 5545 defines `STATUS` for VEVENT with values: `TENTATIVE`, `CONFIRMED`, `CANCELLED`.

> "CANCELLED — Indicates that the calendar component is cancelled."

For a **published feed** (no iTIP `METHOD` property, or `METHOD:PUBLISH`):
- The correct way to signal a cancelled event is to include the VEVENT in the feed with `STATUS:CANCELLED`.
- The UID must remain the same as the original event.
- SEQUENCE should be incremented.

### Should cancelled events be omitted or emitted with STATUS:CANCELLED?

**They must be emitted with STATUS:CANCELLED, not silently omitted.** Omitting a UID from the feed does not cause Google Calendar (or most other clients) to delete the event from the subscriber's calendar. The reason:

- Calendar clients build a local database of events indexed by UID.
- When a UID disappears from a subscribed feed, clients do not know whether it was intentionally removed or whether the feed was temporarily truncated. Most clients leave the event in place.
- When a UID appears with `STATUS:CANCELLED`, clients know definitively to remove or strike through the event.

### What Google does specifically

- **UID disappears from feed**: Google Calendar retains the event indefinitely. The event is not deleted from subscribers' calendars.
- **UID appears with STATUS:CANCELLED**: Google Calendar marks the event as cancelled and removes it from the subscriber's view.

### Correct pattern for a published feed

1. Include cancelled events in the feed with `STATUS:CANCELLED` and incremented `SEQUENCE`.
2. Retain them in the feed for a reasonable period (commonly 4 weeks after the event date).
3. After the retention period, the UID may be safely omitted — by that point the event date has passed and any stale cached copy is irrelevant.

The current implementation filters cancelled shifts with `.neq('status', 'cancelled')`, silently omitting them. This is a defect: cancelled shifts remain visible in Google Calendar indefinitely.

**Sources:** RFC 5545 §3.6.1 (VEVENT STATUS), §3.8.1.11 (STATUS property); prior codebase analysis (Flow 5, Technical Debt table).

---

## 6. DTSTAMP Semantics

### RFC 5545 §3.8.7.2 — exact wording

> "In the case of an iCalendar object that specifies a METHOD property, this property specifies the date and time that the **instance of the iCalendar object was created**."

> "In the case of an iCalendar object that **doesn't specify a METHOD property**, this property specifies the date and time that the **information associated with the calendar component was last revised in the calendar store**."

> "In the case of an iCalendar object that doesn't specify a METHOD property, this property is equivalent to the LAST-MODIFIED property."

### Interpretation for a published feed

This feed uses `METHOD:PUBLISH`. Under the METHOD case, DTSTAMP represents **when the iCalendar message/instance was created** — i.e., the serialisation time of the iCalendar object that was sent to the client. This is legitimately the request time for the iTIP scheduling use case.

However, for a **subscription feed** (polled by Google Calendar, not push-delivered), DTSTAMP is better interpreted under the "no METHOD" semantics — i.e., the time the event data was last revised in the calendar store. This is because:

1. The feed is not a one-shot iTIP message but a continuously-polled resource.
2. Clients use DTSTAMP as a freshness signal. If DTSTAMP equals `now()` on every poll, every event appears freshly modified on every request, which is misleading noise.
3. A stable DTSTAMP (reflecting the actual last-modification time of the shift) allows clients to correctly determine whether an event has changed since the last poll.

### Correct value for DTSTAMP

For this feed, DTSTAMP should be set to **the `published_at` timestamp of the shift** (i.e., when the shift was last published/modified in `rota_published_shifts`), not the current request time (`new Date()`).

Setting DTSTAMP to `published_at` means:
- An unchanged shift has the same DTSTAMP across polls → client correctly identifies no change.
- A modified and re-published shift has a newer DTSTAMP → client correctly identifies a change.
- Combined with an incremented SEQUENCE, this gives clients a consistent and correct picture.

**Sources:** RFC 5545 §3.8.7.2 (rfc-editor.org and icalendar.org); prior codebase analysis (DEF-001, Structural Map ICS Protocol Layer).
