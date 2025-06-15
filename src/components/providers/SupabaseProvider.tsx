'use client'

import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { createContext, useContext, useState } from 'react'

import type { SupabaseClient } from '@supabase/auth-helpers-nextjs'
import type { Database } from '@/types/database'

type SupabaseContext = {
  supabase: SupabaseClient<Database>
}

const Context = createContext<SupabaseContext | undefined>(undefined)

// Create the client once, outside of the component
const supabase = createClientComponentClient();

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