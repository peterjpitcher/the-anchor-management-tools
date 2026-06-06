import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

// Full-screen kiosk layout for the FOH timeclock.
// No authentication required — accessible on the till iPad.
export default function TimeclockLayout({ children }: { children: ReactNode }) {
  return (
    <div className="timeclock-shell min-h-screen bg-gray-900 text-white">
      {children}
    </div>
  );
}
