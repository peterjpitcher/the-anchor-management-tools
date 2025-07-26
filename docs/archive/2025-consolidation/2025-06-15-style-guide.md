# UI/UX Style Guide

This document outlines the styling conventions and design principles used throughout The Anchor Management Tools to ensure a consistent and user-friendly experience.

## Design Principles

### Core Values
- **Clarity**: Information should be immediately understandable
- **Consistency**: Similar elements behave similarly throughout
- **Efficiency**: Common tasks should be quick to complete
- **Accessibility**: Usable by all staff members
- **Responsiveness**: Works perfectly on all devices

## Visual Design

### Color Palette

#### Primary Colors
- **Primary**: Blue (`blue-600` / `#2563eb`)
- **Primary Hover**: Darker Blue (`blue-700` / `#1d4ed8`)
- **Primary Light**: Light Blue (`blue-50` / `#eff6ff`)

#### Semantic Colors
- **Success**: Green (`green-600` / `#16a34a`)
- **Warning**: Yellow (`yellow-600` / `#ca8a04`)
- **Error**: Red (`red-600` / `#dc2626`)
- **Info**: Blue (`blue-600` / `#2563eb`)

#### Neutral Colors
- **Text Primary**: Gray 900 (`gray-900` / `#111827`)
- **Text Secondary**: Gray 500 (`gray-500` / `#6b7280`)
- **Border**: Gray 300 (`gray-300` / `#d1d5db`)
- **Background**: White (`white` / `#ffffff`)
- **Background Alt**: Gray 50 (`gray-50` / `#f9fafb`)

### Typography

#### Font Family
- System font stack for optimal performance
- `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`

#### Font Sizes
- **Heading 1**: `text-2xl` (24px)
- **Heading 2**: `text-xl` (20px)
- **Heading 3**: `text-lg` (18px)
- **Body**: `text-base` (16px)
- **Small**: `text-sm` (14px)
- **Tiny**: `text-xs` (12px)

#### Font Weights
- **Bold**: `font-bold` (700)
- **Semibold**: `font-semibold` (600)
- **Medium**: `font-medium` (500)
- **Normal**: `font-normal` (400)

### Spacing

#### Standard Scale
- `space-1`: 0.25rem (4px)
- `space-2`: 0.5rem (8px)
- `space-3`: 0.75rem (12px)
- `space-4`: 1rem (16px)
- `space-5`: 1.25rem (20px)
- `space-6`: 1.5rem (24px)
- `space-8`: 2rem (32px)

#### Component Spacing
- Card padding: `p-4 sm:p-6`
- Section spacing: `space-y-6`
- Form field spacing: `space-y-4`
- Button group spacing: `space-x-3`

## Component Patterns

### Layout Structure

#### Page Container
```html
<div class="min-h-screen bg-gray-50">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="space-y-6">
      <!-- Page content -->
    </div>
  </div>
</div>
```

#### Card Component
```html
<div class="bg-white shadow sm:rounded-lg">
  <div class="px-4 py-5 sm:p-6">
    <!-- Card content -->
  </div>
</div>
```

### Page Headers

#### Standard Header
```html
<div class="bg-white shadow sm:rounded-lg">
  <div class="px-4 py-5 sm:p-6">
    <div class="flex justify-between items-center">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Page Title</h1>
        <p class="mt-1 text-sm text-gray-500">
          Page description or subtitle
        </p>
      </div>
      <div class="flex space-x-3">
        <!-- Action buttons -->
      </div>
    </div>
  </div>
</div>
```

#### Mobile-Responsive Header
```html
<div class="flex flex-col space-y-4 sm:flex-row sm:justify-between sm:items-center sm:space-y-0">
  <!-- Header content -->
</div>
```

### Forms

#### Form Layout
```html
<form class="space-y-4">
  <div class="sm:grid sm:grid-cols-3 sm:gap-4 sm:items-start">
    <label class="block text-sm font-medium text-gray-700 sm:pt-2">
      Field Label
    </label>
    <div class="mt-1 sm:mt-0 sm:col-span-2">
      <input type="text" class="...">
    </div>
  </div>
</form>
```

#### Input Styling
```html
<input 
  type="text" 
  class="block w-full rounded-md border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
>
```

### Buttons

#### Primary Button
```html
<button class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
  Button Text
</button>
```

#### Secondary Button
```html
<button class="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
  Button Text
</button>
```

#### Danger Button
```html
<button class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500">
  Delete
</button>
```

### Tables

#### Desktop Table
```html
<div class="hidden md:block">
  <table class="min-w-full divide-y divide-gray-200">
    <thead class="bg-gray-50">
      <tr>
        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
          Column Header
        </th>
      </tr>
    </thead>
    <tbody class="bg-white divide-y divide-gray-200">
      <tr>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
          Cell Content
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

#### Mobile List View
```html
<div class="md:hidden">
  <ul class="divide-y divide-gray-200">
    <li class="px-4 py-4">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium text-gray-900">Primary Info</p>
          <p class="text-sm text-gray-500">Secondary Info</p>
        </div>
        <div>
          <!-- Actions -->
        </div>
      </div>
    </li>
  </ul>
</div>
```

### Detail Views

#### Definition List
```html
<dl class="divide-y divide-gray-200">
  <div class="py-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:py-5">
    <dt class="text-sm font-medium text-gray-500">
      Field Label
    </dt>
    <dd class="mt-1 text-sm text-gray-900 sm:col-span-2 sm:mt-0">
      Field Value
    </dd>
  </div>
</dl>
```

## Mobile Responsiveness

### Breakpoints
- `sm`: 640px and up
- `md`: 768px and up
- `lg`: 1024px and up
- `xl`: 1280px and up

### Mobile-First Approach
Always design for mobile first, then enhance for larger screens:
```html
<!-- Mobile first -->
<div class="flex flex-col sm:flex-row">
  <!-- Stacks on mobile, side-by-side on desktop -->
</div>
```

### Responsive Patterns

#### Navigation
- Desktop: Sidebar navigation
- Mobile: Bottom tab navigation

#### Tables
- Desktop: Full table display
- Mobile: Card-based list view

#### Forms
- Desktop: Multi-column layout
- Mobile: Single column stack

#### Modals
- Desktop: Centered modal
- Mobile: Full-screen overlay

## Accessibility

### Focus States
All interactive elements must have visible focus states:
```css
focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
```

### Color Contrast
- Text on background: Minimum 4.5:1 ratio
- Large text: Minimum 3:1 ratio
- Use tools to verify contrast

### Semantic HTML
- Use proper heading hierarchy
- Label all form inputs
- Provide alt text for images
- Use ARIA labels where needed

### Keyboard Navigation
- All functionality keyboard accessible
- Logical tab order
- Skip links for navigation
- Escape key closes modals

## Icons

### Usage Guidelines
- Use sparingly for clarity
- Always include text labels
- Consistent sizing (w-5 h-5)
- Match text color

### Common Icons
- Add: Plus icon
- Edit: Pencil icon
- Delete: Trash icon
- Close: X icon
- Menu: Bars icon

## Loading States

### Skeleton Screens
Show content structure while loading:
```html
<div class="animate-pulse">
  <div class="h-4 bg-gray-200 rounded w-3/4"></div>
  <div class="space-y-3 mt-4">
    <div class="h-4 bg-gray-200 rounded"></div>
    <div class="h-4 bg-gray-200 rounded w-5/6"></div>
  </div>
</div>
```

### Spinners
For short operations:
```html
<svg class="animate-spin h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24">
  <!-- Spinner SVG -->
</svg>
```

## Error States

### Form Errors
```html
<input class="... border-red-300 focus:border-red-500 focus:ring-red-500">
<p class="mt-2 text-sm text-red-600">Error message here</p>
```

### Empty States
```html
<div class="text-center py-12">
  <p class="text-sm text-gray-500">No items found</p>
  <button class="mt-4 ...">Add First Item</button>
</div>
```

## Animation

### Transitions
Use subtle transitions for better UX:
- `transition-colors duration-150`
- `transition-all duration-200`
- `transition-opacity duration-300`

### Motion Guidelines
- Keep animations subtle
- Use for feedback and guidance
- Respect prefers-reduced-motion
- Consistent timing functions

## Best Practices

### Do's
- ✅ Maintain consistent spacing
- ✅ Use semantic color names
- ✅ Test on multiple devices
- ✅ Follow accessibility guidelines
- ✅ Keep interfaces simple

### Don'ts
- ❌ Mix inline styles with classes
- ❌ Create custom colors unnecessarily
- ❌ Ignore mobile users
- ❌ Use color alone for meaning
- ❌ Over-animate interfaces

## Testing Checklist

- [ ] Works on mobile devices
- [ ] Keyboard navigation functional
- [ ] Color contrast passes
- [ ] Focus states visible
- [ ] Loading states present
- [ ] Error states clear
- [ ] Consistent spacing
- [ ] Responsive breakpoints work