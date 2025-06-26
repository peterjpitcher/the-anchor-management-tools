# Database Schema

This document details the complete database schema for The Anchor Management Tools, including all tables, relationships, and constraints.

## Schema Overview

The database uses PostgreSQL via Supabase with the following design principles:
- UUID primary keys for all tables
- Timestamps for audit trails
- Foreign key constraints with appropriate cascade rules
- Row Level Security (RLS) for data protection
- Indexes on frequently queried columns

## Core Tables

### events
Stores information about venue events.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique event identifier |
| name | text | NOT NULL | Event name |
| date | date | NOT NULL | Event date |
| time | text | NOT NULL | Event time (e.g., "7:00pm") |
| capacity | integer | NULL | Maximum attendees (optional) |
| created_at | timestamptz | NOT NULL, DEFAULT now() | Creation timestamp |

**Indexes:**
- Primary key on `id`
- Index on `date` for chronological queries

### customers
Stores customer information.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique customer identifier |
| first_name | text | NOT NULL | Customer's first name |
| last_name | text | NOT NULL | Customer's last name |
| mobile_number | text | NOT NULL | Phone number for SMS |
| created_at | timestamptz | NOT NULL, DEFAULT now() | Creation timestamp |

**Indexes:**
- Primary key on `id`
- Index on `mobile_number` for lookups

### bookings
Links customers to events with booking details.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique booking identifier |
| customer_id | uuid | NOT NULL, REFERENCES customers(id) ON DELETE CASCADE | Customer reference |
| event_id | uuid | NOT NULL, REFERENCES events(id) ON DELETE CASCADE | Event reference |
| seats | integer | NULL | Number of seats (NULL = reminder only) |
| notes | text | NULL | Additional booking notes |
| created_at | timestamptz | NOT NULL, DEFAULT now() | Booking timestamp |

**Indexes:**
- Primary key on `id`
- Index on `customer_id` for customer queries
- Index on `event_id` for event queries
- Unique constraint on `(customer_id, event_id)` to prevent duplicates

## Employee Management Tables

### employees
Comprehensive employee information.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| employee_id | uuid | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique employee identifier |
| first_name | text | NOT NULL | Employee's first name |
| last_name | text | NOT NULL | Employee's last name |
| date_of_birth | date | NULL | Birth date |
| address | text | NULL | Home address |
| phone_number | text | NULL | Contact phone |
| email_address | text | NOT NULL, UNIQUE | Email (used for login) |
| job_title | text | NOT NULL | Current position |
| employment_start_date | date | NOT NULL | Start date |
| employment_end_date | date | NULL | End date (if applicable) |
| status | text | NOT NULL, DEFAULT 'Active' | Employment status |
| emergency_contact_name | text | NULL | Emergency contact name |
| emergency_contact_phone | text | NULL | Emergency contact phone |
| created_at | timestamptz | NOT NULL, DEFAULT now() | Record creation |
| updated_at | timestamptz | NOT NULL, DEFAULT now() | Last update |

**Indexes:**
- Primary key on `employee_id`
- Unique index on `email_address`
- Index on `status` for filtering

**Triggers:**
- Auto-update `updated_at` on row modification

### employee_notes
Time-stamped notes for employee records.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| note_id | uuid | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique note identifier |
| employee_id | uuid | NOT NULL, REFERENCES employees(employee_id) ON DELETE CASCADE | Employee reference |
| note_text | text | NOT NULL | Note content |
| created_by | uuid | NULL, REFERENCES auth.users(id) | User who created note |
| created_at | timestamptz | NOT NULL, DEFAULT now() | Note timestamp |

**Indexes:**
- Primary key on `note_id`
- Index on `employee_id` for employee queries
- Index on `created_at` for chronological ordering

### attachment_categories
Categorization for employee documents.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| category_id | uuid | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique category identifier |
| category_name | text | NOT NULL, UNIQUE | Category name |
| created_at | timestamptz | NOT NULL, DEFAULT now() | Creation timestamp |
| updated_at | timestamptz | NOT NULL, DEFAULT now() | Last update |

**Default Categories:**
- Contract
- ID Scan
- Right to Work Document
- Performance Review
- Other

### employee_attachments
Metadata for employee file attachments.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| attachment_id | uuid | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique attachment identifier |
| employee_id | uuid | NOT NULL, REFERENCES employees(employee_id) ON DELETE CASCADE | Employee reference |
| category_id | uuid | NOT NULL, REFERENCES attachment_categories(category_id) | Category reference |
| file_name | text | NOT NULL | Original filename |
| storage_path | text | NOT NULL | Supabase Storage path |
| mime_type | text | NOT NULL | File MIME type |
| file_size_bytes | bigint | NOT NULL | File size in bytes |
| description | text | NULL | Optional description |
| uploaded_at | timestamptz | NOT NULL, DEFAULT now() | Upload timestamp |

**Indexes:**
- Primary key on `attachment_id`
- Index on `employee_id` for employee queries
- Index on `category_id` for category filtering

## Relationships

### Entity Relationship Diagram

```
customers ──┐
            ├──< bookings >──── events
            │
employees ──┼──< employee_notes
            │
            └──< employee_attachments >──── attachment_categories
```

### Cascade Rules
- Deleting a customer removes all their bookings
- Deleting an event removes all its bookings
- Deleting an employee removes all notes and attachments
- Attachment files in storage must be manually cleaned

## Row Level Security (RLS)

All tables have RLS enabled with the following policies:

### General Policy Pattern
```sql
-- Example for employees table
CREATE POLICY "Users can view employees" ON employees
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "Users can insert employees" ON employees
    FOR INSERT TO authenticated
    WITH CHECK (true);

CREATE POLICY "Users can update employees" ON employees
    FOR UPDATE TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Users can delete employees" ON employees
    FOR DELETE TO authenticated
    USING (true);
```

## Storage Schema

### Bucket: employee-attachments
- **Structure**: `/{employee_id}/{filename}`
- **Access**: Authenticated users only
- **Policies**: CRUD operations for authenticated users
- **Size Limit**: 10MB per file
- **Allowed Types**: PDF, PNG, JPG, JPEG

## Performance Indexes

Critical indexes for query optimization:

```sql
-- Event queries
CREATE INDEX idx_events_date ON events(date);
CREATE INDEX idx_bookings_event_id ON bookings(event_id);

-- Customer queries
CREATE INDEX idx_bookings_customer_id ON bookings(customer_id);

-- Employee queries
CREATE INDEX idx_employee_notes_employee_id ON employee_notes(employee_id);
CREATE INDEX idx_employee_attachments_employee_id ON employee_attachments(employee_id);

-- Composite indexes
CREATE INDEX idx_bookings_event_customer ON bookings(event_id, customer_id);
```

## Data Types and Constraints

### UUID Usage
All primary keys use UUID v4 for:
- Globally unique identifiers
- No sequential information leakage
- Better for distributed systems

### Timestamp Standards
- All timestamps use `timestamptz` (with timezone)
- Stored in UTC, displayed in local time
- Automatic defaults via `now()`

### Text Fields
- No arbitrary length limits
- Validation in application layer
- UTF-8 encoding throughout

## Migration Strategy

Database changes follow these principles:
1. Always create new migrations, never edit existing ones
2. Include both up and down migrations
3. Test in development before production
4. Use transactions for data integrity
5. Document breaking changes

## Backup and Recovery

### Automated Backups
- Daily backups by Supabase
- Point-in-time recovery available
- 7-day retention (free tier)

### Manual Backup Commands
```sql
-- Export schema
pg_dump --schema-only

-- Export data
pg_dump --data-only

-- Full backup
pg_dump --verbose
```