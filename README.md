# The Anchor Management Tools

A comprehensive venue management system for The Anchor, featuring event scheduling, customer management, employee records, and automated SMS notifications.

**Production URL**: https://management.orangejelly.co.uk

## 🚀 Tech Stack

- **Frontend**: Next.js 15.3.3, React 19.1.0, TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL with RLS, Auth, Storage)
- **SMS**: Twilio
- **Email**: Microsoft Graph API (Office 365)
- **PDF Generation**: Puppeteer
- **Hosting**: Vercel

## 📁 Project Structure

```
anchor-management-tools/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (authenticated)/    # Protected routes
│   │   ├── actions/           # Server actions for data mutations
│   │   └── api/               # API routes (webhooks, cron)
│   ├── components/            # Reusable UI components
│   ├── contexts/              # React contexts (Permissions)
│   ├── lib/                   # Core utilities (Supabase, SMS)
│   └── types/                 # TypeScript type definitions
├── supabase/
│   └── migrations/            # Database migrations
├── scripts/
│   ├── sms-tools/            # SMS utility scripts
│   ├── utilities/            # General utility scripts
│   └── _archive/             # Archived old scripts
├── docs/                      # Project documentation
└── public/                    # Static assets
```

## 🔧 Setup

### Prerequisites
- Node.js 20.x
- npm

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env.local
   ```

4. Configure the following in `.env.local`:
   - Supabase credentials
   - Twilio API credentials
   - Microsoft Graph API credentials
   - Google Calendar API credentials

### Development

```bash
npm run dev
```

The application will be available at http://localhost:3000

## 🏗️ Development Guidelines

### Key Patterns

1. **Server Actions**: All data mutations use server actions (no API routes for mutations)
2. **Permissions**: Always check permissions with `checkUserPermission()`
3. **Audit Logging**: Log sensitive operations with `logAuditEvent()`
4. **Supabase Context**: Never create new clients, use `SupabaseProvider`
5. **Phone Numbers**: Normalize to E.164 (`+<country><number>`). Local input defaults to country code `44` unless a country code is explicitly provided.

### Essential Commands

```bash
npm run dev    # Start development server
npm run build  # Build for production
npm run lint   # Run ESLint
npm start      # Start production server
```

### Utility Scripts

Located in `/scripts/sms-tools/`:
- `check-reminder-issues.ts` - Check SMS reminder issues
- `fix-past-reminders.ts` - Fix past event reminders
- `check-all-jobs.ts` - Monitor job queue
- `clear-stuck-jobs.ts` - Clear stuck processing jobs

Run with:
```bash
tsx scripts/sms-tools/[script-name].ts
```

## 🔐 Security

- Role-based access control (RBAC) with super_admin, manager, and staff roles
- Row Level Security (RLS) policies on all database tables
- Audit logging for all sensitive operations
- Environment variables for all secrets
- Webhook signature validation for Twilio

## 📊 Key Features

- **Event Management**: Create and manage venue events with capacity tracking
- **Customer Database**: Track customer information and SMS preferences
- **Booking System**: Handle event, table, and car-park bookings
- **SMS Notifications**: Automated reminders and confirmations via Twilio
- **Employee Management**: Staff records with document storage
- **Private Bookings**: Manage private venue hire
- **Invoicing**: Generate and email PDF invoices

## 🕒 Scheduled Jobs

The application relies on Vercel Cron (or an equivalent scheduler) for background processing. All cron endpoints expect the `Authorization: Bearer <CRON_SECRET>` header in production environments.

| Endpoint | Frequency | Purpose |
| --- | --- | --- |
| `/api/cron/parking-notifications` | Daily at 07:00 London | Sends pending-payment reminders, customer start/end SMS, and manager emails for parking bookings. |
| `/api/cron/table-booking-reminders` | Daily | Existing table booking reminder flow. |

Set `CRON_SECRET` in deployment environments to the shared secret used by your scheduler.
- **Loyalty Program**: Customer loyalty tracking and rewards

## 🚦 Database Tables

- `events` - Event management
- `customers` - Customer records
- `bookings` - Event bookings
- `employees` - Employee records
- `messages` - SMS history
- `private_bookings` - Private venue bookings
- `audit_logs` - Audit trail
- `jobs` - Background job queue
- `rbac_roles/rbac_permissions` - Access control

## 📚 Documentation

The full documentation set lives in `docs/`. Start with [docs/README.md](docs/README.md) for the index of architecture, security, operations, and API guides.

## 🛠️ Maintenance

### Database Migrations

Migrations are located in `/supabase/migrations/`. Format: `YYYYMMDDHHMMSS_description.sql`

Apply migrations:
```bash
npx supabase db push
```

### Job Queue

The system uses a background job queue for SMS sending and other async tasks. Jobs are processed via a cron endpoint every 5 minutes.

Monitor jobs:
```bash
tsx scripts/sms-tools/check-all-jobs.ts
```

Clear stuck jobs:
```bash
tsx scripts/sms-tools/clear-stuck-jobs.ts
```

## 🌐 Deployment

The application is deployed on Vercel with automatic deployments from the main branch.

Production URL: https://management.orangejelly.co.uk

---

© 2024 The Anchor Management Tools

## 🧭 Layout Migration Status

We are standardising on the new `PageLayout` + `HeaderNav` shell (`src/components/ui-v2/layout/PageLayout.tsx`, `src/components/ui-v2/navigation/HeaderNav.tsx`). Newly migrated examples:

- `src/app/(authenticated)/settings/page.tsx`
- `src/app/(authenticated)/events/EventsClient.tsx`
- `src/app/(authenticated)/customers/page.tsx`

Pages still using the legacy `PageWrapper`/`Page` should follow these as references when refactoring.
