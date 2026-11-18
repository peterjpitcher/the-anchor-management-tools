import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { listMenuDishes, listMenusWithCategories } from '@/app/actions/menu-management'
import MenuManagementClient from './_components/MenuManagementClient'
import type { MenuSummary } from './dishes/_components/DishExpandedRow'

/**
 * The Menu Overview. Dishes and menus are read here on the server, side by side, so the page
 * arrives with its figures instead of fetching them after it appears. Each action still runs its
 * own permission check; this one only decides where a user without access is sent. Ingredients and
 * recipes are only needed by the dish drawer, so the client loads them when it first opens.
 */
export default async function MenuManagementPage(): Promise<React.ReactElement> {
  const canView = await checkUserPermission('menu_management', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  const [dishesResult, menusResult] = await Promise.all([
    listMenuDishes(),
    listMenusWithCategories(),
  ])

  if (menusResult.error) {
    console.error('Menu overview: failed to load menus:', menusResult.error)
  }

  return (
    <MenuManagementClient
      initialDishes={{
        data: (dishesResult.data ?? null) as Record<string, unknown>[] | null,
        target_gp_pct: typeof dishesResult.target_gp_pct === 'number' ? dishesResult.target_gp_pct : null,
        error: dishesResult.error ?? null,
      }}
      initialMenus={(menusResult.data ?? []) as MenuSummary[]}
    />
  )
}
