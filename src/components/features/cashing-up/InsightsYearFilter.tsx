'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';

interface InsightsYearFilterProps {
  currentYear: number;
  selectedYear?: number;
  startYear: number;
}

export function InsightsYearFilter({ currentYear, selectedYear, startYear }: InsightsYearFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [year, setYear] = useState<number | ''>(selectedYear || '');

  useEffect(() => {
    // Sync internal state with prop if it changes externally
    setYear(selectedYear || '');
  }, [selectedYear]);

  const yearOptions = Array.from({ length: currentYear - startYear + 1 }, (_, i) => startYear + i).reverse();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newYearValue = e.target.value === '' ? '' : parseInt(e.target.value);
    setYear(newYearValue);

    const newSearchParams = new URLSearchParams(searchParams.toString());
    if (newYearValue !== '') {
      newSearchParams.set('year', newYearValue.toString());
    } else {
      newSearchParams.delete('year');
    }
    router.push(`?${newSearchParams.toString()}`);
  };

  return (
    <div className="flex justify-end bg-white p-4 rounded-lg shadow-sm border">
        <div className="flex gap-4 items-center">
            <label htmlFor="year-select" className="text-sm font-medium text-gray-700">Filter by Year:</label>
            <select 
                id="year-select"
                name="year" 
                value={year} 
                className="border rounded p-2 text-sm min-w-[150px] bg-gray-50"
                onChange={handleChange}
            >
                <option value="">Last 12 Months</option>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
        </div>
    </div>
  );
}
