# The Anchor Management Tools

A comprehensive venue management system designed to streamline operations at The Anchor, featuring event scheduling, customer management, employee records, and automated SMS notifications.

**Production URL**: https://management.orangejelly.co.uk

## 🚀 Key Features

### Event Management
- Create, edit, and manage events with real-time capacity tracking
- Support for multiple event categories with custom features
- Automated attendee list management and booking tracking
- Calendar integration for scheduling

### Customer Management  
- Comprehensive customer database with booking history
- Support for both seated bookings and reminder-only entries
- Customer messaging health tracking for SMS delivery
- Direct communication capabilities

### Employee Management
- Complete employee profiles with personal and emergency contacts
- Document management system for contracts, IDs, and certifications
- Time-stamped notes system for tracking updates
- Secure file storage with categorized attachments

### SMS Automation
- Automatic booking confirmation messages
- 7-day advance reminders for all customers
- 24-hour reminders for booked customers  
- Daily automated dispatch at 9 AM UTC
- Integration with Twilio for reliable delivery

### Private Bookings
- Venue hire management with customizable packages
- Quote and invoice generation with PDF exports
- Payment tracking and deposit management
- Automated contract generation

## 🛠 Tech Stack

- **Frontend**: Next.js 15.3.3, React 19.1.0, TypeScript
- **Database**: Supabase (PostgreSQL with Row Level Security)
- **Authentication**: Supabase Auth with RBAC
- **Styling**: Tailwind CSS 3.4.0
- **SMS Service**: Twilio 5.7.0
- **Email**: Microsoft Graph API (Office 365)
- **PDF Generation**: Puppeteer 24.12.1
- **Hosting**: Vercel (serverless architecture)
- **Automation**: Vercel cron jobs

## 🚦 Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Supabase account
- Twilio account (for SMS)
- Microsoft 365 account (for email)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/your-username/anchor-management-tools.git
cd anchor-management-tools
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
```

4. Configure your environment variables in `.env.local` with your Supabase, Twilio, and other credentials.

5. Run the development server:
```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000)

## 📁 Project Structure

```
src/
├── app/                    # Next.js 15 App Router
│   ├── (authenticated)/    # Protected routes
│   ├── actions/           # Server actions for mutations
│   └── api/               # API routes for webhooks/cron
├── components/            # Reusable UI components
│   ├── providers/         # React context providers
│   └── ui/                # Core UI components
├── contexts/              # Application contexts
├── lib/                   # Core utilities
│   ├── supabase/         # Database client
│   └── sms/              # SMS integration
├── types/                # TypeScript definitions
└── utils/                # Helper functions

supabase/
├── migrations/           # Database migrations
└── functions/           # Edge functions

docs/                    # Comprehensive documentation
scripts/                 # Utility scripts
tests/                   # Playwright E2E tests
```

## 📖 Documentation

### Getting Started
- [Overview](./2025-06-15-overview.md) - Project introduction
- [Installation Guide](./installation.md) - Detailed setup instructions
- [Configuration](./configuration.md) - Environment setup

### Development
- [Developer Guide](./2025-06-26-developer-guide.md) - Contributing guidelines
- [API Documentation](./2025-06-26-api-documentation.md) - Server actions and endpoints
- [Database Documentation](./2025-06-26-database-documentation.md) - Schema and relationships
- [Style Guide](./2025-06-15-style-guide.md) - UI/UX conventions

### Features
- [Authentication](./2025-06-15-feature-authentication.md) - Auth system guide
- [Events](./2025-06-15-feature-events.md) - Event management
- [Customers](./2025-06-15-feature-customers.md) - Customer features
- [Employees](./2025-06-15-feature-employees.md) - Employee management
- [Private Bookings](./2025-06-21-feature-private-bookings.md) - Venue hire
- [SMS](./2025-06-15-feature-sms.md) - Messaging system

### Operations
- [Deployment Guide](./2025-06-26-deployment-guide.md) - Production deployment
- [Monitoring](./monitoring.md) - Application monitoring
- [Troubleshooting](./troubleshooting.md) - Common issues

### Architecture & Security
- [System Architecture Review](./system-architecture-review-2025.md) - Technical deep dive
- [Security](./2025-06-15-security.md) - Security practices
- [RBAC](./2025-06-17-rbac.md) - Role-based access control
- [GDPR Compliance](./2025-06-21-gdpr-compliance.md) - Data protection

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test suite
npm run test:employees

# Run tests with UI (debugging)
npm run test:employees:ui

# Run comprehensive test suite
npm run test:comprehensive
```

Tests run against the production URL by default. See [tests/TEST_README.md](../tests/TEST_README.md) for details.

## 🚀 Deployment

The application is deployed on Vercel with automatic deployments from the main branch.

```bash
# Build for production
npm run build

# Run production build locally
npm run start
```

See [Deployment Guide](./2025-06-26-deployment-guide.md) for detailed instructions.

## 🔧 Utility Scripts

```bash
# Test database connectivity
tsx scripts/test-connectivity.ts

# Analyze schema consistency
tsx scripts/analyze-schema-consistency.ts

# Security scan
tsx scripts/security-scan.ts

# Performance analysis
tsx scripts/analyze-performance.ts

# Check invalid phone numbers
tsx scripts/check-invalid-phone-numbers.ts
```

Full list available in the [scripts directory](../scripts/).

## 📊 System Health

Based on the latest system review (January 2025):

- ✅ **Functional**: All core features operational
- ⚠️ **Performance**: Some optimization needed (private bookings)
- ✅ **Security**: RBAC and RLS properly implemented
- ⚠️ **Technical Debt**: Some naming inconsistencies
- ✅ **Monitoring**: Comprehensive audit logging

See [System Review Executive Summary](./system-review-executive-summary.md) for details.

## 🤝 Contributing

Please read the [Developer Guide](./2025-06-26-developer-guide.md) for our development process and coding standards.

Key points:
- Use server actions for all mutations
- Follow the established naming conventions
- Add comprehensive tests for new features
- Update documentation for significant changes

## 📄 License

This project is proprietary software for The Anchor venue.

## 📞 Support

For questions or issues:
- Check the [Troubleshooting Guide](./troubleshooting.md)
- Review the [Documentation Index](./2025-06-15-readme.md)
- Contact the development team

---

**Last Updated**: 2025-07-26