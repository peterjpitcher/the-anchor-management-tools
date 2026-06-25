'use client'

import { usePathname, useRouter } from 'next/navigation'
import React, { useState, useEffect, useMemo } from 'react'
import AddNoteModal from '@/components/modals/AddNoteModal'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { PermissionProvider } from '@/contexts/PermissionContext'
import type { User } from '@supabase/supabase-js'
import { signOut as signOutAction } from '@/app/actions/auth'
import type { UserPermission } from '@/types/rbac'
import { usePermissions } from '@/contexts/PermissionContext'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import { AppShell } from '@/ds/shell'

function AuthenticatedLayoutContent({
  children,
  userRoleLabel,
}: {
  children: React.ReactNode
  userRoleLabel: string
}) {
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  const supabase = useSupabase()
  const { permissions, loading: permissionsLoading } = usePermissions()
  const [isAddNoteModalOpen, setIsAddNoteModalOpen] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [fohEmployeeId, setFohEmployeeId] = useState<string | undefined>(undefined)
  const fohOnlyMode = useMemo(() => {
    if (permissionsLoading) return false
    return isFohOnlyUser(permissions)
  }, [permissions, permissionsLoading])
  const isFohPath = pathname.startsWith('/table-bookings/foh')

  useEffect(() => {
    let mounted = true

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return

      if (session?.user) {
        setUser(session.user)
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
        router.replace('/auth/login')
      }
    })

    async function getUser() {
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser()

        if (mounted) {
          if (error) {
            console.error('Auth check error:', error)
            setUser(null)
          } else if (user) {
            setUser(user)
          }
          setLoading(false)
        }
      } catch (error) {
        console.error('Auth check failed:', error)
        if (mounted) {
          setUser(null)
          setLoading(false)
        }
      }
    }

    getUser()

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [supabase, router])

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/auth/login')
    }
  }, [loading, user, router])

  useEffect(() => {
    if (loading || !user || permissionsLoading || !fohOnlyMode) {
      return
    }

    if (!isFohPath) {
      router.replace('/table-bookings/foh')
    }
  }, [loading, user, permissionsLoading, fohOnlyMode, isFohPath, router])

  // Resolve employee ID for FOH users (needed for clock-in band)
  useEffect(() => {
    if (!fohOnlyMode || !user?.email) return
    let cancelled = false

    async function fetchEmployeeId() {
      const { data } = await supabase
        .from('employees')
        .select('employee_id')
        .eq('email_address', user!.email!)
        .single()
      if (!cancelled && data?.employee_id) {
        setFohEmployeeId(data.employee_id)
      }
    }

    fetchEmployeeId()
    return () => { cancelled = true }
  }, [fohOnlyMode, user, supabase])

if (loading || !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <p className="text-gray-500">Loading...</p>
      </div>
    )
  }

  if (!permissionsLoading && fohOnlyMode && !isFohPath) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <p className="text-gray-500">Redirecting to Front of House...</p>
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

      if ('error' in result && result.error) {
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

  return (
    <>
      <AppShell
        showSidebar={!fohOnlyMode}
        fohMode={fohOnlyMode}
        fohEmployeeId={fohEmployeeId}
        userName={user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? 'User'}
        userRole={userRoleLabel}
        onSignOut={handleSignOut}
        isSigningOut={isSigningOut}
      >
        {children}
      </AppShell>
      <AddNoteModal isOpen={isAddNoteModalOpen} onClose={closeAddNoteModal} />
    </>
  )
}

export default function AuthenticatedLayout({
  children,
  initialPermissions,
  userRoleLabel = 'Staff'
}: {
  children: React.ReactNode;
  initialPermissions?: UserPermission[];
  userRoleLabel?: string;
}) {
  return (
    <PermissionProvider initialPermissions={initialPermissions}>
      <AuthenticatedLayoutContent userRoleLabel={userRoleLabel}>{children}</AuthenticatedLayoutContent>
    </PermissionProvider>
  )
}
