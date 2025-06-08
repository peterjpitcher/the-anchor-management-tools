'use client'

import { Navigation } from '@/components/Navigation'
import { ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline'
import { useRouter } from 'next/navigation'
import { BottomNavigation } from '@/components/BottomNavigation'
import Image from 'next/image'
import React, { useState, useEffect } from 'react'
import AddNoteModal from '@/components/modals/AddNoteModal'
import { redirect } from 'next/navigation'
import SupabaseProvider, { useSupabase } from '@/components/providers/SupabaseProvider'

function AuthenticatedLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const supabase = useSupabase()
  const [isAddNoteModalOpen, setIsAddNoteModalOpen] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        setUser(session.user)
      }
      setLoading(false)
    })

    async function getUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        setUser(user)
      }
      setLoading(false)
    }

    getUser()

    return () => {
      subscription.unsubscribe()
    }
  }, [supabase])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <p className="text-gray-500">Loading...</p>
      </div>
    )
  }

  if (!user) {
    redirect('/login')
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const openAddNoteModal = () => setIsAddNoteModalOpen(true)
  const closeAddNoteModal = () => setIsAddNoteModalOpen(false)

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="flex h-screen overflow-hidden bg-white">
        {/* Sidebar */}
        <div className="hidden md:flex md:flex-shrink-0">
          <div className="flex w-64 flex-col">
            <div className="flex min-h-0 flex-1 flex-col border-r border-gray-300 bg-sidebar">
              <div className="flex flex-1 flex-col overflow-y-auto pt-5 pb-4">
                <div className="flex flex-col items-center px-4 space-y-2 mb-4">
                  <Image src="/logo.png" alt="Management Tools Logo" width={192} height={192} />
                  <h1 className="text-xl font-bold text-white text-center">Management Tools</h1>
                </div>
                <div className="mt-5 flex-1">
                  <Navigation onQuickAddNoteClick={openAddNoteModal} />
                </div>
              </div>
              <div className="flex flex-shrink-0 border-t border-gray-200 p-4">
                <button
                  onClick={handleSignOut}
                  className="group flex w-full items-center px-2 py-2 text-sm font-medium text-white hover:bg-gray-700 hover:text-gray-100 rounded-md"
                >
                  <ArrowRightOnRectangleIcon
                    className="mr-3 h-6 w-6 text-gray-200 group-hover:text-gray-100"
                    aria-hidden="true"
                  />
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <main className="flex-1 overflow-y-auto bg-gray-50 p-6">
            {children}
          </main>
          <BottomNavigation onQuickAddNoteClick={openAddNoteModal} />
        </div>
      </div>
      <AddNoteModal isOpen={isAddNoteModalOpen} onClose={closeAddNoteModal} />
    </div>
  )
}

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <SupabaseProvider>
      <AuthenticatedLayoutContent>{children}</AuthenticatedLayoutContent>
    </SupabaseProvider>
  )
} 