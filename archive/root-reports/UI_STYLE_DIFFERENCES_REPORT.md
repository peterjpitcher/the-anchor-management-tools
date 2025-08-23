# UI Style Differences Report: Production vs Development

## Executive Summary
This report documents all visual differences between the production and development environments of the Anchor Management Tools application. The analysis covers color schemes, typography, spacing, components, and overall design patterns.

## 1. Color Palette

### Production Colors
- **Primary Brand Green**: `#1a5f3f` (Dark forest green used in sidebar and primary buttons)
- **Secondary Green**: `#22c55e` (Bright green for success states and action buttons)
- **Background Colors**:
  - Main background: `#f9fafb` (Very light gray)
  - White cards: `#ffffff`
  - Sidebar: `#1a5f3f` with white text
- **Text Colors**:
  - Primary text: `#111827` (Very dark gray)
  - Secondary text: `#6b7280` (Medium gray)
  - Muted text: `#9ca3af` (Light gray)
- **Status Colors**:
  - Success/Paid: `#22c55e` (Green)
  - Warning: `#f59e0b` (Amber/Orange)
  - Error: `#ef4444` (Red)
  - Info/Sent: `#3b82f6` (Blue)

### Development Colors
- Uses the same primary green (`#1a5f3f`) for sidebar
- Button colors and status indicators appear consistent
- Error states show appropriate red colors

## 2. Typography

### Production Typography
- **Font Family**: System font stack (appears to be using default sans-serif)
- **Font Sizes**:
  - Page titles: ~24-28px (font-weight: 600-700)
  - Section headers: ~18-20px (font-weight: 600)
  - Body text: ~14-16px (font-weight: 400)
  - Small text/labels: ~12-14px (font-weight: 400-500)
- **Line Heights**: Appears to use standard 1.5 for body text
- **Letter Spacing**: Normal/default

### Development Typography
- Similar font sizes and weights
- Consistent hierarchy maintained

## 3. Spacing and Layout Patterns

### Production Spacing
- **Page Padding**: ~24-32px on desktop, ~16px on mobile
- **Card Padding**: ~16-24px internal padding
- **Section Spacing**: ~24-32px between major sections
- **Form Field Spacing**: ~16px vertical gap between fields
- **Button Padding**: ~8-12px vertical, ~16-24px horizontal
- **Grid Gaps**: ~16-24px between grid items

### Development Spacing
- Appears to match production spacing in most areas
- Consistent padding and margins

## 4. Component Styles

### Navigation Sidebar
**Production**:
- Background: `#1a5f3f` (dark green)
- Width: ~220px fixed
- White text and icons
- Hover state: Slightly lighter background
- Active state: Even lighter background with left border accent
- Logo area has decorative border frame
- "Sign out" button at bottom with distinct styling

**Development**:
- Same green background and structure
- Added "Table Bookings" menu item
- Bottom area shows "1 Issue" indicator with red badge

### Buttons
**Production**:
- **Primary Buttons**: 
  - Background: `#22c55e` (bright green)
  - Text: White
  - Border-radius: ~6px
  - Padding: ~8-12px vertical, ~16-24px horizontal
  - Hover: Darker green
- **Secondary Buttons**:
  - Background: White
  - Border: 1px solid `#e5e7eb`
  - Text: `#374151` (dark gray)
- **Icon Buttons**: Minimal style with gray icons

**Development**:
- Similar button styles maintained
- "Create Event" button uses same green styling

### Cards/Containers
**Production**:
- Background: White (`#ffffff`)
- Border: None or very subtle (`#f3f4f6`)
- Border-radius: ~8px
- Box-shadow: Very subtle (`0 1px 2px rgba(0,0,0,0.05)`)
- Padding: ~16-24px

**Development**:
- Matching card styles
- Clean white backgrounds with subtle shadows

### Forms
**Production**:
- **Input Fields**:
  - Background: White
  - Border: 1px solid `#d1d5db`
  - Border-radius: ~6px
  - Padding: ~8-12px
  - Focus: Blue border color
  - Placeholder text: `#9ca3af` (light gray)
- **Select Dropdowns**: Similar styling to inputs with dropdown arrow
- **Date Pickers**: Standard input styling with calendar icon
- **Labels**: Dark gray text, ~14px, margin-bottom ~4-8px

**Development**:
- Consistent form styling
- Same border and padding patterns

### Tables
**Production**:
- Header background: `#f9fafb` (very light gray)
- Header text: `#6b7280` (medium gray), uppercase, smaller font
- Row borders: Bottom border `#e5e7eb`
- Row hover: Light gray background
- Cell padding: ~12-16px
- Action buttons: Text links in blue

**Development**:
- Similar table structure
- Consistent styling maintained

### Status Badges
**Production**:
- Inline text styling with colored text
- "Paid" status: Green text (`#22c55e`)
- "Sent" status: Blue text
- No background pills, just colored text

**Development**:
- Same status indicator approach

## 5. Mobile Responsive Design

### Production Mobile (375px width shown)
- Hamburger menu for navigation
- Simplified card layouts
- Stacked statistics
- Bottom navigation bar with 4 icons:
  - Dashboard, Events, Customers, Messages
  - Dark green background matching sidebar
  - White icons
- Responsive typography sizing
- Appropriate touch target sizes

## 6. Unique Production Features

1. **"View all" Links**: Positioned right-aligned with blue text
2. **Quick Action Cards**: Icon-based cards for common actions
3. **Capacity Indicators**: Progress bar style (e.g., "12/60")
4. **Date/Time Formatting**: Consistent formatting across the app
5. **Warning Messages**: Amber/yellow background for important notices (e.g., "Save the event first before uploading images")

## 7. Key Differences to Address

### Critical Fixes Needed:
1. **Error Handling**: Development shows error pages where production shows data
2. **Data Loading**: Some pages in development show errors instead of content
3. **Navigation Consistency**: Ensure all menu items work properly

### Visual Consistency:
- Overall visual design is well-matched between environments
- Color schemes are consistent
- Component styles are properly implemented
- Spacing and typography match production

## 8. Recommendations

1. **Fix Data Loading Issues**: Priority should be on fixing pages that show errors in development
2. **Maintain Visual Consistency**: The current styling matches production well
3. **Test All Navigation Items**: Ensure all menu items load properly
4. **Mobile Testing**: Verify responsive design works as expected

## 9. CSS Variables/Tokens to Standardize

```css
/* Colors */
--color-primary: #1a5f3f;
--color-primary-light: #22543d;
--color-success: #22c55e;
--color-warning: #f59e0b;
--color-error: #ef4444;
--color-info: #3b82f6;

/* Spacing */
--spacing-xs: 4px;
--spacing-sm: 8px;
--spacing-md: 16px;
--spacing-lg: 24px;
--spacing-xl: 32px;

/* Border Radius */
--radius-sm: 4px;
--radius-md: 6px;
--radius-lg: 8px;

/* Shadows */
--shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
--shadow-md: 0 4px 6px rgba(0,0,0,0.07);
```

## Conclusion

The visual design between production and development is remarkably consistent. The main issues appear to be functional (data loading/errors) rather than visual. The green color scheme, typography, spacing, and component styles are well-implemented in both environments. Focus should be on fixing the functional issues while maintaining the current visual standards.