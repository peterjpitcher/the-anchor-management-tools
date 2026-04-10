'use client';

import { useState, useCallback, ReactNode } from 'react';
import { Popover, PopoverHeader, PopoverContent } from '@/components/ui-v2/overlay/Popover';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { getMenuIngredientPrices } from '@/app/actions/menu-management';
import { toast } from '@/components/ui-v2/feedback/Toast';

interface IngredientPriceEntry {
  id: string;
  pack_cost: number;
  effective_from: string;
  supplier_name?: string | null;
  supplier_sku?: string | null;
  notes?: string | null;
  created_at: string;
}

interface PriceHistoryPopoverProps {
  ingredientId: string;
  ingredientName: string;
  trigger: ReactNode;
}

export function PriceHistoryPopover({
  ingredientId,
  ingredientName,
  trigger,
}: PriceHistoryPopoverProps): React.ReactElement {
  const [prices, setPrices] = useState<IngredientPriceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const handleOpenChange = useCallback(
    async (open: boolean) => {
      if (open && !loaded) {
        setLoading(true);
        try {
          const result = await getMenuIngredientPrices(ingredientId);
          if (result.error) {
            toast.error(result.error);
          } else {
            setPrices((result.data as IngredientPriceEntry[]) || []);
          }
          setLoaded(true);
        } catch {
          toast.error('Failed to load price history');
        } finally {
          setLoading(false);
        }
      }
    },
    [ingredientId, loaded]
  );

  return (
    <Popover
      trigger={trigger}
      placement="bottom-start"
      width={360}
      onOpenChange={handleOpenChange}
    >
      <PopoverHeader>
        <h4 className="text-sm font-semibold text-gray-900">
          Price history &ndash; {ingredientName}
        </h4>
      </PopoverHeader>
      <PopoverContent className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Spinner size="sm" showLabel label="Loading prices..." />
          </div>
        ) : prices.length === 0 ? (
          <p className="text-sm text-gray-500">No price history recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {prices.map((entry) => (
              <div key={entry.id} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">
                    £{entry.pack_cost.toFixed(2)} per pack
                  </div>
                  <div className="text-xs text-gray-500">
                    Effective {new Date(entry.effective_from).toLocaleDateString()}
                  </div>
                </div>
                {entry.supplier_name && (
                  <div className="text-sm mt-1">
                    Supplier: {entry.supplier_name}
                    {entry.supplier_sku ? ` (SKU ${entry.supplier_sku})` : ''}
                  </div>
                )}
                {entry.notes && (
                  <div className="text-sm text-gray-600 mt-1">{entry.notes}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
