'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui-v2/overlay/Modal';
import { Button } from '@/components/ui-v2/forms/Button';
import { Textarea } from '@/components/ui-v2/forms/Textarea';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { toast } from '@/components/ui-v2/feedback/Toast';
import { Badge } from '@/components/ui-v2/display/Badge';

interface AiParsedIngredient {
  name: string;
  description: string | null;
  supplier_name: string | null;
  supplier_sku: string | null;
  brand: string | null;
  pack_size: number | null;
  pack_size_unit: string;
  pack_cost: number | null;
  portions_per_pack: number | null;
  wastage_pct: number;
  storage_type: string;
  allergens: string[];
  dietary_flags: string[];
  notes: string | null;
}

interface SmartImportModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (data: AiParsedIngredient) => void;
}

export function SmartImportModal({ open, onClose, onImport }: SmartImportModalProps) {
  const [input, setInput] = useState('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleParse = async () => {
    if (!input.trim()) return;

    setParsing(true);
    setError(null);

    try {
      const response = await fetch('/api/menu/ai-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawData: input }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || 'Failed to parse data');
      }

      const result = await response.json();

      if (!result?.success || !result?.data) {
        throw new Error(result?.error || 'Failed to parse data');
      }

      onImport(result.data as AiParsedIngredient);
      onClose();
      setInput('');
      toast.success('Ingredient data extracted successfully');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to process input');
      toast.error('Failed to process input');
    } finally {
      setParsing(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Smart Ingredient Import" size="lg">
      <div className="space-y-4">
        <Alert variant="info">
          <div className="space-y-2">
            <p>
              Paste <strong>any</strong> product text, HTML source, or JSON below. Our AI will extract the details for you.
            </p>
            <div className="flex gap-2">
              <Badge variant="neutral" size="sm">Booker HTML</Badge>
              <Badge variant="neutral" size="sm">Supplier Emails</Badge>
              <Badge variant="neutral" size="sm">Spreadsheet Rows</Badge>
              <Badge variant="neutral" size="sm">Website Text</Badge>
            </div>
          </div>
        </Alert>

        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste product details here..."
          rows={10}
          className="font-mono text-xs"
          disabled={parsing}
        />

        {error && (
          <Alert variant="error" title="Parsing Failed">
            {error}
          </Alert>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={parsing}>
            Cancel
          </Button>
          <Button onClick={handleParse} disabled={parsing || !input.trim()}>
            {parsing ? 'Analyzing...' : 'Analyze & Import'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
