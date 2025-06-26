# Configuration Guide

This guide covers all configuration options for The Anchor Management Tools, including environment variables, service setup, and application settings.

## Environment Variables

All environment variables should be set in `.env.local` for local development or in your hosting platform's environment settings for production.

### Required Variables

#### Supabase Configuration
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

- **NEXT_PUBLIC_SUPABASE_URL**: Your Supabase project URL (found in project settings)
- **NEXT_PUBLIC_SUPABASE_ANON_KEY**: Public anonymous key for client-side operations
- **SUPABASE_SERVICE_ROLE_KEY**: Secret key for server-side operations (keep this secure!)

#### Twilio Configuration
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
```

- **TWILIO_ACCOUNT_SID**: Your Twilio account identifier
- **TWILIO_AUTH_TOKEN**: Secret authentication token
- **TWILIO_PHONE_NUMBER**: Your Twilio phone number (must include country code)

#### Application Configuration
```env
NEXT_PUBLIC_APP_URL=https://management.orangejelly.co.uk
CRON_SECRET=your-very-secure-random-string
```

- **NEXT_PUBLIC_APP_URL**: Full URL where your app is hosted
- **CRON_SECRET**: Secret key to secure cron job endpoints (generate a random string)

## Database Configuration

### Initial Setup

The database schema is managed through migration files in `supabase/migrations/`. Run these in order:

1. Employee tables and structure
2. Attachment categories and storage
3. RLS (Row Level Security) policies
4. Performance indexes

### Row Level Security (RLS)

Ensure RLS is enabled for all tables:
- `events` - Only authenticated users can CRUD
- `customers` - Only authenticated users can CRUD
- `bookings` - Only authenticated users can CRUD
- `employees` - Only authenticated users can CRUD
- `employee_notes` - Only authenticated users can CRUD
- `employee_attachments` - Only authenticated users can CRUD

### Storage Configuration

The `employee-attachments` bucket requires specific policies:
- Authenticated users can upload files
- Authenticated users can view files
- Authenticated users can delete files
- Files are organized by employee ID

## SMS Configuration

### Message Templates

SMS templates are defined in `src/lib/smsTemplates.ts`. The system uses three templates:

1. **Booking Confirmation** - Sent immediately when a booking is created
2. **7-Day Reminder** - Sent to all customers 7 days before an event
3. **24-Hour Reminder** - Sent to booked customers 24 hours before an event

### Twilio Settings

Configure your Twilio account:
1. Verify your phone number can send SMS to your target regions
2. Set up a messaging service if needed
3. Configure webhook URLs for delivery status (optional)

### SMS Scheduling

The cron job runs daily at 9:00 AM UTC. Adjust in `.github/workflows/reminders.yml` if needed:
```yaml
schedule:
  - cron: '0 9 * * *'  # 9 AM UTC daily
```

## Application Settings

### Time Zone
The application assumes London timezone for all operations. To change:
1. Update SMS sending logic in `src/app/actions/sms.ts`
2. Adjust cron schedule in GitHub Actions
3. Update date display formatting

### File Upload Limits
Default limits for employee attachments:
- Maximum file size: 10MB
- Allowed file types: PDF, PNG, JPG, JPEG
- Storage path pattern: `{employee_id}/{filename}`

### Session Configuration
Supabase Auth session settings:
- Session duration: 7 days (default)
- Refresh token rotation: Enabled
- JWT expiry: 3600 seconds

## Production Configuration

### Vercel Deployment

Set environment variables in Vercel Dashboard:
1. Go to Project Settings → Environment Variables
2. Add all variables from `.env.local`
3. Ensure variables are available for Production environment

### GitHub Actions

Configure secrets for automated SMS reminders:
1. Go to Repository Settings → Secrets
2. Add `VERCEL_URL` (your production URL)
3. Add `CRON_SECRET` (same as in Vercel)

### Domain Configuration

1. Add your custom domain in Vercel
2. Update `NEXT_PUBLIC_APP_URL` to match
3. Configure SSL certificate (automatic with Vercel)

## Security Configuration

### API Security
- All API routes require authentication
- Cron endpoints validate `CRON_SECRET`
- Server actions use Supabase RLS

### CORS Settings
Next.js handles CORS automatically. For custom API routes:
```typescript
headers: {
  'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL,
  'Access-Control-Allow-Methods': 'POST, GET',
}
```

### Content Security Policy
Add CSP headers for production in `next.config.js`:
```javascript
headers: [
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline';"
  }
]
```

## Performance Configuration

### Database Indexes
Critical indexes are created via migrations:
- `bookings.event_id` for event queries
- `bookings.customer_id` for customer queries
- `employee_notes.employee_id` for note lookups
- `employee_attachments.employee_id` for file queries

### Image Optimization
Next.js image optimization is enabled by default:
- Automatic WebP conversion
- Responsive image sizing
- Lazy loading

### Caching
- Static pages are cached at edge
- API responses use appropriate cache headers
- Database queries use Supabase's built-in caching

## Monitoring Configuration

### Error Tracking
Consider adding error tracking in production:
- Sentry for error monitoring
- Vercel Analytics for performance
- Custom logging for SMS operations

### Health Checks
Monitor critical services:
- Database connectivity
- Twilio API status
- Storage bucket availability

## Backup Configuration

### Database Backups
Supabase provides automatic backups:
- Point-in-time recovery (Pro plan)
- Daily backups (Free plan)
- Manual backup option via dashboard

### File Storage Backups
Employee attachments should be backed up:
- Use Supabase's backup features
- Consider external backup solution
- Implement retention policies