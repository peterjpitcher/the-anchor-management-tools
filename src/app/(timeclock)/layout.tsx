import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

// Full-screen kiosk layout for the FOH timeclock.
// No authentication required: accessible on the till iPad.
//
// The background matches the .kiosk panel (brand-700), so any space around the panel reads as
// the kiosk rather than a grey band. The .kiosk panel fills the viewport itself (globals.css
// gives it no margins and a 100vh minimum height), so this wrapper adds no padding: padding here
// would push the page 62px taller than the screen and make the kiosk scroll.
export default function TimeclockLayout({ children }: { children: ReactNode }) {
  return (
    <div className="timeclock-shell min-h-screen bg-brand-700 text-on-dark">
      {children}
    </div>
  );
}
