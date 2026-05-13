import { NextRequest, NextResponse } from 'next/server'

import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { generateIngredientAllergenReportHTML, type IngredientAllergenReportRow } from '@/lib/menu/allergen-report'
import { isMenuPurchaseDepartment, type MenuPurchaseDepartment } from '@/lib/menu/purchase-departments'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const INGREDIENT_ALLERGEN_SELECT_WITH_DEPARTMENT = 'id, name, brand, supplier_name, supplier_sku, purchase_department, allergens, is_active'
const INGREDIENT_ALLERGEN_SELECT_WITHOUT_DEPARTMENT = 'id, name, brand, supplier_name, supplier_sku, allergens, is_active'

function isMissingPurchaseDepartmentColumn(error: { code?: string; message?: string } | null): boolean {
  return error?.code === '42703' && /purchase_department/i.test(error.message ?? '')
}

function getLondonDateSlug(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).formatToParts(date)

  const partMap = new Map(parts.map((part) => [part.type, part.value]))
  return `${partMap.get('year')}-${partMap.get('month')}-${partMap.get('day')}`
}

async function logReportExport(
  userId: string,
  userEmail: string | undefined,
  rowCount: number,
  department: MenuPurchaseDepartment | 'all'
): Promise<void> {
  try {
    await logAuditEvent({
      user_id: userId,
      ...(userEmail && { user_email: userEmail }),
      operation_type: 'export',
      resource_type: 'menu_ingredient_allergens',
      operation_status: 'success',
      additional_info: {
        format: 'pdf',
        department,
        row_count: rowCount,
      },
    })
  } catch (error) {
    console.warn('Failed to write ingredient allergen PDF audit log:', error)
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const hasPermission = await checkUserPermission('menu_management', 'view', user.id)
  if (!hasPermission) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }

  const departmentParam = request.nextUrl.searchParams.get('department')
  if (departmentParam && !isMenuPurchaseDepartment(departmentParam)) {
    return NextResponse.json({ error: 'Invalid department' }, { status: 400 })
  }
  const department: MenuPurchaseDepartment | 'all' = departmentParam && isMenuPurchaseDepartment(departmentParam)
    ? departmentParam
    : 'all'

  let query = supabase
    .from('menu_ingredients_with_prices')
    .select(INGREDIENT_ALLERGEN_SELECT_WITH_DEPARTMENT)
    .order('name', { ascending: true })

  if (department !== 'all') {
    query = query.eq('purchase_department', department)
  }

  const ingredientsResult = await query
  let data = ingredientsResult.data as IngredientAllergenReportRow[] | null
  let error = ingredientsResult.error

  if (isMissingPurchaseDepartmentColumn(error)) {
    if (department !== 'all') {
      return NextResponse.json(
        { error: 'Ingredient purchase departments are not available until the database migration is applied.' },
        { status: 409 }
      )
    }

    const fallback = await supabase
      .from('menu_ingredients_with_prices')
      .select(INGREDIENT_ALLERGEN_SELECT_WITHOUT_DEPARTMENT)
      .order('name', { ascending: true })

    data = fallback.data as IngredientAllergenReportRow[] | null
    error = fallback.error
  }

  if (error) {
    console.error('Failed to fetch ingredients for allergen PDF:', error)
    return NextResponse.json({ error: 'Failed to fetch ingredient allergens' }, { status: 500 })
  }

  try {
    const now = new Date()
    const ingredients = (data ?? []) as IngredientAllergenReportRow[]
    const html = generateIngredientAllergenReportHTML({
      ingredients,
      generatedAt: now,
      department,
    })
    const pdfBuffer = await generatePDFFromHTML(html, {
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '8mm',
        right: '8mm',
        bottom: '8mm',
        left: '8mm',
      },
    })

    await logReportExport(user.id, user.email, ingredients.length, department)

    const disposition = request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'
    const filename = `ingredient-allergens-${department}-${getLondonDateSlug(now)}.pdf`

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Failed to generate ingredient allergen PDF:', error)
    return NextResponse.json({ error: 'Failed to generate ingredient allergen PDF' }, { status: 500 })
  }
}
