'use client';

import { useState } from 'react';
import { saveOnboardingSection } from '@/app/actions/employeeInvite';

interface PersonalData {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  address: string;
  post_code: string;
  phone_number: string;
  mobile_number: string;
}

interface PersonalStepProps {
  token: string;
  initialData?: Partial<PersonalData>;
  onSuccess: (data: PersonalData) => void;
}

export default function PersonalStep({ token, initialData, onSuccess }: PersonalStepProps) {
  const [data, setData] = useState<PersonalData>({
    first_name: initialData?.first_name ?? '',
    last_name: initialData?.last_name ?? '',
    date_of_birth: initialData?.date_of_birth ?? '',
    address: initialData?.address ?? '',
    post_code: initialData?.post_code ?? '',
    phone_number: initialData?.phone_number ?? '',
    mobile_number: initialData?.mobile_number ?? '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!data.first_name.trim()) {
      setError('First name is required.');
      return;
    }
    if (!data.last_name.trim()) {
      setError('Last name is required.');
      return;
    }

    setLoading(true);
    try {
      const result = await saveOnboardingSection(token, 'personal', {
        first_name: data.first_name.trim(),
        last_name: data.last_name.trim(),
        date_of_birth: data.date_of_birth || null,
        address: data.address || null,
        post_code: data.post_code || null,
        phone_number: data.phone_number || null,
        mobile_number: data.mobile_number || null,
      });

      if (result.success) {
        onSuccess(data);
      } else {
        setError(result.error || 'Failed to save. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const field = (id: keyof PersonalData, label: string, type = 'text', required = false) => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={data[id]}
        onChange={(e) => setData({ ...data, [id]: e.target.value })}
        required={required}
        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
      />
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {field('first_name', 'First Name', 'text', true)}
        {field('last_name', 'Last Name', 'text', true)}
      </div>
      {field('date_of_birth', 'Date of Birth', 'date')}
      <div>
        <label htmlFor="address" className="block text-sm font-medium text-gray-700 mb-1">Address</label>
        <textarea
          id="address"
          value={data.address}
          onChange={(e) => setData({ ...data, address: e.target.value })}
          rows={3}
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
        />
      </div>
      {field('post_code', 'Post Code')}
      {field('phone_number', 'Phone Number', 'tel')}
      {field('mobile_number', 'Mobile Number', 'tel')}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
      >
        {loading ? 'Saving...' : 'Save & Continue'}
      </button>
    </form>
  );
}
