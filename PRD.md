# Product Requirements Document (PRD)

## Application Name: *(TBD)*  
**Owner**: Peter  
**Version**: MVP v1.4  
**Date**: 29 March 2025  

---

## 1. Objective

Develop a minimal web-based application to manage events and customer bookings. Authenticated users can create, edit, and delete customers, events, and bookings. SMS messages are sent automatically via Twilio when a booking is made or when a reminder is due.  

The application must remain minimal and clear, using free-tier-friendly tools where possible, and with no extra features beyond what is specified.

---

## 2. Authentication

- Use **Supabase Auth** with email/password login.
- Only authenticated users can access the app.
- No registration flow required — users are added manually in Supabase.
- No user roles or permissions beyond authentication.

---

## 3. Database Schema

### Events Table
Stores event information.

- `id` (UUID, Primary Key)
- `name` (string, required)
- `date` (date, required)
- `time` (string, required — e.g., `"7:00pm"`, `"12:30pm"`)
- `created_at` (timestamp, auto-generated)

### Customers Table
Stores customer information.

- `id` (UUID, Primary Key)
- `first_name` (string, required)
- `last_name` (string, required)
- `mobile_number` (string, required — valid for Twilio SMS)
- `created_at` (timestamp, auto-generated)

### Bookings Table
Links customers to events.

- `id` (UUID, Primary Key)
- `customer_id` (foreign key to Customers, required, **ON DELETE CASCADE**)
- `event_id` (foreign key to Events, required)
- `seats` (integer, nullable — if null, the booking is just a reminder)
- `created_at` (timestamp, auto-generated)

> Each customer can only be booked once per event — enforce a unique constraint on `(customer_id, event_id)`.

---

## 4. Core Functionality

### 4.1 Events
- Create, edit, delete events.
- Events must display in **date order (ascending)**.

### 4.2 Customers
- Create, edit, delete customers.
- Deleting a customer **must also delete all associated bookings**.
- No SMS should be sent on customer deletion.

### 4.3 Bookings
- Create, edit, delete bookings.
- When creating a booking, the dropdown list of customers **must exclude customers already booked for that event**.
- No need to manually send SMS.

---

## 5. SMS Functionality

### Booking Confirmation SMS
**Trigger**: When a new booking is created.  
**Template**:
Hi {{customer_name}}, your booking for {{event_name}} on {{event_date}} at {{event_time}} is confirmed. We've reserved {{seats}} seat(s) for you. Reply to this message if you need to make any changes. The Anchor.

- If `seats` is null, exclude the sentence about reserved seats.

---

### Automated Reminder SMS (Daily at 9:00 AM)

Use GitHub Actions (or similar) to run this daily job. It sends reminders via Twilio based on the event date.

#### 7-Day Reminder (for bookings 7 days from today)
**Template**:
Hi {{279971288__First Name (from Customer)}}, don't forget, we've got our {{279971288__Event Short Name (from Event Name)}} on {{279974781__output}} at {{279971288__Event Time (from Event Name)}}! If you'd like to book seats, WhatsApp/Call 01753682707

#### 24-Hour Reminder (for bookings 1 day from today)
**Template**:
Hi {{279971288__First Name (from Customer)}}, just a reminder that you're booked for {{event_name}} tomorrow at {{event_time}}. We look forward to seeing you! Reply to this message if you need to make any changes. The Anchor.

- All reminders are based on **London local time**.
- No manual triggering of SMS is required.

---

## 6. Tech Stack

All tools must be free-tier friendly unless otherwise stated.

| Component          | Technology                              |
|--------------------|------------------------------------------|
| **Auth**           | Supabase Auth (email/password)           |
| **Database**       | Supabase (PostgreSQL)                    |
| **Backend/API**    | Node.js or TypeScript                    |
| **Frontend**       | Basic web interface (React or HTML/JS)   |
| **Hosting**        | Vercel (free tier)                       |
| **Scheduler**      | GitHub Actions (cron job at 9:00 AM)     |
| **SMS Service**    | Twilio (paid account)                    |
| **Version Control**| GitHub                                   |

---

## 7. Constraints

- No public-facing UI
- No email functionality
- No search functionality
- No event seat capacity management
- No complex user management
- Time zones are not needed (London local only)
- Event times are stored as simple time strings (e.g. `"9pm"`)