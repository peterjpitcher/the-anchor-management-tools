# Layout Shell Migration

We are standardising authenticated pages on the `PageLayout` + `HeaderNav` shell from `src/components/ui-v2`. This guide covers the conversion steps and gotchas.

## Before you start

- Identify whether the page still imports `PageWrapper` or `Page`. Those will be removed.
- Skim an already migrated page (e.g. `src/app/(authenticated)/dashboard/page.tsx` or `.../messages/page.tsx`) for reference.

## Migration steps

1. **Replace imports**
   ```diff
   -import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
   -import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
   +import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
   +import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'
   ```

2. **Define nav items / header actions**
   ```ts
   const navItems: HeaderNavItem[] = [
     { label: 'Overview', href: '#overview' },
     { label: 'Settings', href: '/settings' },
   ]

   const headerActions = (
     <div className="flex gap-2">
       {/* buttons, status indicators, etc. */}
     </div>
   )
   ```
   - Anchor links (`#overview`) should map to section `id` attributes inside the page.
   - External links (`/settings`) behave like the legacy `NavLink`.

3. **Wrap the page with `PageLayout`**
   ```tsx
   return (
     <PageLayout
       title="Dashboard"
       subtitle="Key metrics for today"
       backButton={{ label: 'Back', href: '/' }}
       breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Dashboard', href: '/dashboard' }]}
       navItems={navItems}
       headerActions={headerActions}
     >
       {/* content */}
     </PageLayout>
   )
   ```

4. **Replace `PageContent` sections**
   - Remove `<PageContent>` wrappers; `PageLayout` already applies spacing via `Container`.
   - Add `id` attributes to major sections so nav anchors scroll correctly.
     ```tsx
     <section id="overview" className="space-y-4">
       ...
     </section>
     ```

5. **Loading / error states**
   - If the page conditionally returned a `PageWrapper` while loading, replace it with a `PageLayout` block that reuses the same `navItems` / `headerActions`.

6. **Clean up**
   - Remove unused imports (`PageWrapper`, `PageHeader`, etc.).
   - Run `npm run lint -- --file path/to/page.tsx`.

## Tips

- For simple pages without subnav, you can omit `navItems`; `PageLayout` will skip the nav row.
- Use the optional `containerSize` or `padded` props if the page previously customised `PageContent` spacing.
- `HeaderNav` auto-highlights hash and route links; if multiple links resolve true, the first one stays active.

## Example PRs

- Dashboard: `src/app/(authenticated)/dashboard/page.tsx`
- Messages: `src/app/(authenticated)/messages/page.tsx`
- Bulk messaging: `src/app/(authenticated)/messages/bulk/page.tsx`

Refer to these when in doubt.

## Migration checklist

_Status is tracked automatically by checking whether a file imports `PageLayout`. Update this list as you migrate additional routes._

### customers
- [x] `src/app/(authenticated)/customers/[id]/page.tsx`
- [x] `src/app/(authenticated)/customers/page.tsx`

### dashboard
- [x] `src/app/(authenticated)/dashboard/page.tsx`

### employees
- [x] `src/app/(authenticated)/employees/[employee_id]/edit/page.tsx`
- [x] `src/app/(authenticated)/employees/[employee_id]/page.tsx`
- [x] `src/app/(authenticated)/employees/birthdays/page.tsx`
- [x] `src/app/(authenticated)/employees/new/page.tsx`
- [x] `src/app/(authenticated)/employees/page.tsx`

### events
- [x] `src/app/(authenticated)/events/[id]/check-in/page.tsx`
- [x] `src/app/(authenticated)/events/[id]/edit/page.tsx`
- [x] `src/app/(authenticated)/events/[id]/page.tsx`
- [x] `src/app/(authenticated)/events/new/page.tsx`
- [x] `src/app/(authenticated)/events/page.tsx`
- [x] `src/app/(authenticated)/events/todo/page.tsx`

### invoices
- [x] `src/app/(authenticated)/invoices/[id]/edit/page.tsx`
- [x] `src/app/(authenticated)/invoices/[id]/page.tsx`
- [x] `src/app/(authenticated)/invoices/[id]/payment/page.tsx`
- [x] `src/app/(authenticated)/invoices/catalog/page.tsx`
- [x] `src/app/(authenticated)/invoices/export/page.tsx`
- [x] `src/app/(authenticated)/invoices/new/page.tsx`
- [x] `src/app/(authenticated)/invoices/page.tsx`
- [x] `src/app/(authenticated)/invoices/recurring/[id]/edit/page.tsx`
- [x] `src/app/(authenticated)/invoices/recurring/[id]/page.tsx`
- [x] `src/app/(authenticated)/invoices/recurring/new/page.tsx`
- [x] `src/app/(authenticated)/invoices/recurring/page.tsx`
- [x] `src/app/(authenticated)/invoices/vendors/page.tsx`

### messages
- [x] `src/app/(authenticated)/messages/bulk/page.tsx`
- [x] `src/app/(authenticated)/messages/page.tsx`
- [x] `src/app/(authenticated)/messages/queue/page.tsx`

### parking
- [x] `src/app/(authenticated)/parking/page.tsx`

### private bookings
- [x] `src/app/(authenticated)/private-bookings/PrivateBookingsClient.tsx`
- [x] `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx`
- [x] `src/app/(authenticated)/private-bookings/[id]/contract/page.tsx`
- [x] `src/app/(authenticated)/private-bookings/[id]/edit/page.tsx`
- [x] `src/app/(authenticated)/private-bookings/[id]/items/page.tsx`
- [x] `src/app/(authenticated)/private-bookings/[id]/messages/page.tsx`
- [x] `src/app/(authenticated)/private-bookings/[id]/page.tsx`
- [x] `src/app/(authenticated)/private-bookings/calendar/page.tsx`
- [x] `src/app/(authenticated)/private-bookings/new/page.tsx`
- [x] `src/app/(authenticated)/private-bookings/page.tsx`
- [x] `src/app/(authenticated)/private-bookings/settings/catering/page.tsx`
- [x] `src/app/(authenticated)/private-bookings/settings/spaces/page.tsx`
- [x] `src/app/(authenticated)/private-bookings/settings/vendors/page.tsx`
- [x] `src/app/(authenticated)/private-bookings/sms-queue/page.tsx`

### profile
- [x] `src/app/(authenticated)/profile/change-password/page.tsx`
- [x] `src/app/(authenticated)/profile/page.tsx`

### quotes
- [x] `src/app/(authenticated)/quotes/[id]/convert/page.tsx`
- [x] `src/app/(authenticated)/quotes/[id]/edit/page.tsx`
- [x] `src/app/(authenticated)/quotes/[id]/page.tsx`
- [x] `src/app/(authenticated)/quotes/new/page.tsx`
- [x] `src/app/(authenticated)/quotes/page.tsx`

### receipts
- [x] `src/app/(authenticated)/receipts/bulk/page.tsx`
- [x] `src/app/(authenticated)/receipts/missing-expense/page.tsx`
- [x] `src/app/(authenticated)/receipts/monthly/page.tsx`
- [x] `src/app/(authenticated)/receipts/page.tsx`
- [x] `src/app/(authenticated)/receipts/pnl/page.tsx`
- [x] `src/app/(authenticated)/receipts/vendors/page.tsx`

### roles
- [x] `src/app/(authenticated)/roles/new/page.tsx`
 - [x] `src/app/(authenticated)/roles/page.tsx`

### settings
- [x] `src/app/(authenticated)/settings/api-keys/page.tsx`
- [x] `src/app/(authenticated)/settings/audit-logs/page.tsx`
- [x] `src/app/(authenticated)/settings/background-jobs/page.tsx`
- [x] `src/app/(authenticated)/settings/business-hours/page.tsx`
- [x] `src/app/(authenticated)/settings/categories/page.tsx`
- [x] `src/app/(authenticated)/settings/customer-labels/page.tsx`
- [x] `src/app/(authenticated)/settings/event-categories/page.tsx`
- [x] `src/app/(authenticated)/settings/gdpr/page.tsx`
- [x] `src/app/(authenticated)/settings/import-messages/page.tsx`
- [x] `src/app/(authenticated)/settings/message-templates/page.tsx`
- [x] `src/app/(authenticated)/settings/page.tsx`
- [x] `src/app/(authenticated)/settings/sync-birthdays/page.tsx`

### short links
- [x] `src/app/(authenticated)/short-links/page.tsx`

### table bookings
- [x] `src/app/(authenticated)/table-bookings/[id]/edit/page.tsx`
- [x] `src/app/(authenticated)/table-bookings/[id]/page.tsx`
- [x] `src/app/(authenticated)/table-bookings/[id]/payment/page.tsx` *(redirect only – no layout shell required)*
- [x] `src/app/(authenticated)/table-bookings/calendar/page.tsx`
- [x] `src/app/(authenticated)/table-bookings/monitoring/page.tsx`
- [x] `src/app/(authenticated)/table-bookings/new/page.tsx`
- [x] `src/app/(authenticated)/table-bookings/page.tsx`
- [x] `src/app/(authenticated)/table-bookings/reports/page.tsx`
- [x] `src/app/(authenticated)/table-bookings/search/page.tsx`
- [x] `src/app/(authenticated)/table-bookings/settings/page.tsx`
- [x] `src/app/(authenticated)/table-bookings/settings/policies/page.tsx`
- [x] `src/app/(authenticated)/table-bookings/settings/sms-templates/page.tsx`
- [x] `src/app/(authenticated)/table-bookings/settings/sunday-lunch/page.tsx`
- [x] `src/app/(authenticated)/table-bookings/settings/tables/page.tsx`

### unauthorized
- [x] `src/app/(authenticated)/unauthorized/page.tsx`

### users
- [x] `src/app/(authenticated)/users/page.tsx`
