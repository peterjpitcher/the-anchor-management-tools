'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function CheckInRedirect() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/loyalty/checkin');
  }, [router]);
  
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Redirecting to loyalty check-in...</p>
      </div>
    </div>
  );
}