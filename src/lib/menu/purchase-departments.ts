export const MENU_PURCHASE_DEPARTMENTS = ['kitchen', 'bar', 'other'] as const

export type MenuPurchaseDepartment = typeof MENU_PURCHASE_DEPARTMENTS[number]

export const MENU_PURCHASE_DEPARTMENT_LABELS: Record<MenuPurchaseDepartment, string> = {
  kitchen: 'Kitchen',
  bar: 'Bar',
  other: 'Other',
}

export function isMenuPurchaseDepartment(value: string | null | undefined): value is MenuPurchaseDepartment {
  return MENU_PURCHASE_DEPARTMENTS.includes(value as MenuPurchaseDepartment)
}

export function getMenuPurchaseDepartmentLabel(value: string | null | undefined): string {
  return isMenuPurchaseDepartment(value) ? MENU_PURCHASE_DEPARTMENT_LABELS[value] : MENU_PURCHASE_DEPARTMENT_LABELS.kitchen
}
