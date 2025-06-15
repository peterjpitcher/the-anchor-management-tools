# Project Overview

## Introduction

The Anchor Management Tools is a comprehensive web-based application designed specifically for The Anchor venue. It streamlines the management of events, customers, and employees while providing automated SMS notifications for bookings and reminders.

## Purpose

This application serves as the central management system for The Anchor, enabling staff to:
- Schedule and manage events
- Track customer bookings and preferences
- Manage employee records and documentation
- Send automated SMS confirmations and reminders
- Monitor venue operations through a unified dashboard

## Key Features

### Event Management
- Create, edit, and delete events with date/time scheduling
- Track event capacity and bookings
- View attendee lists and booking details
- Automated reminder system for upcoming events

### Customer Management
- Comprehensive customer database with contact information
- Booking history tracking
- Support for both seated bookings and reminder-only entries
- Direct SMS communication capabilities

### Employee Management
- Complete employee profiles with personal and emergency contact information
- Document management system for contracts, IDs, and other files
- Time-stamped notes system for tracking employee updates
- Categorized file attachments with secure storage

### SMS Automation
- Automatic booking confirmation messages
- 7-day advance reminders for all customers
- 24-hour reminders for booked customers
- Daily automated SMS dispatch at 9 AM
- Integration with Twilio for reliable message delivery

## Technology Overview

The application is built with modern web technologies:
- **Frontend**: Next.js 15 with React 19 and TypeScript
- **Database**: Supabase (PostgreSQL) with Row Level Security
- **Authentication**: Supabase Auth for secure access
- **Styling**: Tailwind CSS for responsive design
- **SMS Service**: Twilio for message delivery
- **Hosting**: Vercel with serverless functions
- **Automation**: Vercel cron jobs for scheduled tasks

## User Roles

Currently, the system supports a single authenticated user role with full access to all features. All users must be manually created in Supabase Auth.

## System Architecture

The application follows a modern serverless architecture:
- Server-side rendering with Next.js App Router
- Server Actions for data mutations
- Real-time database operations with Supabase
- Secure file storage with Supabase Storage
- Automated background jobs for SMS reminders

## Browser Support

The application is optimized for modern browsers:
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers on iOS and Android

## Mobile Responsiveness

The entire application is fully responsive and optimized for mobile devices, featuring:
- Touch-friendly interfaces
- Responsive tables that transform to card layouts
- Bottom navigation for mobile users
- Optimized forms for small screens