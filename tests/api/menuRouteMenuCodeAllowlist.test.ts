import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auth')>('@/lib/api/auth')
  return {
    ...actual,
    withApiAuth: vi.fn(
      async (
        handler: (request: Request, apiKey: unknown) => Promise<Response>,
        _requiredPermissions: string[],
        request?: Request
      ) => handler(request || new Request('http://localhost/api/menu'), { id: 'test-key' }),
    ),
  }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { GET } from '@/app/api/menu/route'

// The allowlist is module-private in the route (Next.js forbids extra exports
// from route files), so it is asserted through behaviour rather than imported.
const EXPECTED_ALLOWLIST = ['website_food', 'sunday_lunch', 'christmas', 'drinks']

const TODAY = getTodayIsoDate()

function shiftIsoDate(isoDate: string, days: number): string {
  const shifted = new Date(`${isoDate}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

type MenuRow = { id: string; name: string }

const menusByCode: Record<string, MenuRow> = {
  website_food: { id: 'menu-website-food', name: 'Website Food Menu' },
  christmas: { id: 'menu-christmas', name: 'Christmas Menu' },
}

/** Records which menu code each table was filtered by, so the test can assert propagation. */
let requestedMenuCodes: string[] = []
let requestedMenuIds: string[] = []

function buildAdminClient() {
  return {
    from(table: string) {
      if (table === 'menu_menus') {
        const builder: any = {
          select: () => builder,
          eq: (_column: string, value: string) => {
            requestedMenuCodes.push(value)
            return builder
          },
          single: async () => {
            const code = requestedMenuCodes[requestedMenuCodes.length - 1]
            const menu = menusByCode[code]
            return menu ? { data: menu, error: null } : { data: null, error: { message: 'not found' } }
          },
        }
        return builder
      }

      if (table === 'menu_category_menus') {
        const builder: any = {
          select: () => builder,
          eq: (_column: string, value: string) => {
            requestedMenuIds.push(value)
            return builder
          },
          order: async () => ({
            data: [
              {
                sort_order: 10,
                category: {
                  id: 'cat-1',
                  code: 'christmas_one_course_adult',
                  name: 'Christmas 1 Course (Adults)',
                  description: 'Adult single course',
                },
              },
            ],
            error: null,
          }),
        }
        return builder
      }

      if (table === 'menu_dishes_with_costs') {
        const orderable: any = {
          order: () => orderable,
          then: undefined,
        }
        // The route awaits the final .order(), so make the chain thenable.
        const result = {
          data: [
            {
              dish_id: 'dish-1',
              name: 'Priced dish',
              description: 'Has a price',
              selling_price: '23.00',
              category_code: 'christmas_one_course_adult',
              is_active: true,
              is_special: false,
              sort_order: 1,
              dietary_flags: [],
              allergen_flags: [],
              available_from: null,
              available_until: null,
            },
            {
              dish_id: 'dish-2',
              name: 'Unpriced dish',
              description: 'Awaiting costing',
              selling_price: null,
              category_code: 'christmas_one_course_adult',
              is_active: true,
              is_special: false,
              sort_order: 2,
              dietary_flags: [],
              allergen_flags: [],
              available_from: null,
              available_until: null,
            },
            {
              dish_id: 'dish-3',
              name: 'Last day today',
              description: 'Final day of its window',
              selling_price: '25.00',
              category_code: 'christmas_one_course_adult',
              is_active: true,
              is_special: false,
              sort_order: 3,
              dietary_flags: [],
              allergen_flags: [],
              available_from: shiftIsoDate(TODAY, -30),
              available_until: TODAY,
            },
            {
              dish_id: 'dish-4',
              name: 'Window closed yesterday',
              description: 'Should be filtered out',
              selling_price: '25.00',
              category_code: 'christmas_one_course_adult',
              is_active: true,
              is_special: false,
              sort_order: 4,
              dietary_flags: [],
              allergen_flags: [],
              available_from: shiftIsoDate(TODAY, -30),
              available_until: shiftIsoDate(TODAY, -1),
            },
            {
              dish_id: 'dish-5',
              name: 'Window opens tomorrow',
              description: 'Should be filtered out',
              selling_price: '25.00',
              category_code: 'christmas_one_course_adult',
              is_active: true,
              is_special: false,
              sort_order: 5,
              dietary_flags: [],
              allergen_flags: [],
              available_from: shiftIsoDate(TODAY, 1),
              available_until: shiftIsoDate(TODAY, 40),
            },
          ],
          error: null,
        }
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
        }
        void orderable
        return builder
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

async function readJson(response: Response) {
  return response.json() as Promise<any>
}

beforeEach(() => {
  requestedMenuCodes = []
  requestedMenuIds = []
  vi.mocked(createAdminClient).mockReturnValue(buildAdminClient() as any)
})

describe('GET /api/menu menu code allowlist', () => {
  it('defaults to website_food when no menu parameter is supplied', async () => {
    const response = await GET(new Request('http://localhost/api/menu') as any)

    expect(response.status).toBe(200)
    expect(requestedMenuCodes[0]).toBe('website_food')

    const body = await readJson(response)
    expect(body.success).toBe(true)
    expect(body.data.menu_code).toBe('website_food')
    expect(body.data.menu.name).toBe('Website Food Menu')
  })

  it('defaults to website_food when the menu parameter is empty', async () => {
    const response = await GET(new Request('http://localhost/api/menu?menu=') as any)

    expect(response.status).toBe(200)
    expect(requestedMenuCodes[0]).toBe('website_food')
  })

  it('accepts menu=christmas and resolves that menu', async () => {
    const response = await GET(new Request('http://localhost/api/menu?menu=christmas') as any)

    expect(response.status).toBe(200)
    expect(requestedMenuCodes[0]).toBe('christmas')
    expect(requestedMenuIds[0]).toBe('menu-christmas')

    const body = await readJson(response)
    expect(body.data.menu_code).toBe('christmas')
    expect(body.data.menu_name).toBe('Christmas Menu')
    // JSON-LD must be labelled with the Christmas menu, not the food menu.
    expect(body.data.menu.name).toBe('Christmas Menu')
    expect(body.data.sections).toHaveLength(1)
  })

  it('rejects an unknown menu code with a 400 and never queries the database', async () => {
    const response = await GET(new Request('http://localhost/api/menu?menu=secret_internal') as any)

    expect(response.status).toBe(400)
    expect(requestedMenuCodes).toHaveLength(0)

    const body = await readJson(response)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.message).toContain('christmas')
  })

  it('passes every allowlisted code straight through to the menu lookup', async () => {
    for (const code of EXPECTED_ALLOWLIST) {
      requestedMenuCodes = []
      await GET(new Request(`http://localhost/api/menu?menu=${code}`) as any)
      expect(requestedMenuCodes[0]).toBe(code)
    }
  })

  it('normalises case and surrounding whitespace on the menu parameter', async () => {
    const response = await GET(new Request('http://localhost/api/menu?menu=%20Christmas%20') as any)

    expect(response.status).toBe(200)
    expect(requestedMenuCodes[0]).toBe('christmas')
  })

  it('returns 404 for an allowlisted code that has no menu row', async () => {
    // sunday_lunch is allowlisted but absent from this test fixture.
    const response = await GET(new Request('http://localhost/api/menu?menu=sunday_lunch') as any)

    expect(response.status).toBe(404)
    const body = await readJson(response)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('omits the Offer entirely for a dish with no price', async () => {
    const response = await GET(new Request('http://localhost/api/menu?menu=christmas') as any)
    const body = await readJson(response)

    const items = body.data.menu.hasMenuSection[0].hasMenuItem
    const priced = items.find((item: any) => item.name === 'Priced dish')
    const unpriced = items.find((item: any) => item.name === 'Unpriced dish')

    expect(priced.offers.price).toBe('23')
    expect(priced.offers.priceCurrency).toBe('GBP')
    expect(unpriced.offers).toBeUndefined()

    // The raw section payload keeps null rather than advertising a free dish.
    expect(body.data.sections[0].items[1].price).toBeNull()
  })

  it('treats the availability window as whole-day inclusive at both ends', async () => {
    const response = await GET(new Request('http://localhost/api/menu?menu=christmas') as any)
    const body = await readJson(response)

    const names = body.data.sections[0].items.map((item: any) => item.name)

    // A dish whose final day is today must still be served on that day.
    expect(names).toContain('Last day today')
    expect(names).not.toContain('Window closed yesterday')
    expect(names).not.toContain('Window opens tomorrow')
  })
})
