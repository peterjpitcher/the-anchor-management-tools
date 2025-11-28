'use client'

import { useState, useMemo } from 'react'
import { Card } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Button } from '@/components/ui-v2/forms/Button'

// Assuming DishWithAllDetails structure based on `listMenuDishes` return
interface DishDisplayItem {
  id: string;
  name: string;
  selling_price: number;
  portion_cost: number;
  gp_pct: number | null;
  target_gp_pct: number;
  is_gp_alert: boolean;
  assignments: Array<{ menu_code: string }>;
  ingredients: any[]; // Adjust type if needed
}

interface MenuDishesTableProps {
  dishes: DishDisplayItem[];
  loadError: string | null;
  standardTarget: number;
}

function formatGp(value: number | null | undefined) {
  if (typeof value !== 'number') {
    return '—';
  }
  return `${Math.round(value * 100)}%`;
}

export function MenuDishesTable({ dishes: allDishes, loadError, standardTarget }: MenuDishesTableProps) {
  const [showMissingIngredientsOnly, setShowMissingIngredientsOnly] = useState(false);

  const dishesMissingIngredients = useMemo(() => 
    allDishes.filter(dish => !dish.ingredients || dish.ingredients.length === 0)
  , [allDishes]);

  const filteredDishes = showMissingIngredientsOnly ? dishesMissingIngredients : allDishes;

  const gpSorted = useMemo(() => 
    [...filteredDishes].sort((a, b) => {
      const aGp = typeof a.gp_pct === 'number' ? a.gp_pct : Infinity;
      const bGp = typeof b.gp_pct === 'number' ? b.gp_pct : Infinity;
      return aGp - bGp;
    })
  , [filteredDishes]);

  return (
    <>
      <div className="flex justify-end mb-4">
        {showMissingIngredientsOnly ? (
          <Button variant="secondary" onClick={() => setShowMissingIngredientsOnly(false)}>
            Show All Dishes
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setShowMissingIngredientsOnly(true)}>
            Show Missing Ingredients
          </Button>
        )}
      </div>

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
                {showMissingIngredientsOnly ? 'No dishes are missing ingredients.' : 'No dishes found. Create a dish to start tracking GP%.'}
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
                      const gpValue = typeof dish.gp_pct === 'number' ? dish.gp_pct : Infinity;
                      const targetValue = typeof dish.target_gp_pct === 'number' ? dish.target_gp_pct : standardTarget;
                      const belowTarget = gpValue !== Infinity && gpValue < targetValue;

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
                ) : dishesMissingIngredients.length === 0 ? (
                  <p className="text-sm text-gray-600">
                    Great news! Every dish has at least one ingredient mapped.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {dishesMissingIngredients.map(dish => (
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
    </>
  );
}
