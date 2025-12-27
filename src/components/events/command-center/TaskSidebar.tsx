'use client'

import React, { useState, useOptimistic, useTransition } from 'react'
import { ChecklistTodoItem } from '@/lib/event-checklist'
import { ChevronRightIcon, ChevronLeftIcon, CheckIcon } from '@heroicons/react/24/outline'
import Link from 'next/link'
import { format } from 'date-fns'
import { toggleEventChecklistTask } from '@/app/actions/event-checklist'
import { toast } from '@/components/ui-v2/feedback/Toast'

interface TaskSidebarProps {
    todos: ChecklistTodoItem[]
    isOpen: boolean
    toggle: () => void
}

export default function TaskSidebar({ todos, isOpen, toggle }: TaskSidebarProps) {
    const [filterMode, setFilterMode] = useState<'urgent' | 'all'>('urgent')
    const [isPending, startTransition] = useTransition()

    // key for optimistic removal is combined eventId + taskKey
    const [optimisticTodos, removeOptimisticTodo] = useOptimistic(
        todos,
        (state, idToRemove: string) => state.filter(t => `${t.eventId}-${t.key}` !== idToRemove)
    )

    const handleToggleTask = async (e: React.MouseEvent, todo: ChecklistTodoItem) => {
        e.preventDefault() // Prevent link navigation if checking box
        e.stopPropagation()

        const id = `${todo.eventId}-${todo.key}`

        // Optimistically remove
        startTransition(async () => {
            removeOptimisticTodo(id)

            const result = await toggleEventChecklistTask(todo.eventId, todo.key, true)

            if (!result.success) {
                toast.error('Failed to update task')
                // In a real app, we might need to revert optimistic state here, 
                // but typically Next.js revalidates and fixes the list anyway.
            } else {
                toast.success('Task completed')
            }
        })
    }

    const urgentTodos = optimisticTodos.filter(t => t.status === 'overdue' || t.status === 'due_today')
    const displayTodos = filterMode === 'urgent' ? urgentTodos : optimisticTodos

    if (!isOpen) {
        return (
            <button
                onClick={toggle}
                className="fixed right-0 top-1/2 -translate-y-1/2 bg-white border border-l-gray-200 border-y-gray-200 p-2 rounded-l-md shadow-md hover:bg-gray-50 z-20"
                title="Show Tasks"
            >
                <ChevronLeftIcon className="w-5 h-5 text-gray-600" />
            </button>
        )
    }

    return (
        <div className="w-80 border-l border-gray-200 bg-white flex flex-col h-full sticky top-0 overflow-hidden shrink-0 transition-all duration-300">
            {/* Header */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                <h2 className="font-semibold text-gray-900">Tasks</h2>
                <button onClick={toggle} className="p-1 hover:bg-gray-200 rounded">
                    <ChevronRightIcon className="w-4 h-4 text-gray-500" />
                </button>
            </div>

            {/* Toggles */}
            <div className="p-3 border-b border-gray-100 flex gap-2">
                <button
                    onClick={() => setFilterMode('urgent')}
                    className={`flex-1 py-1 text-xs font-medium rounded-md ${filterMode === 'urgent' ? 'bg-red-50 text-red-700 border border-red-100' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                    Urgent ({urgentTodos.length})
                </button>
                <button
                    onClick={() => setFilterMode('all')}
                    className={`flex-1 py-1 text-xs font-medium rounded-md ${filterMode === 'all' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                    All
                </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {displayTodos.length === 0 ? (
                    <div className="text-center py-10 text-gray-400 text-sm">
                        {filterMode === 'urgent' ? 'No urgent tasks.' : 'No upcoming tasks.'}
                    </div>
                ) : (
                    displayTodos.map((todo) => (
                        <Link
                            key={`${todo.eventId}-${todo.key}`}
                            href={`/events/${todo.eventId}`}
                            className="block relative pl-4 border-l-2 border-gray-100 hover:border-black transition-colors group mb-4"
                        >
                            <div className="mb-0.5 flex items-start justify-between">
                                <span className={`text-[10px] uppercase font-bold tracking-wider 
                  ${todo.status === 'overdue' ? 'text-red-600' : todo.status === 'due_today' ? 'text-amber-600' : 'text-gray-400'}`}>
                                    {todo.status === 'overdue' ? 'Overdue' : todo.status === 'due_today' ? 'Due Today' : 'Upcoming'}
                                </span>
                                <span className="text-[10px] text-gray-400">{format(new Date(todo.dueDate), 'd MMM')}</span>
                            </div>

                            <div className="flex items-start gap-2">
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => handleToggleTask(e, todo)}
                                    className="mt-0.5 w-4 h-4 rounded border border-gray-300 hover:border-black hover:bg-gray-50 flex items-center justify-center transition-colors shrink-0 group/check"
                                >
                                    <CheckIcon className="w-3 h-3 text-black opacity-0 group-hover/check:opacity-100" />
                                </div>
                                <div>
                                    <h4 className="text-sm font-medium text-gray-800 group-hover:text-black leading-snug mb-1">
                                        {todo.label}
                                    </h4>
                                    <p className="text-xs text-gray-500 truncate">{todo.eventName}</p>
                                </div>
                            </div>
                        </Link>
                    ))
                )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-gray-100 bg-gray-50 text-xs text-center text-gray-400">
                Task Assistant
            </div>
        </div>
    )
}
