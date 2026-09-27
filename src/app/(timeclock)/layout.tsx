import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

// Full-screen kiosk layout for the FOH timeclock.
// No authentication required: accessible on the till iPad.
//
// A passthrough: the page renders KioskShell (src/components/shells/KioskShell.tsx), which
// fills the viewport and owns the background, so a wrapper here would only add a second frame.
export default function TimeclockLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
