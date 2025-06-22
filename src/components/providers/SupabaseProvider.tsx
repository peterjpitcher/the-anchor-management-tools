'use client'

import { createClient } from '@/lib/supabase/client'
import { createContext, useContext, useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type SupabaseContext = {
  supabase: SupabaseClient<Database>
}

const Context = createContext<SupabaseContext | undefined>(undefined)

// Create the client once, outside of the component
const supabase = createClient();

export default function SupabaseProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Set up auth state listener for Sentry user context
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        // Set user context in Sentry
        Sentry.setUser({
          id: session.user.id,
          email: session.user.email,
        });
      } else {
        // Clear user context on logout
        Sentry.setUser(null);
      }
    });

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        Sentry.setUser({
          id: session.user.id,
          email: session.user.email,
        });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <Context.Provider value={{ supabase }}>
      <>{children}</>
    </Context.Provider>
  )
}

export const useSupabase = () => {
  const context = useContext(Context)

  if (context === undefined) {
    throw new Error('useSupabase must be used inside SupabaseProvider')
  }

  return context.supabase
} 