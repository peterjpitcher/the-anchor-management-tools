'use client'

import { Navigation } from '@/components/Navigation'
import { ArrowRightOnRectangleIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useRouter, usePathname } from 'next/navigation'
import Image from 'next/image'
import React, { useState, useEffect } from 'react'
import AddNoteModal from '@/components/modals/AddNoteModal'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { PermissionProvider } from '@/contexts/PermissionContext'
import type { User } from '@supabase/supabase-js'
import { signOut as signOutAction } from '@/app/actions/auth'

function AuthenticatedLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const supabase = useSupabase()
  const [isAddNoteModalOpen, setIsAddNoteModalOpen] = useState(false)
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)

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

    // Add event listener for opening mobile menu from PageHeader
    const handleOpenMenu = () => {
      setIsMobileMenuOpen(true)
    }
    
    window.addEventListener('open-mobile-menu', handleOpenMenu)

    return () => {
      subscription.unsubscribe()
      window.removeEventListener('open-mobile-menu', handleOpenMenu)
    }
  }, [supabase])

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/auth/login')
    }
  }, [loading, user, router])

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <p className="text-gray-500">Loading...</p>
      </div>
    )
  }

  async function handleSignOut() {
    if (isSigningOut) {
      return
    }

    try {
      setIsSigningOut(true)
      const result = await signOutAction()

      if (result?.error) {
        console.error('Failed to record sign out via server action:', result.error)
      }
    } catch (error) {
      console.error('Server action sign out failed:', error)
    } finally {
      try {
        await supabase.auth.signOut()
      } catch (error) {
        console.error('Client sign out failed:', error)
      }

      router.replace('/auth/login')
      router.refresh()
      setIsSigningOut(false)
    }
  }

  const openAddNoteModal = () => setIsAddNoteModalOpen(true)
  const closeAddNoteModal = () => setIsAddNoteModalOpen(false)

  const isEventCheckIn = pathname?.match(/^\/events\/[^/]+\/check-in$/)

  if (isEventCheckIn) {
    return (
      <div className="min-h-screen text-white flex flex-col items-center" style={{ backgroundColor: '#105131' }}>
        <header className="w-full max-w-5xl px-6 pt-6 pb-4 flex flex-col items-center gap-2 text-center">
          <Image
            src="/logo.png"
            alt="The Anchor logo"
            width={160}
            height={160}
            priority
            className="w-32 sm:w-36 h-auto drop-shadow-lg"
          />
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-wide">Welcome to The Anchor!</h1>
          <p className="text-base sm:text-lg text-white/80 max-w-2xl">
            Please check in for the event today.
          </p>
        </header>
        <main className="w-full flex-1 flex flex-col items-center px-4 sm:px-6 pb-12">
          <div className="w-full max-w-4xl">
            {children}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="flex h-screen overflow-hidden bg-white">
        {/* Sidebar */}
        <div className="hidden md:flex md:flex-shrink-0">
          <div className="flex w-64 flex-col">
            <div className="flex min-h-0 flex-1 flex-col border-r border-gray-300 bg-sidebar">
              <div className="flex flex-1 flex-col overflow-y-auto pt-5 pb-4">
                <div className="px-4">
                  <div className="w-full mb-2">
                    <Image 
                      src="/logo.png" 
                      alt="Management Tools Logo" 
                      width={192}
                      height={192}
                      className="w-full h-auto"
                      priority 
                    />
                  </div>
                  <h1 className="text-xl font-bold text-white text-center w-full">Management Tools</h1>
                </div>
                <div className="mt-5 flex-1">
                  <Navigation onQuickAddNoteClick={openAddNoteModal} />
                </div>
              </div>
              <div className="flex flex-shrink-0 border-t border-green-600 p-4">
                <button
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="group flex w-full items-center px-2 py-2 text-sm font-medium text-gray-100 hover:bg-green-700 hover:text-white rounded-md"
                >
                  <ArrowRightOnRectangleIcon
                    className="mr-3 h-6 w-6 text-green-200 group-hover:text-white"
                    aria-hidden="true"
                  />
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile menu overlay */}
        {isMobileMenuOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="fixed inset-0 bg-gray-600 bg-opacity-75" onClick={() => setIsMobileMenuOpen(false)} />
            <div className="fixed inset-y-0 left-0 flex max-w-xs w-full bg-sidebar">
              <div className="flex w-full flex-col h-full">
                <div className="flex items-center justify-between h-16 px-4 border-b border-green-600 flex-shrink-0">
                  <h2 className="text-lg font-semibold text-white">Menu</h2>
                  <button
                    type="button"
                    className="rounded-md text-gray-300 hover:text-white focus:outline-none focus:ring-2 focus:ring-white"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <span className="sr-only">Close menu</span>
                    <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto py-4 min-h-0">
                  <Navigation 
                    onQuickAddNoteClick={() => {
                      openAddNoteModal()
                      setIsMobileMenuOpen(false)
                    }}
                    onNavigate={() => setIsMobileMenuOpen(false)}
                  />
                </div>
                <div className="flex flex-shrink-0 border-t border-green-600 p-4">
                  <button
                    onClick={() => {
                      handleSignOut()
                      setIsMobileMenuOpen(false)
                    }}
                    disabled={isSigningOut}
                    className="group flex w-full items-center px-2 py-2 text-sm font-medium text-gray-100 hover:bg-green-700 hover:text-white rounded-md"
                  >
                    <ArrowRightOnRectangleIcon
                      className="mr-3 h-6 w-6 text-green-200 group-hover:text-white"
                      aria-hidden="true"
                    />
                    Sign out
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <main className="flex-1 overflow-y-auto bg-gray-50 pb-6 px-2 sm:px-4 md:px-6 py-2 sm:py-4">
            {children}
          </main>
        </div>
      </div>
      <AddNoteModal isOpen={isAddNoteModalOpen} onClose={closeAddNoteModal} />
    </div>
  )
}

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <PermissionProvider>
      <AuthenticatedLayoutContent>{children}</AuthenticatedLayoutContent>
    </PermissionProvider>
  )
} 
