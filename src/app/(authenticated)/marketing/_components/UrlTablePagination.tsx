'use client'

import { useRouter } from 'next/navigation'
import { TablePagination } from '@/ds'

export interface UrlTablePaginationProps {
  /** The page the server rendered, counting from 1. */
  page: number
  totalPages: number
  totalItems: number
  pageSize: number
  /** The list's path, such as /marketing. */
  path: string
  /** The filters in force, kept on every page so paging never drops a search. */
  query: Record<string, string>
}

/**
 * The DS pager for a server-rendered list whose page lives in the URL (`?page=`). Changing page
 * navigates to the same filters with the new page number, and the server renders it.
 */
export function UrlTablePagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  path,
  query,
}: UrlTablePaginationProps): React.JSX.Element {
  const router = useRouter()

  return (
    <TablePagination
      page={page}
      totalPages={totalPages}
      totalItems={totalItems}
      pageSize={pageSize}
      onPageChange={(nextPage) => {
        const params = new URLSearchParams(query)
        params.set('page', String(nextPage))
        router.push(`${path}?${params.toString()}`)
      }}
    />
  )
}
