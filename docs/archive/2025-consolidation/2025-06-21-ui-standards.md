# UI Standards Guide

This document outlines the comprehensive UI standards and design patterns for The Anchor Management Tools application. All new features and updates should follow these established patterns to maintain consistency across the application.

## Table of Contents

1. [Design Principles](#design-principles)
2. [Color Palette](#color-palette)
3. [Typography](#typography)
4. [Spacing System](#spacing-system)
5. [Component Library](#component-library)
6. [Layout Patterns](#layout-patterns)
7. [Navigation](#navigation)
8. [Forms and Inputs](#forms-and-inputs)
9. [Tables and Lists](#tables-and-lists)
10. [Modals and Overlays](#modals-and-overlays)
11. [Interactive States](#interactive-states)
12. [Icons](#icons)
13. [Responsive Design](#responsive-design)
14. [Accessibility](#accessibility)
15. [Animation and Transitions](#animation-and-transitions)

## Design Principles

1. **Mobile-First**: Design for mobile devices first, then enhance for larger screens
2. **Consistency**: Use established patterns and components throughout
3. **Clarity**: Clear visual hierarchy and intuitive interactions
4. **Accessibility**: WCAG compliant with keyboard navigation and screen reader support
5. **Performance**: Lightweight components with minimal client-side JavaScript

## Color Palette

### Primary Colors

```css
/* Brand Colors */
--primary-blue: #2563eb;      /* blue-600 - Primary actions, links */
--sidebar-green: #005131;     /* Navigation sidebar */
--success-green: #10b981;     /* green-500 - Success states, primary buttons */
--warning-yellow: #f59e0b;    /* amber-500 - Warnings */
--error-red: #ef4444;         /* red-500 - Errors, destructive actions */

/* Neutral Colors */
--gray-50: #f9fafb;          /* Backgrounds, table headers */
--gray-100: #f3f4f6;         /* Hover states */
--gray-200: #e5e7eb;         /* Borders, dividers */
--gray-300: #d1d5db;         /* Input borders */
--gray-400: #9ca3af;         /* Placeholder text */
--gray-500: #6b7280;         /* Secondary text */
--gray-600: #4b5563;         /* Body text */
--gray-700: #374151;         /* Headings */
--gray-800: #1f2937;         /* Dark text */
--gray-900: #111827;         /* Darkest text */
```

### Usage Guidelines

- **Primary Actions**: Use success green (`green-600`) for primary buttons and CTAs
- **Links**: Use primary blue (`blue-600`) with darker hover state
- **Destructive Actions**: Use error red (`red-600`) for delete/cancel actions
- **Neutral Elements**: Use gray scale for borders, backgrounds, and secondary text

## Typography

### Font Stack

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```

### Type Scale

| Element | Class | Size | Weight |
|---------|-------|------|--------|
| Page Title | `text-2xl font-bold` | 24px | 700 |
| Section Header | `text-xl font-semibold` | 20px | 600 |
| Subsection | `text-lg font-medium` | 18px | 500 |
| Body | `text-base` | 16px | 400 |
| Label | `text-sm font-medium` | 14px | 500 |
| Small Text | `text-sm` | 14px | 400 |
| Helper Text | `text-xs text-gray-500` | 12px | 400 |

### Usage Examples

```html
<!-- Page Title -->
<h1 class="text-2xl font-bold text-gray-900">Event Management</h1>

<!-- Section Header -->
<h2 class="text-xl font-semibold text-gray-900">Upcoming Events</h2>

<!-- Form Label -->
<label class="text-sm font-medium text-gray-700">Customer Name</label>

<!-- Helper Text -->
<p class="text-xs text-gray-500">Enter the customer's full name</p>
```

## Spacing System

### Base Unit

The spacing system is based on a 4px unit scale using Tailwind's spacing utilities.

### Common Spacing Patterns

| Context | Class | Pixels |
|---------|-------|--------|
| Section Spacing | `space-y-6` | 24px |
| Container Padding | `p-6` | 24px |
| Card Padding | `p-4` or `p-5` | 16px or 20px |
| Form Field Spacing | `space-y-6` | 24px |
| Inline Elements | `space-x-3` | 12px |
| Button Padding | `px-6 py-3` | 24px / 12px |
| Input Padding | `px-3 py-2` | 12px / 8px |

### Responsive Spacing

```html
<!-- Mobile-first responsive padding -->
<div class="px-4 py-5 sm:p-6">
  <!-- Content -->
</div>
```

## Component Library

### Buttons

#### Primary Button (Green)

```html
<button type="button" class="inline-flex items-center justify-center rounded-lg bg-green-600 px-6 py-3 md:py-2 text-base md:text-sm font-medium text-white shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]">
  Save Changes
</button>
```

#### Secondary Button (Outline)

```html
<button type="button" class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-6 py-3 md:py-2 text-base md:text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2">
  Cancel
</button>
```

#### Destructive Button (Red)

```html
<button type="button" class="inline-flex items-center justify-center rounded-lg bg-red-600 px-6 py-3 md:py-2 text-base md:text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2">
  Delete
</button>
```

#### Icon Button

```html
<button type="button" class="p-1 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500">
  <PencilIcon class="h-5 w-5 text-gray-500" aria-hidden="true" />
  <span class="sr-only">Edit</span>
</button>
```

### Cards

```html
<div class="bg-white shadow sm:rounded-lg">
  <div class="px-4 py-5 sm:p-6">
    <!-- Card content -->
  </div>
</div>
```

### Form Inputs

#### Text Input

```html
<div>
  <label for="name" class="block text-sm font-medium text-gray-700">
    Name
  </label>
  <input
    type="text"
    name="name"
    id="name"
    class="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
    placeholder="Enter name"
  />
</div>
```

#### Select

```html
<select class="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm">
  <option>Option 1</option>
  <option>Option 2</option>
</select>
```

#### Textarea

```html
<textarea
  rows={4}
  class="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
  placeholder="Enter description"
/>
```

### Badges

```html
<!-- Success Badge -->
<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
  Active
</span>

<!-- Warning Badge -->
<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
  Pending
</span>

<!-- Error Badge -->
<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
  Failed
</span>
```

## Layout Patterns

### Page Layout

```html
<div class="min-h-screen bg-gray-50">
  <!-- Navigation -->
  <Navigation />
  
  <!-- Main Content -->
  <main class="md:ml-64 pb-16 md:pb-6">
    <div class="p-6">
      <!-- Page Title -->
      <h1 class="text-2xl font-bold text-gray-900 mb-6">Page Title</h1>
      
      <!-- Content sections -->
      <div class="space-y-6">
        <!-- Section cards -->
      </div>
    </div>
  </main>
  
  <!-- Mobile Bottom Navigation -->
  <BottomNavigation />
</div>
```

### Grid Layouts

```html
<!-- Responsive Grid -->
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  <!-- Grid items -->
</div>

<!-- Two Column Layout -->
<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
  <!-- Main content -->
  <div class="lg:col-span-1">...</div>
  <!-- Sidebar -->
  <div class="lg:col-span-1">...</div>
</div>
```

## Navigation

### Desktop Sidebar

```html
<nav class="hidden md:flex fixed top-0 left-0 h-full w-64 bg-sidebar text-white flex-col">
  <div class="p-4">
    <!-- Logo -->
  </div>
  <div class="flex-1 overflow-y-auto">
    <!-- Navigation items -->
    <a href="#" class="flex items-center px-4 py-3 hover:bg-green-700 transition-colors">
      <HomeIcon class="h-5 w-5 mr-3" />
      <span class="text-sm font-medium">Dashboard</span>
    </a>
  </div>
</nav>
```

### Mobile Bottom Navigation

```html
<nav class="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
  <div class="grid grid-cols-5 h-16">
    <a href="#" class="flex flex-col items-center justify-center text-gray-600 hover:text-gray-900">
      <HomeIcon class="h-5 w-5" />
      <span class="text-xs mt-1">Home</span>
    </a>
  </div>
</nav>
```

## Forms and Inputs

### Form Layout

```html
<form class="space-y-6">
  <!-- Form sections -->
  <div class="bg-white shadow sm:rounded-lg">
    <div class="px-4 py-5 sm:p-6 space-y-6">
      <!-- Form fields -->
    </div>
    <div class="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse gap-3">
      <button type="submit" class="...">Save</button>
      <button type="button" class="...">Cancel</button>
    </div>
  </div>
</form>
```

### Field Structure

```html
<div>
  <label class="block text-sm font-medium text-gray-700">
    Field Label
    <span class="text-red-500">*</span> <!-- Required indicator -->
  </label>
  <input type="text" class="mt-1 ..." />
  <p class="mt-1 text-xs text-gray-500">Helper text goes here</p>
  <p class="mt-1 text-xs text-red-500">Error message</p>
</div>
```

## Tables and Lists

### Desktop Table

```html
<div class="overflow-hidden shadow sm:rounded-lg">
  <table class="min-w-full divide-y divide-gray-200">
    <thead class="bg-gray-50">
      <tr>
        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
          Name
        </th>
      </tr>
    </thead>
    <tbody class="bg-white divide-y divide-gray-200">
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
          John Doe
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

### Mobile List View

```html
<div class="space-y-3">
  <div class="bg-white border border-gray-200 rounded-lg p-4">
    <div class="flex justify-between items-start">
      <div>
        <h3 class="text-sm font-medium text-gray-900">Item Title</h3>
        <p class="text-sm text-gray-500">Secondary info</p>
      </div>
      <span class="text-sm text-gray-900">Value</span>
    </div>
  </div>
</div>
```

## Modals and Overlays

### Modal Structure

```html
<div class="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
  <div class="bg-white rounded-lg shadow-xl p-6 max-w-2xl w-full max-h-[90vh] flex flex-col">
    <!-- Header -->
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-semibold">Modal Title</h2>
      <button class="p-1 rounded-full hover:bg-gray-100">
        <XMarkIcon class="h-5 w-5" />
      </button>
    </div>
    
    <!-- Content -->
    <div class="flex-1 overflow-y-auto">
      <!-- Modal content -->
    </div>
    
    <!-- Footer -->
    <div class="mt-6 flex justify-end gap-3">
      <button class="...">Cancel</button>
      <button class="...">Confirm</button>
    </div>
  </div>
</div>
```

## Interactive States

### Hover States

- Links: `hover:text-indigo-900` (from `text-indigo-600`)
- Buttons: Darker shade (e.g., `hover:bg-green-700` from `bg-green-600`)
- Cards/Rows: `hover:bg-gray-50`
- Icon buttons: `hover:bg-gray-100`

### Focus States

All interactive elements must have visible focus indicators:

```css
focus:outline-none focus:ring-2 focus:ring-[color] focus:ring-offset-2
```

### Disabled States

```css
disabled:opacity-50 disabled:cursor-not-allowed
```

### Loading States

```html
<!-- Skeleton Loader -->
<div class="animate-pulse">
  <div class="h-4 bg-gray-200 rounded w-3/4"></div>
  <div class="space-y-3 mt-4">
    <div class="h-4 bg-gray-200 rounded"></div>
    <div class="h-4 bg-gray-200 rounded w-5/6"></div>
  </div>
</div>

<!-- Loading Spinner -->
<div class="flex justify-center p-4">
  <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
</div>
```

## Icons

### Icon Library

Use Heroicons (24px outline variants) for consistency:

```html
<HomeIcon class="h-5 w-5" aria-hidden="true" />
```

### Standard Sizes

- Navigation: `h-5 w-5`
- Buttons: `h-5 w-5`
- Large icons: `h-6 w-6`
- Small icons: `h-4 w-4`

### Icon Spacing

When paired with text:
```html
<span class="flex items-center">
  <HomeIcon class="h-5 w-5 mr-2" />
  Dashboard
</span>
```

## Responsive Design

### Breakpoints

```css
/* Mobile First */
sm: 640px   /* Small tablets */
md: 768px   /* Tablets and desktop */
lg: 1024px  /* Desktop */
xl: 1280px  /* Large screens */
```

### Common Patterns

```html
<!-- Hide on mobile, show on desktop -->
<div class="hidden md:block">...</div>

<!-- Show on mobile, hide on desktop -->
<div class="block md:hidden">...</div>

<!-- Responsive padding -->
<div class="px-4 py-5 sm:p-6">...</div>

<!-- Responsive text -->
<p class="text-base md:text-sm">...</p>

<!-- Responsive grid -->
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">...</div>
```

### Touch Targets

Ensure all interactive elements meet minimum touch target size:

```css
min-h-[44px] /* Minimum height for mobile touch targets */
```

## Accessibility

### Required Practices

1. **Semantic HTML**: Use appropriate HTML elements for their intended purpose
2. **ARIA Labels**: Add descriptive labels for screen readers
3. **Keyboard Navigation**: Ensure all interactive elements are keyboard accessible
4. **Focus Management**: Visible focus indicators on all interactive elements
5. **Color Contrast**: Maintain WCAG AA compliance (4.5:1 for normal text)
6. **Screen Reader Text**: Use `sr-only` class for visually hidden but accessible text

### Examples

```html
<!-- Screen reader only text -->
<span class="sr-only">Edit customer</span>

<!-- ARIA label for icon button -->
<button aria-label="Close dialog">
  <XMarkIcon class="h-5 w-5" aria-hidden="true" />
</button>

<!-- Form field with description -->
<input aria-describedby="email-description" />
<p id="email-description" class="text-xs text-gray-500">
  We'll never share your email
</p>
```

## Animation and Transitions

### Transition Classes

```css
transition-colors     /* Color changes */
transition-shadow     /* Shadow changes */
transition-all        /* All properties */
transition-transform  /* Transform changes */
```

### Duration

Use consistent timing:
```css
duration-150  /* Fast transitions (150ms) */
duration-200  /* Default (200ms) */
duration-300  /* Slow transitions (300ms) */
```

### Examples

```html
<!-- Button hover transition -->
<button class="bg-green-600 hover:bg-green-700 transition-colors duration-200">
  Save
</button>

<!-- Card hover effect -->
<div class="bg-white shadow hover:shadow-lg transition-shadow duration-200">
  <!-- Content -->
</div>
```

### Animation Guidelines

- Keep animations subtle and purposeful
- Respect `prefers-reduced-motion` user preference
- Use CSS transitions over JavaScript animations when possible
- Avoid animations that could cause motion sickness

## Component Composition

### Example: Customer Card

```html
<div class="bg-white shadow sm:rounded-lg hover:shadow-lg transition-shadow duration-200">
  <div class="px-4 py-5 sm:p-6">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-medium text-gray-900">John Doe</h3>
        <p class="mt-1 text-sm text-gray-500">john.doe@example.com</p>
      </div>
      <div class="flex items-center space-x-2">
        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          Active
        </span>
        <button class="p-1 rounded-full hover:bg-gray-100">
          <PencilIcon class="h-5 w-5 text-gray-500" />
        </button>
      </div>
    </div>
    <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <dt class="text-sm font-medium text-gray-500">Phone</dt>
        <dd class="mt-1 text-sm text-gray-900">+44 7700 900123</dd>
      </div>
      <div>
        <dt class="text-sm font-medium text-gray-500">Last Visit</dt>
        <dd class="mt-1 text-sm text-gray-900">2 days ago</dd>
      </div>
    </div>
  </div>
</div>
```

## Best Practices

1. **Consistency**: Always use existing patterns and components
2. **Mobile First**: Design for mobile, enhance for desktop
3. **Performance**: Minimize DOM elements and CSS specificity
4. **Accessibility**: Test with keyboard navigation and screen readers
5. **Documentation**: Comment complex patterns and update this guide when adding new patterns

## Pattern Updates

When adding new patterns or modifying existing ones:

1. Ensure consistency with existing patterns
2. Test across all breakpoints
3. Verify accessibility compliance
4. Update this documentation
5. Get team review before implementation

---

*Last updated: December 2024*
*Version: 1.0*