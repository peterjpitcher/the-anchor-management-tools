'use client'

import { createClient } from '@/lib/supabase/client'
import { createContext, useContext } from 'react'

type SupabaseContext = {
  supabase: ReturnType<typeof createClient>
}

const Context = createContext<SupabaseContext | undefined>(undefined)

// Create the client once, outside of the component
const supabase = createClient();

export default function SupabaseProvider({ children }: { children: React.ReactNode }) {
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
