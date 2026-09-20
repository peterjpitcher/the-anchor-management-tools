# Private booking detail spacing

Reduced padding on the booking detail page only:
- Compact page header and horizontal inset.
- Removed duplicate Section header/body padding around already-padded cards.
- Card content padding reduced to 12px.
- Main column and section gaps reduced to 16px.
- Event details use 12px vertical gaps and 16px horizontal gaps.
- Quick action buttons use 12px horizontal and 8px vertical padding.
- Audit and invoice sections have smaller top gaps.
- Empty-state vertical padding reduced from 48px to 16px within page sections.

Changed: src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx.
Deliberately unchanged: shared Section, Card, Empty and PageLayout components; shell navigation; booking data, permissions, forms and business actions.

Firefox on port 3000 shows both booking items and Notes & Requirements in the first viewport, where the previous layout only reached the booking items. Section headings now sit directly above their cards. No booking data was edited.

Verification passed: targeted ESLint, clean TypeScript check, design-token guard (2 tests), and an isolated production build with placeholder environment settings. Firefox also confirmed smaller empty states in Suppliers and Deposit Deductions.
