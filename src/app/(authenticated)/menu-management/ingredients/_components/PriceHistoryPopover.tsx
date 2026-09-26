'use client';

import { useState, useCallback, ReactNode } from 'react';
import { Alert, Card, Empty, PageLoading, Popover, SubHeading, type PopoverPlacement } from '@/ds';
import { getMenuIngredientPrices } from '@/app/actions/menu-management';
import { toast } from '@/ds';
import { formatDateInLondon } from '@/lib/dateUtils';

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
  /**
   * Where the panel opens. A table row's Prices button opens it below, lined up with the button's
   * right edge (the default); the ingredient drawer's footer button opens it above.
   */
  placement?: PopoverPlacement;
}

export function PriceHistoryPopover({
  ingredientId,
  ingredientName,
  trigger,
  placement = 'bottom-end',
}: PriceHistoryPopoverProps): React.ReactElement {
  const [prices, setPrices] = useState<IngredientPriceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadPrices = useCallback(async () => {
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

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        void loadPrices();
      } else {
        // A failure is shown until the panel closes; the next opening starts a fresh load.
        setLoadError(null);
      }
    },
    [loadPrices]
  );

  // Until the first load has landed, the panel shows the spinner rather than an empty history.
  const showLoading = loading || (!loaded && !loadError);

  return (
    <Popover
      trigger={trigger}
      placement={placement}
      width="lg"
      label={`Price history for ${ingredientName}`}
      onOpenChange={handleOpenChange}
    >
      <SubHeading className="mb-2 border-b border-border pb-2">
        Price History &ndash; {ingredientName}
      </SubHeading>
      <div className="max-h-80 overflow-y-auto">
        {showLoading ? (
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
                    Effective {formatDateInLondon(entry.effective_from)}
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
