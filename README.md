# Event Planner 3.0

A web-based application for managing events and customer bookings with automated SMS notifications.

## Features

- User authentication with Supabase Auth
- Event management (create, edit, delete)
- Customer management (create, edit, delete)
- Booking management (create, edit, delete)
- Automated SMS notifications via Twilio
  - Booking confirmations
  - 7-day reminders
  - 24-hour reminders

## Tech Stack

- **Frontend**: Next.js 14 with TypeScript and Tailwind CSS
- **Authentication**: Supabase Auth
- **Database**: Supabase (PostgreSQL)
- **SMS Service**: Twilio
- **Hosting**: Vercel
- **Scheduler**: GitHub Actions

## Prerequisites

- Node.js 18.17 or later
- npm 9.6.7 or later
- Supabase account
- Twilio account
- GitHub account (for deployment and scheduled tasks)

## Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Twilio
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=your-twilio-phone-number

# General
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Setup Instructions

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables
4. Set up your Supabase database tables
5. Run the development server:
   ```bash
   npm run dev
   ```

## Database Schema

### Events Table
- `id` (UUID, Primary Key)
- `name` (string, required)
- `date` (date, required)
- `time` (string, required)
- `created_at` (timestamp, auto-generated)

### Customers Table
- `id` (UUID, Primary Key)
- `first_name` (string, required)
- `last_name` (string, required)
- `mobile_number` (string, required)
- `created_at` (timestamp, auto-generated)

### Bookings Table
- `id` (UUID, Primary Key)
- `customer_id` (foreign key to Customers)
- `event_id` (foreign key to Events)
- `seats` (integer, nullable)
- `created_at` (timestamp, auto-generated)

## SMS Templates

### Booking Confirmation
```
Hi {{customer_name}}, your booking for {{event_name}} on {{event_date}} at {{event_time}} is confirmed. We've reserved {{seats}} seat(s) for you. Reply to this message if you need to make any changes. The Anchor.
```

### 7-Day Reminder
```
Hi {{customer_name}}, don't forget, we've got our {{event_name}} on {{event_date}} at {{event_time}}! If you'd like to book seats, WhatsApp/Call 01753682707
```

### 24-Hour Reminder
```
Hi {{customer_name}}, just a reminder that you're booked for {{event_name}} tomorrow at {{event_time}}. We look forward to seeing you! Reply to this message if you need to make any changes. The Anchor.
```

## Contributing

This is a private project. Please do not share or distribute without permission.

## License

Private - All rights reserved
