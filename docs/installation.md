# Installation Guide

This guide will walk you through setting up The Anchor Management Tools on your local development environment.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** 18.17 or later ([Download](https://nodejs.org/))
- **npm** 9.6.7 or later (comes with Node.js)
- **Git** for version control ([Download](https://git-scm.com/))
- A code editor (VS Code recommended)

You'll also need accounts for:
- **Supabase** ([Sign up](https://supabase.com))
- **Twilio** ([Sign up](https://www.twilio.com))
- **Vercel** (for deployment) ([Sign up](https://vercel.com))
- **GitHub** (for version control and CI/CD)

## Step-by-Step Installation

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/EventPlanner3.0.git
cd EventPlanner3.0
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required packages including:
- Next.js and React
- Supabase client libraries
- Tailwind CSS
- Twilio SDK
- Other project dependencies

### 3. Set Up Supabase

1. Create a new project in [Supabase Dashboard](https://app.supabase.com)
2. Navigate to Settings → API to find your project credentials
3. Run the database migrations:
   - Go to SQL Editor in Supabase Dashboard
   - Execute each migration file in order from `supabase/migrations/`
   - Start with the earliest timestamp and proceed chronologically

### 4. Configure Environment Variables

Create a `.env.local` file in the root directory:

```bash
cp .env.example .env.local
```

Then edit `.env.local` with your credentials:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Twilio Configuration
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=your-twilio-phone-number

# Application Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=your-secure-cron-secret
```

### 5. Set Up Storage Buckets

In your Supabase Dashboard:

1. Go to Storage
2. Create a new bucket called `employee-attachments`
3. Set the bucket to private (authenticated access only)
4. Configure RLS policies as defined in the migration files

### 6. Create Initial User

Since there's no public registration:

1. Go to Supabase Dashboard → Authentication → Users
2. Click "Invite User"
3. Enter the email address for the initial admin user
4. The user will receive an email to set their password

### 7. Run the Development Server

```bash
npm run dev
```

The application will be available at [http://localhost:3000](http://localhost:3000)

## Verification Steps

After installation, verify everything is working:

1. **Authentication**: Try logging in with your created user
2. **Database**: Check that all tables exist in Supabase
3. **Storage**: Verify the employee-attachments bucket is created
4. **SMS**: Test SMS functionality with a test booking (ensure Twilio is configured)

## Common Installation Issues

### Node Version Issues
If you encounter errors, ensure you're using Node.js 18.17 or later:
```bash
node --version
```

### Database Migration Errors
- Ensure migrations are run in chronological order
- Check that your Supabase service role key has sufficient permissions
- Verify all foreign key relationships are properly established

### Environment Variable Issues
- Double-check all environment variables are correctly set
- Ensure there are no trailing spaces in the `.env.local` file
- Verify Supabase and Twilio credentials are valid

### Port Conflicts
If port 3000 is already in use:
```bash
npm run dev -- -p 3001
```

## Next Steps

Once installation is complete:
1. Review the [Configuration Guide](./configuration.md) for detailed setup options
2. Check the [Development Guide](./development/README.md) for coding standards
3. Read the [Architecture Overview](./architecture/README.md) to understand the system design

## Getting Help

If you encounter issues during installation:
1. Check the [Troubleshooting Guide](./troubleshooting.md)
2. Review the error logs in the console
3. Ensure all prerequisites are properly installed
4. Verify your environment variables are correct