# Discovery 05 — Customer Name Clickability Inventory

**Scope:** Every place a CUSTOMER's name is displayed in the staff-facing UI, classified by whether it is already a clickable link to the customer profile (`/customers/[id]`).

**Date:** 2026-06-21
**Mode:** Read-only discovery.

---

## (a) Canonical link pattern & existing components

### Link pattern
There is **no shared link helper**. Every linked customer name is hand-rolled with one of:

```tsx
<Link href={`/customers/${customer.id}`} className="...">{name}</Link>
// or imperative:
router.push(`/customers/${selectedCustomerId}`)
```

Only **3 files** in the entire authenticated app link a name (or row) to a customer profile:

| File | Line | Pattern |
|------|------|---------|
| `src/app/(authenticated)/customers/_components/CustomersClient.tsx` | 467 | `<Link href={`/customers/${customer.id}`}>` wrapping `<CustomerName>` |
| `src/app/(authenticated)/customers/CustomersClient.tsx` | 435, 727 | `<Link href={`/customers/${customer.id}`}>` wrapping `<CustomerName>` (legacy/duplicate list) |
| `src/app/(authenticated)/settings/sms-failures/page.tsx` | 226 | `<Link href={`/customers/${row.customer_id}`}>{getCustomerName(row)}</Link>` |
| `src/app/(authenticated)/messages/_components/MessagesClient.tsx` | 565, 711 | `router.push(`/customers/${selectedCustomerId}`)` — a separate **"View profile" button**, NOT the name itself |

### Existing component — `CustomerName`
`src/components/features/customers/CustomerName.tsx` exists, **but it is display-only** — it renders the joined name + optional mobile + a loyalty star inside a `<span>`. **It is NOT a link** and contains no `href`/`id` logic. It is used in only 2 places (the two customers-list variants). It is **not exported from the `@/ds` barrel**.

Other name-formatting helpers (no linking) are duplicated ad-hoc:
- `formatCustomerName(customer)` — local fn in `MessagesClient.tsx` (line 48)
- inline `[first_name, last_name].filter(Boolean).join(' ')` — repeated in ~15+ files
- `getCustomerName(row)` — local helper in `sms-failures/page.tsx`

**Conclusion:** No reusable clickable `CustomerLink` component exists. `CustomerName` is the closest thing but is non-interactive and barely used.

---

## (b) Inventory of customer-name display locations (by module)

Legend — **Linked?** = name renders as link to `/customers/[id]`. **Id available?** = a customer id is present on the rendered object (so it *could* be linked without a query change).

### Customers
| Page | File:line | Context | Linked? | Id avail? |
|------|-----------|---------|:---:|:---:|
| Customers list (new) | `customers/_components/CustomersClient.tsx:467-468` | `<Link>` wraps `<CustomerName>` | **Y** | Y |
| Customers list (legacy/dup) | `customers/CustomersClient.tsx:435-436, 727-732` | `<Link>` wraps `<CustomerName>` | **Y** | Y |
| Customer profile header | `customers/[id]/page.tsx:972` | own name title (self page) | N/A | Y (self) |

### Events / Event bookings
| Page | File:line | Context | Linked? | Id avail? |
|------|-----------|---------|:---:|:---:|
| Event detail — bookings table | `events/[id]/EventDetailClient.tsx:989-999` | `customerName` from `booking.customer.first/last_name` → `<TableCell>{customerName}</TableCell>` plain text | **N** | **Y** (`booking.customer.id`) |
| Events command center data | `events/get-events-command-center.ts:49` | `customer_name: string` in payload; surfaced in event board/drawer | **N** | partial (depends on payload) |

### Table bookings
| Page | File:line | Context | Linked? | Id avail? |
|------|-----------|---------|:---:|:---:|
| Booking detail | `table-bookings/[id]/BookingDetailClient.tsx:352, 632, 667` | `guestName` plain text (`<p>` and `DetailItem`) | **N** | **Y** (`booking.customer.id`, joined in `[id]/page.tsx:36-37`) |
| BOH list | `table-bookings/boh/BohBookingsClient.tsx:893-894` | `{booking.guest_name}` plain in `<td>` | **N** | **Y** (`customer.id` on row type, lines 74-82) |
| FOH/List view | `table-bookings/_components/ListView.tsx:92` | `{b.guestName}` plain in `<TableCell>` | **N** | likely (depends on `b` shape — needs verify) |
| FOH create modal (search) | `table-bookings/foh/components/FohCreateBookingModal.tsx:189+` | customer picker results — selection UI, not profile link | N/A | Y |
| Reports (guest rows) | `table-bookings/reports/page.tsx:265` | `key={guest.customer_id}`, name shown plain | **N** | **Y** (`guest.customer_id`) |

### Private bookings
| Page | File:line | Context | Linked? | Id avail? |
|------|-----------|---------|:---:|:---:|
| List (cards) | `private-bookings/_components/PrivateBookingsClient.tsx:530, 655` | `{booking.customer_name}` plain; card links to `/private-bookings/[id]` not customer | **N** | **maybe** (`private_bookings.customer_id` column exists & nullable; not confirmed in client row shape) |
| Detail header/breadcrumb | `private-bookings/[id]/PrivateBookingDetailClient.tsx:2081, 2085` | `booking.customer_full_name || booking.customer_name` as title | **N** | maybe (nullable `customer_id`) |

> Note: private bookings store **denormalized** `customer_first_name` / `customer_last_name` / `customer_name`, synced from the customers table only when `customer_id` is set (see migration comment, `20251123120000_squashed.sql:3024`). `customer_id` is nullable — many private bookings have no linked customer.

### Parking
| Page | File:line | Context | Linked? | Id avail? |
|------|-----------|---------|:---:|:---:|
| Parking list (table) | `parking/_components/ParkingClient.tsx:437` | `{booking.customer_first_name} {booking.customer_last_name}` plain `<TableCell>` | **N** | **maybe** — `parking_bookings.customer_id` column + index exists (`squashed.sql:12854`); not confirmed in client row shape |
| Parking detail row | `parking/_components/ParkingClient.tsx:461` | `DetailRow` Customer value, plain | **N** | maybe |
| (legacy dup) | `parking/ParkingClient.tsx:423, 446` | same, plain text | **N** | maybe |

### Messages
| Page | File:line | Context | Linked? | Id avail? |
|------|-----------|---------|:---:|:---:|
| Conversation list item | `messages/_components/MessagesClient.tsx:504, 510` | `{formatCustomerName(conversation.customer)}` inside a `<button>` that selects the conversation (not a profile link) | **N** (name) | **Y** (`conversation.customer.id`) |
| Conversation header | `messages/_components/MessagesClient.tsx:363` | `customerName` plain; **separate "View profile" button** at 565/711 links to profile | **N** (name) / **Y** (button) | Y |

### Dashboard
| Page | File:line | Context | Linked? | Id avail? |
|------|-----------|---------|:---:|:---:|
| Today schedule — private booking | `dashboard/page.tsx:115` | `title: booking.customer_name`; card `href: /private-bookings/${id}` | **N** (to customer) | id is private-booking id, customer id present in `dashboard-data.ts` (`customer_id` line 1006) but not used for name |
| Today schedule — parking | `dashboard/page.tsx:123` | `subtitle: customer_first/last_name`; card `href: '/parking'` | **N** | not surfaced |
| Private-booking balances widget | `dashboard/private-booking-balances.ts:93` | `customer_name` plain in balances list | **N** | partial |

### Settings / SMS
| Page | File:line | Context | Linked? | Id avail? |
|------|-----------|---------|:---:|:---:|
| SMS failures table | `settings/sms-failures/page.tsx:226` | `<Link href={`/customers/${row.customer_id}`}>{getCustomerName(row)}</Link>` | **Y** | Y |

### Out of scope but adjacent (NOT customers — flagged to avoid ambiguity)
- **Invoices** use **vendors**, not customers (`invoices/**` — `vendor.name`, `vendor.contact_name`). Not customer-profile linkable.
- **Employees / applicants** render `first_name`/`last_name` widely (rota, dashboard birthdays `dashboard-data.ts:1321+`, timeclock `FohClockWidget.tsx`, `table-bookings/foh/page.tsx:81`). These are **employees**, link to `/employees/[id]` not `/customers/[id]`. Keep separate.
- `temp/*.ts` scripts reference employee names — not UI.

---

## (c) Locations where the name is shown but the customer id is NOT readily available

These would need a **query/payload change** before the name can be linked:

1. **Private bookings list & detail** — rows expose `customer_name` (denormalized) but the client row shape does not clearly carry `customer_id`; also `customer_id` is **nullable** (walk-in / manual bookings have no customer). Linking requires (a) selecting `customer_id` into the client payload and (b) conditional rendering (link only when `customer_id` present).
2. **Parking list/detail** — same situation: `customer_first/last_name` denormalized; `parking_bookings.customer_id` exists in DB but is not confirmed selected into `ParkingClient` row type. Needs payload change + null guard.
3. **Dashboard private-booking / parking cards** — names are card titles/subtitles; the card `href` is intentionally the booking/section, not the customer. Customer id is partially present for private bookings (`dashboard-data.ts:1006`) but not for parking. Low priority (card already navigates somewhere sensible).
4. **Events command center / EventDrawer** — `customer_name` is a flat string in the command-center payload; no customer id alongside it. Needs payload change.

**Already have id, just need a Link wrapper (cheap wins):**
- Event detail bookings table (`booking.customer.id`)
- Table booking detail (`booking.customer.id`)
- Table booking BOH list (`customer.id` on row type)
- Table booking reports (`guest.customer_id`)
- Messages conversation list & header (`conversation.customer.id`) — name itself currently not a link

---

## (d) Recommendation — single shared `CustomerLink` component

**Yes — create one shared component and standardise on it.** Rationale:
- Linking logic is currently hand-rolled in only 3 places and absent everywhere else; the name-join logic is duplicated 15+ times.
- The existing `CustomerName` is display-only and under-used — it should either be wrapped by, or absorbed into, the new component.

**Proposed:** `CustomerLink` exported from `@/ds` (or `src/components/features/customers/`):

```tsx
interface CustomerLinkProps {
  customerId: string | null | undefined
  customer?: { first_name?: string | null; last_name?: string | null; mobile_number?: string | null; isLoyal?: boolean }
  name?: string            // fallback when only a flat name string is available (private bookings, parking)
  showMobile?: boolean
  className?: string
}
```

Behaviour:
- If `customerId` present → render `<Link href={`/customers/${customerId}`}>` with `text-primary hover:underline` (design token, matches `sms-failures` pattern).
- If `customerId` absent → render plain `<span>` (graceful for walk-ins / unlinked private bookings / parking with no customer).
- Reuse/wrap `CustomerName` for the name + loyalty-star rendering so there is one source of truth.

**Rollout order (by traffic & ease):**
1. Cheap wins (id already present): event detail bookings, table-booking detail + BOH list + reports, messages conversation list/header.
2. Standardise existing linked surfaces (customers list ×2, sms-failures) onto `CustomerLink`.
3. Payload changes then link: private bookings, parking, dashboard cards, events command center.

---

## Summary counts

- **Linked-to-profile surfaces:** 3 files (customers list ×2, sms-failures). The Messages "View profile" button is a 4th partial (button, not the name).
- **Not-linked surfaces:** ~10 distinct render sites across events, table-bookings (×4), private-bookings (×2), parking (×3), messages (name), dashboard (×2/3).
- **Modules with the most unlinked names:** **Table bookings** (detail, BOH list, FOH/list view, reports) and **Parking** (list, detail, ×2 duplicate clients), then **Private bookings** (list + detail).
- **Reusable clickable component:** none exists. `CustomerName` is display-only.
