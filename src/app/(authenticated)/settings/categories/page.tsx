import CategoriesClient from './CategoriesClient'
import { listAttachmentCategories } from '@/app/actions/attachmentCategories'
import { checkUserPermission } from '@/app/actions/rbac'
import { redirect } from 'next/navigation'

export default async function CategoriesPage() {
  const canManage = await checkUserPermission('settings', 'manage')
  if (!canManage) {
    redirect('/unauthorized')
  }

  const listResult = await listAttachmentCategories()
  const categories = listResult.categories ?? []
  const error = listResult.error ?? null

  return (
    <CategoriesClient
      initialCategories={categories}
      canManage={canManage}
      initialError={error}
    />
  )
}
