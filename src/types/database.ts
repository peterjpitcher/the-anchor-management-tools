export interface Event {
  id: string;
  name: string;
  date: string;
  time: string;
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
  created_at: string;
  // Join fields
  customer?: Customer;
  event?: Event;
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
    };
  };
} 