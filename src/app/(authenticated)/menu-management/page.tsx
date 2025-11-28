import Link from 'next/link';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Section } from '@/components/ui-v2/layout/Section';
import { Card } from '@/components/ui-v2/layout/Card';
import { Badge } from '@/components/ui-v2/display/Badge';
import { listMenuDishes } from '@/app/actions/menu-management';
import { MenuDishesTable } from './_components/MenuDishesTable';

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

export default async function MenuManagementHomePage() {
  const dishesResult = await listMenuDishes();
  const loadError = dishesResult.error ?? null;
  const dishes = loadError ? [] : Array.isArray(dishesResult.data) ? dishesResult.data : [];
  const standardTarget = typeof dishesResult.target_gp_pct === 'number' ? dishesResult.target_gp_pct : 0.7;

  return (
    <PageLayout
      title="Menu Management"
      subtitle="Control ingredients, dishes, and menu structure from one place"
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
        <MenuDishesTable 
          dishes={dishes} 
          loadError={loadError} 
          standardTarget={standardTarget} 
        />
      </Section>
    </PageLayout>
  );
}
