'use client';

import { useState, useCallback, useEffect, ReactNode } from 'react';
import { Alert, Card, Empty, PageLoading, Popover } from '@/ds';
import { getMenuIngredientPrices } from '@/app/actions/menu-management';
import { toast } from '@/ds';

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

/**
 * Runs `onOpen` when the popover panel mounts. The DS Popover renders its panel only while it is
 * open and has no open callback, so this is how the history loads the first time it is shown.
 */
function OnOpen({ onOpen }: { onOpen: () => void }): null {
  useEffect(() => {
    onOpen();
    // Once per opening: the panel unmounts when it closes.
  }, []);
  return null;
}

export function PriceHistoryPopover({
  ingredientId,
  ingredientName,
  trigger,
}: PriceHistoryPopoverProps): React.ReactElement {
  const [prices, setPrices] = useState<IngredientPriceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleOpen = useCallback(async () => {
    if (loaded) return;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await getMenuIngredientPrices(ingredientId);
      if (result.error) {
        toast.error(result.error);
        setLoadError(result.error);
      } else {
        setPrices((result.data as IngredientPriceEntry[]) || []);
        // Only a successful load is kept: after a failure, opening the popover again retries.
        setLoaded(true);
      }
    } catch {
      toast.error('Failed to load price history');
      setLoadError('Failed to load price history');
    } finally {
      setLoading(false);
    }
  }, [ingredientId, loaded]);

  return (
    <Popover trigger={trigger} align="right">
      <OnOpen onOpen={() => void handleOpen()} />
      <p className="mb-2 border-b border-border pb-2 text-sm font-semibold text-text-strong">
        Price History &ndash; {ingredientName}
      </p>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <PageLoading inline label="Loading prices" className="py-4" />
        ) : loadError ? (
          <Alert tone="danger" size="sm">{loadError}</Alert>
        ) : prices.length === 0 ? (
          <Empty size="sm" title="No price history recorded yet" />
        ) : (
          <div className="space-y-3">
            {prices.map((entry) => (
              <Card key={entry.id} padding="sm">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">
                    £{entry.pack_cost.toFixed(2)} per pack
                  </div>
                  <div className="text-xs text-text-muted">
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
                  <div className="text-sm text-text-muted mt-1">{entry.notes}</div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </Popover>
  );
}
