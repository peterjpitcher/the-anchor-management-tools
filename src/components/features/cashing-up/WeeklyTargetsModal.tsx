'use client';

import { useState, useTransition } from 'react';
import { updateWeeklyTargetsAction } from '@/app/actions/cashing-up';

interface Props {
  siteId: string;
  onClose: () => void;
  onSave: () => void;
}

const DAYS = [
  { id: 1, name: 'Monday' },
  { id: 2, name: 'Tuesday' },
  { id: 3, name: 'Wednesday' },
  { id: 4, name: 'Thursday' },
  { id: 5, name: 'Friday' },
  { id: 6, name: 'Saturday' },
  { id: 0, name: 'Sunday' },
];

const DEFAULT_TARGETS: Record<number, number> = {
  1: 350,
  2: 450,
  3: 600,
  4: 600,
  5: 950,
  6: 1400,
  0: 800,
};

export function WeeklyTargetsModal({ siteId, onClose, onSave }: Props) {
  const [isPending, startTransition] = useTransition();
  const [targets, setTargets] = useState<Record<number, string>>(() => {
    // Initialize with defaults as strings
    const initial: Record<number, string> = {};
    Object.entries(DEFAULT_TARGETS).forEach(([k, v]) => initial[parseInt(k)] = v.toString());
    return initial;
  });
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0]);

  const handleSave = () => {
    startTransition(async () => {
      const numTargets: Record<number, number> = {};
      Object.entries(targets).forEach(([k, v]) => {
        numTargets[parseInt(k)] = parseFloat(v) || 0;
      });

      const res = await updateWeeklyTargetsAction(siteId, numTargets, effectiveDate);
      if (res.success) {
        alert('Weekly targets updated successfully');
        onSave();
        onClose();
      } else {
        alert('Failed to update targets: ' + res.error);
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold mb-4">Set Weekly Default Targets</h3>
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Effective From Date</label>
          <input 
            type="date" 
            value={effectiveDate}
            onChange={e => setEffectiveDate(e.target.value)}
            className="w-full border rounded p-2"
          />
          <p className="text-xs text-gray-500 mt-1">Targets will apply from this date onwards.</p>
        </div>

        <div className="space-y-3 mb-6">
          {DAYS.map(day => (
            <div key={day.id} className="flex items-center justify-between">
              <label className="text-sm font-medium">{day.name}</label>
              <div className="relative w-32">
                <span className="absolute left-2 top-2 text-gray-400">£</span>
                <input
                  type="number"
                  value={targets[day.id] || ''}
                  onChange={e => setTargets(prev => ({ ...prev, [day.id]: e.target.value }))}
                  className="w-full border rounded p-2 pl-6 text-right"
                  placeholder="0.00"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
            disabled={isPending}
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            disabled={isPending}
          >
            {isPending ? 'Saving...' : 'Save Defaults'}
          </button>
        </div>
      </div>
    </div>
  );
}
