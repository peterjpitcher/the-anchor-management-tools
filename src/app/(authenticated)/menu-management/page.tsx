import Link from 'next/link';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Section } from '@/components/ui-v2/layout/Section';
import { Card } from '@/components/ui-v2/layout/Card';
import { Badge } from '@/components/ui-v2/display/Badge';
import { listMenuDishes } from '@/app/actions/menu-management';

export const dynamic = 'force-dynamic';

const navigationCards = [
  {
    title: 'Ingredients',
    description: 'Manage ingredient packs, costs, allergens, and supplier details. Ingredient updates drive dish GP calculations.',
    href: '/menu-management/ingredients',
    badge: 'Costs',
  },
  {
    title: 'Recipes',
    description: 'Build prep recipes from ingredients once, then reuse them across multiple dishes for consistent costing.',
    href: '/menu-management/recipes',
    badge: 'Prep',
  },
  {
    title: 'Dishes',
    description: 'Build dishes from ingredients, set selling prices, and assign to menus with automatic GP% monitoring.',
    href: '/menu-management/dishes',
    badge: 'GP%',
  },
];

function formatGp(value: number | null | undefined) {
  if (typeof value !== 'number') {
    return '—';
  }
  return `${Math.round(value * 100)}%`;
}

export default async function MenuManagementHomePage() {
  const dishesResult = await listMenuDishes();
  const loadError = dishesResult.error ?? null;
  const dishes = loadError ? [] : Array.isArray(dishesResult.data) ? dishesResult.data : [];
  const standardTarget = typeof dishesResult.target_gp_pct === 'number' ? dishesResult.target_gp_pct : 0.7;

  const dishesWithoutIngredients = dishes
    .filter(dish => !dish.ingredients || dish.ingredients.length === 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const gpSorted = [...dishes].sort((a, b) => {
    const aGp = typeof a.gp_pct === 'number' ? a.gp_pct : Infinity;
    const bGp = typeof b.gp_pct === 'number' ? b.gp_pct : Infinity;
    return aGp - bGp;
  });

  return (
    <PageLayout
      title="Menu Management"
      subtitle="Control ingredients, dishes, and menu structure from one place"
      backButton={{ label: 'Back to Dashboard', href: '/' }}
    >
      <Section>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {navigationCards.map(card => (
            <Card key={card.title} className="p-6 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">{card.title}</h2>
                  <Badge variant="neutral">{card.badge}</Badge>
                </div>
                <p className="text-sm text-gray-600">{card.description}</p>
              </div>
              <div className="mt-6">
                <Link
                  href={card.href}
                  className="inline-flex items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-600 focus:ring-offset-2"
                >
                  Open {card.title}
                </Link>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        title="Menu Health"
        subtitle={`Track profitability and highlight data gaps without leaving this page. Standard target: ${Math.round(standardTarget * 100)}%.`}
      >
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2">
            {loadError ? (
              <Card className="p-4">
                <p className="text-sm text-red-600">
                  Unable to load GP% data right now. Please refresh the page or try again shortly.
                </p>
              </Card>
            ) : gpSorted.length === 0 ? (
              <Card className="p-4">
                <p className="text-sm text-gray-600">
                  No dishes found. Create a dish to start tracking GP%.
                </p>
              </Card>
            ) : (
              <Card className="p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Dish</th>
                        <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Price</th>
                        <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Portion Cost</th>
                        <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">GP%</th>
                        <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Target</th>
                        <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">GP Alert</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {gpSorted.map(dish => {
                        const gpValue = typeof dish.gp_pct === 'number' ? dish.gp_pct : null;
                        const targetValue = typeof dish.target_gp_pct === 'number' ? dish.target_gp_pct : standardTarget;
                        const belowTarget = gpValue !== null && gpValue < targetValue;

                        return (
                          <tr key={dish.id} className={belowTarget ? 'bg-red-50/60' : ''}>
                            <td className="px-4 py-2">
                              <div className="font-medium text-gray-900">{dish.name}</div>
                              {dish.assignments.length > 0 && (
                                <div className="text-xs text-gray-500">
                                  {dish.assignments
                                    .map((assign: { menu_code: string }) => assign.menu_code)
                                    .join(', ')}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-2 text-gray-700">£{dish.selling_price.toFixed(2)}</td>
                            <td className="px-4 py-2 text-gray-700">£{dish.portion_cost.toFixed(2)}</td>
                            <td className={`px-4 py-2 font-medium ${belowTarget ? 'text-red-600' : 'text-gray-900'}`}>
                              {formatGp(gpValue)}
                            </td>
                        <td className="px-4 py-2 text-gray-700">
                          {formatGp(targetValue)}
                        </td>
                            <td className="px-4 py-2">
                              {dish.is_gp_alert ? (
                                <Badge variant="error">Alert</Badge>
                              ) : (
                                <Badge variant="success">OK</Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
          <div>
            <Card className="p-4">
              <h3 className="font-semibold text-gray-900">Missing Ingredients</h3>
              <p className="mt-1 text-xs text-gray-500">
                Dishes listed here need ingredient portions before GP can be trusted.
              </p>
              <div className="mt-4 space-y-3">
                {loadError ? (
                  <p className="text-sm text-red-600">
                    Unable to load dishes right now.
                  </p>
                ) : dishesWithoutIngredients.length === 0 ? (
                  <p className="text-sm text-gray-600">
                    Great news! Every dish has at least one ingredient mapped.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {dishesWithoutIngredients.map(dish => (
                      <li key={dish.id} className="flex items-center justify-between">
                        <span className="text-sm text-gray-800">{dish.name}</span>
                        <Badge variant="warning" size="sm">
                          Fix
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>
        </div>
      </Section>
    </PageLayout>
  );
}
