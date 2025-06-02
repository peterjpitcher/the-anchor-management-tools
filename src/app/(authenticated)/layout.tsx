'use client'

import { Navigation } from '@/components/Navigation'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline'
import { useRouter } from 'next/navigation'
import { BottomNavigation } from '@/components/BottomNavigation'
import Image from 'next/image';
import React, { useState } from 'react';
import AddNoteModal from '@/components/modals/AddNoteModal';

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const supabase = createClientComponentClient()
  const [isAddNoteModalOpen, setIsAddNoteModalOpen] = useState(false);

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const openAddNoteModal = () => setIsAddNoteModalOpen(true);
  const closeAddNoteModal = () => setIsAddNoteModalOpen(false);

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="flex h-screen overflow-hidden bg-white">
        {/* Sidebar */}
        <div className="hidden md:flex md:flex-shrink-0">
          <div className="flex w-64 flex-col">
            <div className="flex min-h-0 flex-1 flex-col border-r border-gray-300 bg-primary">
              <div className="flex flex-1 flex-col overflow-y-auto pt-5 pb-4">
                <div className="flex flex-col items-center px-4 space-y-2 mb-4">
                  <Image src="/logo.png" alt="Management Tools Logo" width={192} height={192} />
                  <h1 className="text-xl font-bold text-white text-center">The Anchor - Management Tools</h1>
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
          <main className="flex-1 overflow-y-auto bg-gray-50 p-6 md:p-6 p-3">
            {children}
          </main>
          <BottomNavigation onQuickAddNoteClick={openAddNoteModal} />
        </div>
      </div>
      <AddNoteModal isOpen={isAddNoteModalOpen} onClose={closeAddNoteModal} />
    </div>
  )
} 