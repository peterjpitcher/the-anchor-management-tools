'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { 
  UsersIcon, 
  DocumentIcon,
  ChatBubbleBottomCenterTextIcon,
  PaperClipIcon,
  ClockIcon
} from '@heroicons/react/24/outline'
import Link from 'next/link'
import { formatDate } from '@/lib/dateUtils'

interface EmployeeActivityStats {
  totalEmployees: number
  activeEmployees: number
  recentNotes: {
    employeeName: string
    employeeId: string
    notePreview: string
    createdAt: string
    createdBy: string
  }[]
  recentDocuments: {
    employeeName: string
    employeeId: string
    fileName: string
    category: string
    uploadedAt: string
  }[]
  documentStats: {
    totalDocuments: number
    byCategory: {
      category: string
      badge: number
    }[]
  }
  notesThisWeek: number
  documentsThisWeek: number
}

export function EmployeeActivityWidget() {
  const supabase = useSupabase()
  const [stats, setStats] = useState<EmployeeActivityStats>({
    totalEmployees: 0,
    activeEmployees: 0,
    recentNotes: [],
    recentDocuments: [],
    documentStats: {
      totalDocuments: 0,
      byCategory: []
    },
    notesThisWeek: 0,
    documentsThisWeek: 0
  })
  const [isLoading, setIsLoading] = useState(true)

  const loadEmployeeActivity = useCallback(async () => {
    try {
      setIsLoading(true)

      // Get employee counts
      const { data: employees, error: employeesError } = await supabase
        .from('employees')
        .select('employee_id, first_name, last_name, status')

      if (employeesError) throw employeesError

      // Get recent notes
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)

      const { data: notes, error: notesError } = await supabase
        .from('employee_notes')
        .select(`
          note_id,
          note_text,
          created_at,
          created_by_user_id,
          employee_id
        `)
        .order('created_at', { ascending: false })
        .limit(5)

      if (notesError) throw notesError

      // Get recent attachments
      const { data: attachments, error: attachmentsError } = await supabase
        .from('employee_attachments')
        .select('*')
        .order('uploaded_at', { ascending: false })
        .limit(5)

      if (attachmentsError) throw attachmentsError

      // Get all attachments for stats
      const { data: allAttachments, error: allAttachmentsError } = await supabase
        .from('employee_attachments')
        .select('category_id, uploaded_at')

      if (allAttachmentsError) throw allAttachmentsError

      // Count documents by category
      const categoryStats = allAttachments?.reduce((acc, doc) => {
        const category = doc.category_id || 'other'
        acc[category] = (acc[category] || 0) + 1
        return acc
      }, {} as Record<string, number>) || {}

      // Count this week's activity
      const notesThisWeek = notes?.filter(n => 
        new Date(n.created_at) >= weekAgo
      ).length || 0

      const documentsThisWeek = allAttachments?.filter(d => 
        new Date(d.uploaded_at) >= weekAgo
      ).length || 0

      // Format recent notes
      const formattedNotes = notes?.map(note => {
        const employee = employees?.find(e => e.employee_id === note.employee_id)
        return {
          employeeName: employee ? `${employee.first_name} ${employee.last_name}` : 'Unknown',
          employeeId: note.employee_id,
          notePreview: note.note_text.substring(0, 100) + (note.note_text.length > 100 ? '...' : ''),
          createdAt: note.created_at,
          createdBy: note.created_by_user_id || 'System'
        }
      }) || []

      // Format recent documents
      const formattedDocuments = attachments?.map(doc => {
        const employee = employees?.find(e => e.employee_id === doc.employee_id)
        return {
          employeeName: employee ? `${employee.first_name} ${employee.last_name}` : 'Unknown',
          employeeId: doc.employee_id,
          fileName: doc.file_name,
          category: doc.category_id || 'other',
          uploadedAt: doc.uploaded_at
        }
      }) || []

      setStats({
        totalEmployees: employees?.length || 0,
        activeEmployees: employees?.filter(e => e.status === 'Active').length || 0,
        recentNotes: formattedNotes,
        recentDocuments: formattedDocuments,
        documentStats: {
          totalDocuments: allAttachments?.length || 0,
          byCategory: Object.entries(categoryStats).map(([category, count]) => ({
            category,
            badge: count as number
          }))
        },
        notesThisWeek,
        documentsThisWeek
      })
    } catch (error) {
      console.error('Error loading employee activity:', error)
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    loadEmployeeActivity()
  }, [loadEmployeeActivity])

  if (isLoading) {
    return (
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-1/3 mb-4"></div>
            <div className="space-y-3">
              <div className="h-3 bg-gray-200 rounded"></div>
              <div className="h-3 bg-gray-200 rounded"></div>
              <div className="h-3 bg-gray-200 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const formatCategoryName = (category: string) => {
    return category.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ')
  }

  return (
    <div className="bg-white shadow rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg leading-6 font-medium text-gray-900 flex items-center">
            <UsersIcon className="h-5 w-5 text-purple-600 mr-2" />
            Employee Activity
          </h3>
          <Link
            href="/employees"
            className="text-sm text-indigo-600 hover:text-indigo-500"
          >
            View All
          </Link>
        </div>

        {/* Activity Summary */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-purple-50 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center mb-1">
              <ChatBubbleBottomCenterTextIcon className="h-5 w-5 text-purple-600 mr-1" />
              <p className="text-2xl font-semibold text-purple-900">{stats.notesThisWeek}</p>
            </div>
            <p className="text-xs text-purple-700">Notes this week</p>
          </div>
          <div className="bg-indigo-50 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center mb-1">
              <DocumentIcon className="h-5 w-5 text-indigo-600 mr-1" />
              <p className="text-2xl font-semibold text-indigo-900">{stats.documentsThisWeek}</p>
            </div>
            <p className="text-xs text-indigo-700">Documents this week</p>
          </div>
        </div>

        {/* Recent Notes */}
        {stats.recentNotes.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center">
              <ChatBubbleBottomCenterTextIcon className="h-4 w-4 text-gray-400 mr-1" />
              Recent Notes
            </h4>
            <div className="space-y-2">
              {stats.recentNotes.slice(0, 3).map((note, index) => (
                <div key={index} className="text-sm">
                  <Link
                    href={`/employees/${note.employeeId}`}
                    className="font-medium text-gray-900 hover:text-indigo-600"
                  >
                    {note.employeeName}
                  </Link>
                  <p className="text-gray-600 text-xs mt-0.5 line-clamp-1">
                    {note.notePreview}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    <ClockIcon className="h-3 w-3 inline mr-1" />
                    {formatDate(note.createdAt)} by {note.createdBy}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Documents */}
        {stats.recentDocuments.length > 0 && (
          <div className="mb-4 pt-4 border-t border-gray-200">
            <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center">
              <PaperClipIcon className="h-4 w-4 text-gray-400 mr-1" />
              Recent Documents
            </h4>
            <div className="space-y-2">
              {stats.recentDocuments.slice(0, 3).map((doc, index) => (
                <div key={index} className="flex items-center justify-between text-sm">
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/employees/${doc.employeeId}`}
                      className="font-medium text-gray-900 hover:text-indigo-600"
                    >
                      {doc.employeeName}
                    </Link>
                    <p className="text-xs text-gray-600 truncate">
                      {doc.fileName}
                    </p>
                  </div>
                  <span className="ml-2 text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                    {formatCategoryName(doc.category)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Document Stats */}
        {stats.documentStats.totalDocuments > 0 && (
          <div className="pt-4 border-t border-gray-200">
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-sm font-medium text-gray-700">Document Library</h4>
              <span className="text-sm font-semibold text-gray-900">
                {stats.documentStats.totalDocuments} total
              </span>
            </div>
            <div className="space-y-1">
              {stats.documentStats.byCategory.map((cat, index) => (
                <div key={index} className="flex justify-between text-xs">
                  <span className="text-gray-600">{formatCategoryName(cat.category)}</span>
                  <span className="text-gray-900 font-medium">{cat.badge}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {stats.totalEmployees === 0 && (
          <div className="text-center py-4">
            <UsersIcon className="mx-auto h-8 w-8 text-gray-400" />
            <p className="mt-2 text-sm text-gray-500">No employee data available</p>
            <Link
              href="/employees"
              className="mt-2 text-sm text-indigo-600 hover:text-indigo-500"
            >
              Add your first employee
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}