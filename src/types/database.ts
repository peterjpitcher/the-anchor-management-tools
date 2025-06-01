export interface Event {
  id: string;
  name: string;
  date: string;
  time: string;
  capacity: number | null;
  created_at: string;
}

export interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  mobile_number: string;
  created_at: string;
}

export interface Booking {
  id: string;
  customer_id: string;
  event_id: string;
  seats: number | null;
  notes: string | null;
  created_at: string;
  // Join fields
  customer?: Customer;
  event?: Event;
}

export interface Employee {
  employee_id: string; // UUID
  first_name: string;
  last_name: string;
  date_of_birth?: string | null; // Date
  address?: string | null;
  phone_number?: string | null;
  email_address: string;
  job_title: string;
  employment_start_date: string; // Date
  employment_end_date?: string | null; // Date
  status: string; // e.g., 'Active', 'Former'
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  created_at: string; // Timestamp
  updated_at: string; // Timestamp
}

export interface EmployeeNote {
  note_id: string; // UUID
  employee_id: string; // UUID, Foreign Key to Employee
  note_text: string;
  created_at: string; // Timestamp
  created_by?: string | null; // UUID, Foreign Key to auth.users (optional)
}

export interface AttachmentCategory {
  category_id: string; // UUID
  category_name: string;
  created_at: string; // Timestamp
  updated_at: string; // Timestamp
}

export interface EmployeeAttachment {
  attachment_id: string; // UUID
  employee_id: string; // UUID, Foreign Key to Employee
  category_id: string; // UUID, Foreign Key to AttachmentCategory
  file_name: string;
  storage_path: string;
  mime_type: string;
  file_size_bytes: number; // Supabase uses bigint, which is string in JS, but number is often fine for client
  description?: string | null;
  uploaded_at: string; // Timestamp
}

export interface Database {
  public: {
    Tables: {
      events: {
        Row: Event;
        Insert: Omit<Event, 'id' | 'created_at'>;
        Update: Partial<Omit<Event, 'id' | 'created_at'>>;
      };
      customers: {
        Row: Customer;
        Insert: Omit<Customer, 'id' | 'created_at'>;
        Update: Partial<Omit<Customer, 'id' | 'created_at'>>;
      };
      bookings: {
        Row: Booking;
        Insert: Omit<Booking, 'id' | 'created_at'>;
        Update: Partial<Omit<Booking, 'id' | 'created_at'>>;
      };
      employees: {
        Row: Employee;
        Insert: Omit<Employee, 'employee_id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Employee, 'employee_id' | 'created_at' | 'updated_at'>>;
      };
      employee_notes: {
        Row: EmployeeNote;
        Insert: Omit<EmployeeNote, 'note_id' | 'created_at'>;
        Update: Partial<Omit<EmployeeNote, 'note_id' | 'created_at' | 'employee_id'>>;
      };
      attachment_categories: {
        Row: AttachmentCategory;
        Insert: Omit<AttachmentCategory, 'category_id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<AttachmentCategory, 'category_id' | 'created_at' | 'updated_at' | 'category_name'>>;
      };
      employee_attachments: {
        Row: EmployeeAttachment;
        Insert: Omit<EmployeeAttachment, 'attachment_id' | 'uploaded_at'>;
        Update: Partial<Omit<EmployeeAttachment, 'attachment_id' | 'uploaded_at' | 'employee_id'>>;
      };
    };
  };
} 