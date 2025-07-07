# Comprehensive UI Standards Guide

This document provides the complete UI standards for The Anchor Management Tools application, covering all aspects of design, layout, and implementation patterns.

## Table of Contents

1. [Design Principles](#design-principles)
2. [Color System](#color-system)
3. [Typography](#typography)
4. [Spacing & Layout](#spacing--layout)
5. [Component Standards](#component-standards)
6. [Page Structure](#page-structure)
7. [Forms & Inputs](#forms--inputs)
8. [Tables & Lists](#tables--lists)
9. [Navigation Patterns](#navigation-patterns)
10. [Modals & Overlays](#modals--overlays)
11. [Loading & Empty States](#loading--empty-states)
12. [Error Handling](#error-handling)
13. [Responsive Design](#responsive-design)
14. [Accessibility](#accessibility)
15. [Animation & Transitions](#animation--transitions)
16. [Implementation Guidelines](#implementation-guidelines)

## Design Principles

1. **Consistency First**: Use established patterns throughout the application
2. **Mobile-First Design**: Build for mobile, enhance for desktop
3. **Accessibility**: WCAG 2.1 AA compliant with full keyboard navigation
4. **Performance**: Lightweight components, minimal JavaScript
5. **Clear Visual Hierarchy**: Users should instantly understand importance and relationships
6. **Progressive Enhancement**: Core functionality works without JavaScript

## Color System

### Primary Palette

```css
/* Brand Colors - CURRENT STANDARD */
--primary-green: #16a34a;     /* green-600 - Primary actions, success states */
--primary-green-dark: #15803d; /* green-700 - Hover states */
--primary-green-light: #86efac; /* green-300 - Light backgrounds */
--focus-green: #22c55e;        /* green-500 - Focus rings */

--link-blue: #2563eb;          /* blue-600 - Links, secondary actions */
--link-blue-dark: #1e3a8a;     /* blue-900 - Link hover states */

--sidebar-green: #005131;      /* Custom - Navigation sidebar */

/* Status Colors */
--success: #10b981;            /* green-500 - Success messages */
--warning: #f59e0b;            /* amber-500 - Warnings */
--error: #ef4444;              /* red-500 - Errors, destructive actions */
--info: #3b82f6;               /* blue-500 - Information */

/* Neutral Colors */
--gray-50: #f9fafb;            /* Lightest backgrounds */
--gray-100: #f3f4f6;           /* Light backgrounds, hover states */
--gray-200: #e5e7eb;           /* Borders, dividers */
--gray-300: #d1d5db;           /* Input borders */
--gray-400: #9ca3af;           /* Placeholder text, icons */
--gray-500: #6b7280;           /* Secondary text */
--gray-600: #4b5563;           /* Body text */
--gray-700: #374151;           /* Headings */
--gray-800: #1f2937;           /* Dark text */
--gray-900: #111827;           /* Darkest text */
```

### Usage Rules

1. **NO INDIGO COLORS** - Replace all indigo with green/blue palette
2. **Primary Actions**: Always use green-600/green-700
3. **Links**: Always use blue-600/blue-900 (never green for links)
4. **Focus States**: Always use green-500 for focus rings
5. **Text**: Use gray-900 for primary text (never black)

## Typography

### Font Stack

```css
font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```

### Type Scale

| Element | Class | Size | Weight | Line Height |
|---------|-------|------|--------|-------------|
| Page Title | `text-3xl font-bold` | 30px | 700 | 36px |
| Section Title | `text-2xl font-bold` | 24px | 700 | 32px |
| Card Title | `text-xl font-semibold` | 20px | 600 | 28px |
| Subsection | `text-lg font-medium` | 18px | 500 | 28px |
| Body | `text-base` | 16px | 400 | 24px |
| Label | `text-sm font-medium` | 14px | 500 | 20px |
| Small Text | `text-sm` | 14px | 400 | 20px |
| Caption | `text-xs` | 12px | 400 | 16px |

### Text Color Standards

```css
/* Primary text */
.text-gray-900

/* Secondary text */
.text-gray-600 or .text-gray-500

/* Disabled text */
.text-gray-400

/* Error text */
.text-red-600

/* Success text */
.text-green-600

/* Link text */
.text-blue-600 hover:text-blue-900
```

## Spacing & Layout

### Base Unit System

Based on 4px units (Tailwind's spacing scale):
- 0.5 = 2px
- 1 = 4px
- 2 = 8px
- 3 = 12px
- 4 = 16px
- 5 = 20px
- 6 = 24px
- 8 = 32px

### Page Layout Structure

```html
<!-- Standard Page Container -->
<div className="space-y-6">
  <!-- Page Header Card -->
  <div className="bg-white shadow sm:rounded-lg">
    <div className="px-4 py-5 sm:p-6">
      <h1 className="text-2xl font-bold text-gray-900">Page Title</h1>
      <p className="mt-1 text-sm text-gray-500">Page description</p>
    </div>
  </div>
  
  <!-- Content Sections -->
  <div className="bg-white shadow sm:rounded-lg">
    <div className="px-4 py-5 sm:p-6">
      <!-- Section content -->
    </div>
  </div>
</div>
```

### Container Widths

```css
/* Full width containers */
.w-full

/* Constrained containers */
.max-w-4xl  /* Forms, detail pages */
.max-w-6xl  /* Lists, tables */
.max-w-7xl  /* Dashboard, wide layouts */

/* Always center constrained containers */
.mx-auto
```

### Standard Spacing Patterns

| Context | Mobile | Desktop | Class |
|---------|--------|---------|-------|
| Page padding | 16px | 24px | `p-4 sm:p-6` |
| Section spacing | 24px | 24px | `space-y-6` |
| Card padding | 16-20px | 24px | `px-4 py-5 sm:p-6` |
| Form field spacing | 24px | 24px | `space-y-6` |
| Inline spacing | 12px | 12px | `space-x-3` |
| List item padding | 16px | 16-24px | `p-4` or `px-6 py-4` |

## Component Standards

### Buttons

#### Component Usage
```tsx
import { Button } from '@/components/ui/Button'

// Primary button
<Button>Save Changes</Button>

// Secondary button
<Button variant="secondary">Cancel</Button>

// Destructive button
<Button variant="destructive">Delete</Button>
```

#### Button Classes (when not using component)
```css
/* Primary (Green) */
.inline-flex .items-center .justify-center .rounded-lg .bg-green-600 .px-6 .py-3 .md:py-2 .text-base .md:text-sm .font-medium .text-white .shadow-sm .hover:bg-green-700 .focus:outline-none .focus:ring-2 .focus:ring-green-500 .focus:ring-offset-2 .disabled:opacity-50 .disabled:cursor-not-allowed .min-h-[44px]

/* Secondary (Gray) */
.inline-flex .items-center .justify-center .rounded-lg .border .border-gray-300 .bg-white .px-6 .py-3 .md:py-2 .text-base .md:text-sm .font-medium .text-gray-700 .shadow-sm .hover:bg-gray-50 .focus:outline-none .focus:ring-2 .focus:ring-green-500 .focus:ring-offset-2 .min-h-[44px]

/* Destructive (Red) */
.inline-flex .items-center .justify-center .rounded-lg .bg-red-600 .px-6 .py-3 .md:py-2 .text-base .md:text-sm .font-medium .text-white .shadow-sm .hover:bg-red-700 .focus:outline-none .focus:ring-2 .focus:ring-red-500 .focus:ring-offset-2 .min-h-[44px]
```

#### Touch Target Requirements
- Minimum height: 44px (`min-h-[44px]`)
- Minimum width: 44px for icon-only buttons
- Adequate padding for text buttons

### Cards

```html
<!-- Standard Card -->
<div className="bg-white shadow sm:rounded-lg">
  <div className="px-4 py-5 sm:p-6">
    <!-- Content -->
  </div>
</div>

<!-- Card with Header -->
<div className="bg-white shadow sm:rounded-lg">
  <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
    <h3 className="text-lg font-medium text-gray-900">Card Title</h3>
  </div>
  <div className="px-4 py-5 sm:p-6">
    <!-- Content -->
  </div>
</div>

<!-- Card with Footer -->
<div className="bg-white shadow sm:rounded-lg">
  <div className="px-4 py-5 sm:p-6">
    <!-- Content -->
  </div>
  <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse gap-3">
    <Button>Save</Button>
    <Button variant="secondary">Cancel</Button>
  </div>
</div>
```

### Badges

```html
<!-- Status Badges -->
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
  Active
</span>

<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
  Pending
</span>

<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
  Inactive
</span>

<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
  Information
</span>

<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
  Neutral
</span>
```

### Links

```html
<!-- Standard Link -->
<Link href="/path" className="text-blue-600 hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 rounded">
  Link Text
</Link>

<!-- Link with Icon -->
<Link href="/path" className="inline-flex items-center text-blue-600 hover:text-blue-900">
  <PencilIcon className="h-4 w-4 mr-1" />
  Edit
</Link>
```

## Forms & Inputs

### Form Structure

```html
<form className="space-y-6">
  <div className="bg-white shadow sm:rounded-lg">
    <div className="px-4 py-5 sm:p-6 space-y-6">
      <!-- Form fields -->
    </div>
    <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse gap-3">
      <Button type="submit">Save</Button>
      <Button type="button" variant="secondary">Cancel</Button>
    </div>
  </div>
</form>
```

### Input Fields

#### Text Input
```html
<div>
  <label htmlFor="field-id" className="block text-sm font-medium text-gray-700">
    Field Label
  </label>
  <input
    type="text"
    id="field-id"
    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
  />
  <p className="mt-1 text-xs text-gray-500">Helper text</p>
</div>
```

#### Select
```html
<select className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm">
  <option value="">Select an option</option>
  <option value="1">Option 1</option>
</select>
```

#### Textarea
```html
<textarea
  rows={4}
  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
/>
```

#### Checkbox
```html
<div className="flex items-center">
  <input
    id="checkbox-id"
    type="checkbox"
    className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
  />
  <label htmlFor="checkbox-id" className="ml-2 block text-sm text-gray-900">
    Checkbox label
  </label>
</div>
```

### Field States

```css
/* Default */
.border-gray-300

/* Focus */
.focus:border-green-500 .focus:ring-green-500

/* Error */
.border-red-300 .focus:border-red-500 .focus:ring-red-500

/* Disabled */
.bg-gray-50 .text-gray-500 .cursor-not-allowed
```

### Validation Messages

```html
<!-- Error Message -->
<p className="mt-1 text-xs text-red-600">This field is required</p>

<!-- Success Message -->
<p className="mt-1 text-xs text-green-600">Looks good!</p>

<!-- Warning Message -->
<p className="mt-1 text-xs text-yellow-600">This might cause issues</p>
```

## Tables & Lists

### Desktop Table

```html
<div className="overflow-hidden shadow sm:rounded-lg">
  <table className="min-w-full divide-y divide-gray-200">
    <thead className="bg-gray-50">
      <tr>
        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
          Column Header
        </th>
      </tr>
    </thead>
    <tbody className="bg-white divide-y divide-gray-200">
      <tr className="hover:bg-gray-50">
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
          Cell content
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

### Mobile List

```html
<div className="bg-white shadow overflow-hidden sm:rounded-lg">
  <ul className="divide-y divide-gray-200">
    <li className="px-4 py-4 sm:px-6">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            Primary content
          </p>
          <p className="text-sm text-gray-500">
            Secondary content
          </p>
        </div>
        <div className="flex-shrink-0">
          <!-- Actions -->
        </div>
      </div>
    </li>
  </ul>
</div>
```

### Empty States

```html
<div className="text-center py-12">
  <IconComponent className="mx-auto h-12 w-12 text-gray-400" />
  <h3 className="mt-2 text-sm font-medium text-gray-900">No items found</h3>
  <p className="mt-1 text-sm text-gray-500">
    Get started by creating a new item.
  </p>
  <div className="mt-6">
    <Button>
      <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
      New Item
    </Button>
  </div>
</div>
```

## Navigation Patterns

### Desktop Sidebar

```html
<nav className="hidden md:flex fixed top-0 left-0 h-full w-64 bg-sidebar text-white flex-col">
  <div className="p-4">
    <!-- Logo -->
  </div>
  <div className="flex-1 overflow-y-auto">
    <a href="#" className="flex items-center px-4 py-3 hover:bg-green-700 transition-colors">
      <HomeIcon className="h-5 w-5 mr-3" />
      <span className="text-sm font-medium">Dashboard</span>
    </a>
  </div>
</nav>
```

### Mobile Bottom Navigation

```html
<nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
  <div className="grid grid-cols-5 h-16">
    <a href="#" className="flex flex-col items-center justify-center text-gray-600 hover:text-gray-900">
      <HomeIcon className="h-5 w-5" />
      <span className="text-xs mt-1">Home</span>
    </a>
  </div>
</nav>
```

### Breadcrumbs

```html
<nav className="flex" aria-label="Breadcrumb">
  <ol className="flex items-center space-x-2">
    <li>
      <Link href="/" className="text-gray-500 hover:text-gray-700">
        Home
      </Link>
    </li>
    <li>
      <span className="mx-2 text-gray-400">/</span>
      <Link href="/events" className="text-gray-500 hover:text-gray-700">
        Events
      </Link>
    </li>
    <li>
      <span className="mx-2 text-gray-400">/</span>
      <span className="text-gray-900">Current Page</span>
    </li>
  </ol>
</nav>
```

## Modals & Overlays

### Modal Component Usage

```tsx
import { Modal } from '@/components/ui/Modal'

<Modal
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  title="Modal Title"
  size="md"
>
  <div className="space-y-4">
    <!-- Modal content -->
  </div>
</Modal>
```

### Modal Structure (Manual)

```html
<div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50 p-4">
  <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
    <!-- Header -->
    <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
      <h2 className="text-xl font-semibold text-gray-900">Modal Title</h2>
      <button className="p-1 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2">
        <XMarkIcon className="h-5 w-5 text-gray-500" />
      </button>
    </div>
    
    <!-- Content -->
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <!-- Modal content -->
    </div>
    
    <!-- Footer -->
    <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 flex justify-end gap-3">
      <Button variant="secondary">Cancel</Button>
      <Button>Confirm</Button>
    </div>
  </div>
</div>
```

## Loading & Empty States

### Loading Spinner

```tsx
import { Loader2 } from 'lucide-react'

// Standard loading spinner
<div className="flex items-center justify-center p-8">
  <Loader2 className="h-8 w-8 animate-spin text-green-600" />
</div>

// With loading text
<div className="flex flex-col items-center justify-center p-8">
  <Loader2 className="h-8 w-8 animate-spin text-green-600" />
  <p className="mt-2 text-sm text-gray-600">Loading...</p>
</div>
```

### Skeleton Loader

```html
<div className="animate-pulse">
  <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
  <div className="space-y-3">
    <div className="h-4 bg-gray-200 rounded"></div>
    <div className="h-4 bg-gray-200 rounded w-5/6"></div>
  </div>
</div>
```

### Page Loading Skeleton

```tsx
import { PageLoadingSkeleton } from '@/components/ui/SkeletonLoader'

<PageLoadingSkeleton />
```

### Empty States

```html
<div className="text-center py-12">
  <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
  <h3 className="mt-2 text-sm font-medium text-gray-900">No customers</h3>
  <p className="mt-1 text-sm text-gray-500">
    Get started by adding a new customer.
  </p>
  <div className="mt-6">
    <Button>
      <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
      Add Customer
    </Button>
  </div>
</div>
```

## Error Handling

### Error Messages

```html
<!-- Inline error -->
<div className="rounded-md bg-red-50 p-4">
  <div className="flex">
    <XCircleIcon className="h-5 w-5 text-red-400" />
    <div className="ml-3">
      <h3 className="text-sm font-medium text-red-800">
        There was an error processing your request
      </h3>
      <p className="mt-2 text-sm text-red-700">
        Error details go here
      </p>
    </div>
  </div>
</div>

<!-- Toast notification -->
toast.error('Failed to save changes')
```

### Form Validation Errors

```html
<div className="rounded-md bg-red-50 p-4 mb-6">
  <h3 className="text-sm font-medium text-red-800">
    There were errors with your submission
  </h3>
  <ul className="mt-2 text-sm text-red-700 list-disc list-inside">
    <li>Field 1 is required</li>
    <li>Field 2 must be a valid email</li>
  </ul>
</div>
```

## Responsive Design

### Breakpoints

```css
sm: 640px   /* Small tablets */
md: 768px   /* Tablets */
lg: 1024px  /* Desktop */
xl: 1280px  /* Large desktop */
2xl: 1536px /* Extra large */
```

### Common Responsive Patterns

```html
<!-- Hide/Show -->
<div className="hidden md:block">Desktop only</div>
<div className="block md:hidden">Mobile only</div>

<!-- Responsive Grid -->
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  <!-- Grid items -->
</div>

<!-- Responsive Padding -->
<div className="px-4 py-5 sm:p-6">
  <!-- Content -->
</div>

<!-- Responsive Text -->
<button className="text-base md:text-sm">
  Responsive text size
</button>

<!-- Responsive Flex -->
<div className="flex flex-col sm:flex-row gap-4">
  <!-- Flex items -->
</div>
```

### Mobile Considerations

1. **Touch Targets**: Minimum 44x44px
2. **Thumb Reach**: Important actions in bottom half
3. **Gestures**: Support swipe where appropriate
4. **Orientation**: Test both portrait and landscape
5. **Performance**: Minimize bundle size, lazy load images

## Accessibility

### Required Standards

1. **WCAG 2.1 AA Compliance**
2. **Keyboard Navigation**: All interactive elements accessible via keyboard
3. **Screen Reader Support**: Proper ARIA labels and semantic HTML
4. **Color Contrast**: 4.5:1 for normal text, 3:1 for large text
5. **Focus Indicators**: Visible focus rings on all interactive elements

### Implementation

```html
<!-- Screen reader only -->
<span className="sr-only">Additional context for screen readers</span>

<!-- ARIA labels -->
<button aria-label="Delete item">
  <TrashIcon className="h-5 w-5" aria-hidden="true" />
</button>

<!-- Form associations -->
<label htmlFor="email">Email</label>
<input id="email" aria-describedby="email-error" />
<p id="email-error" className="text-sm text-red-600">Invalid email</p>

<!-- Keyboard navigation -->
<div role="list">
  <div role="listitem" tabIndex={0}>
    Keyboard accessible item
  </div>
</div>
```

## Animation & Transitions

### Transition Classes

```css
.transition-all      /* All properties */
.transition-colors   /* Color changes */
.transition-opacity  /* Opacity changes */
.transition-shadow   /* Shadow changes */
.transition-transform /* Transform changes */
```

### Duration & Easing

```css
.duration-75   /* 75ms */
.duration-100  /* 100ms */
.duration-150  /* 150ms - Default */
.duration-200  /* 200ms */
.duration-300  /* 300ms */

.ease-in-out   /* Default easing */
.ease-in       /* Accelerate */
.ease-out      /* Decelerate */
```

### Common Animations

```html
<!-- Hover transitions -->
<button className="bg-green-600 hover:bg-green-700 transition-colors duration-150">
  Hover me
</button>

<!-- Focus transitions -->
<input className="focus:ring-2 transition-all duration-150" />

<!-- Loading spinner -->
<div className="animate-spin">
  <Loader2 className="h-8 w-8" />
</div>

<!-- Pulse animation -->
<div className="animate-pulse bg-gray-200 h-4 w-full rounded"></div>

<!-- Fade in/out -->
<div className="transition-opacity duration-300 opacity-0 hover:opacity-100">
  Fade in on hover
</div>
```

### Motion Preferences

Always respect user preferences:

```css
@media (prefers-reduced-motion: reduce) {
  .animate-spin,
  .animate-pulse {
    animation: none;
  }
}
```

## Implementation Guidelines

### Component Creation Checklist

- [ ] Follow mobile-first approach
- [ ] Use semantic HTML elements
- [ ] Include proper ARIA labels
- [ ] Add keyboard navigation support
- [ ] Implement focus states (green-500)
- [ ] Test color contrast ratios
- [ ] Add loading states
- [ ] Handle error states
- [ ] Include empty states
- [ ] Test on mobile devices
- [ ] Verify touch target sizes
- [ ] Document usage examples

### Code Standards

1. **Import Order**:
   ```tsx
   // 1. React/Next imports
   // 2. Third-party libraries
   // 3. Internal components
   // 4. Actions/utilities
   // 5. Types
   // 6. Styles/assets
   ```

2. **Component Structure**:
   ```tsx
   // 1. Type definitions
   // 2. Component function
   // 3. Hooks
   // 4. Event handlers
   // 5. Render helpers
   // 6. Main render
   ```

3. **Naming Conventions**:
   - Components: PascalCase
   - Functions: camelCase
   - Constants: UPPER_SNAKE_CASE
   - CSS classes: kebab-case (via Tailwind)

### Testing Requirements

1. **Visual Testing**:
   - All breakpoints (mobile, tablet, desktop)
   - Light/dark mode (if applicable)
   - High contrast mode
   - Zoom levels (up to 200%)

2. **Interaction Testing**:
   - Keyboard navigation
   - Screen reader announcements
   - Touch interactions
   - Hover states
   - Focus management

3. **Performance Testing**:
   - Page load time < 3s
   - First contentful paint < 1.5s
   - Cumulative layout shift < 0.1
   - Lighthouse score > 90

## Version History

- **v2.0** (2025-07-06): Comprehensive update with layout standards, corrected color system
- **v1.0** (2025-06-21): Initial version

---

*This document should be updated whenever new patterns are established or existing patterns are modified.*