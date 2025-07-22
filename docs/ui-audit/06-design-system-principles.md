# Design System Principles

## Core Principles

### 1. **Consistency**
> "Same problem, same solution, everywhere."

- Predictable patterns reduce cognitive load
- Users learn once, apply everywhere
- Developers build faster with established patterns

### 2. **Clarity**
> "Make the right thing obvious, the wrong thing difficult."

- Clear visual hierarchy
- Intuitive interactions
- Self-documenting interfaces

### 3. **Efficiency**
> "Optimize for the common case, accommodate the edge case."

- Fast task completion
- Minimal clicks/taps
- Smart defaults

### 4. **Accessibility**
> "Usable by everyone, excluding no one."

- WCAG 2.1 AA compliance minimum
- Keyboard navigation throughout
- Screen reader optimized
- Color contrast compliant

### 5. **Flexibility**
> "Consistent but not uniform."

- Composable components
- Themeable design tokens
- Extensible patterns

## Visual Language

### Color System

#### Brand Colors
```scss
// Primary - Green (maintaining existing brand)
$primary-50: #f0fdf4;
$primary-100: #dcfce7;
$primary-200: #bbf7d0;
$primary-300: #86efac;
$primary-400: #4ade80;
$primary-500: #22c55e;
$primary-600: #16a34a;  // Main brand color
$primary-700: #15803d;
$primary-800: #166534;
$primary-900: #14532d;

// Neutral - Gray
$gray-50: #f9fafb;
$gray-100: #f3f4f6;
$gray-200: #e5e7eb;
$gray-300: #d1d5db;
$gray-400: #9ca3af;
$gray-500: #6b7280;
$gray-600: #4b5563;
$gray-700: #374151;
$gray-800: #1f2937;
$gray-900: #111827;
```

#### Semantic Colors
```scss
// Status Colors
$success: $primary-600;
$warning: #f59e0b;
$error: #dc2626;
$info: #3b82f6;

// Surface Colors
$background: #ffffff;
$surface: #ffffff;
$surface-raised: #f9fafb;
$surface-overlay: rgba(0, 0, 0, 0.5);
```

### Typography

#### Font Stack
```scss
$font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, 
            "Helvetica Neue", Arial, sans-serif;
$font-mono: Menlo, Monaco, Consolas, "Liberation Mono", 
            "Courier New", monospace;
```

#### Type Scale
```scss
// Using rem units for accessibility
$text-xs: 0.75rem;    // 12px
$text-sm: 0.875rem;   // 14px
$text-base: 1rem;     // 16px
$text-lg: 1.125rem;   // 18px
$text-xl: 1.25rem;    // 20px
$text-2xl: 1.5rem;    // 24px
$text-3xl: 1.875rem;  // 30px
$text-4xl: 2.25rem;   // 36px

// Line Heights
$leading-tight: 1.25;
$leading-normal: 1.5;
$leading-relaxed: 1.625;

// Font Weights
$font-normal: 400;
$font-medium: 500;
$font-semibold: 600;
$font-bold: 700;
```

### Spacing System

#### Base Unit: 4px
```scss
$space-0: 0;        // 0px
$space-1: 0.25rem;  // 4px
$space-2: 0.5rem;   // 8px
$space-3: 0.75rem;  // 12px
$space-4: 1rem;     // 16px
$space-5: 1.25rem;  // 20px
$space-6: 1.5rem;   // 24px
$space-8: 2rem;     // 32px
$space-10: 2.5rem;  // 40px
$space-12: 3rem;    // 48px
$space-16: 4rem;    // 64px
$space-20: 5rem;    // 80px
$space-24: 6rem;    // 96px
```

### Layout System

#### Breakpoints
```scss
$breakpoint-sm: 640px;   // Mobile landscape
$breakpoint-md: 768px;   // Tablet
$breakpoint-lg: 1024px;  // Desktop
$breakpoint-xl: 1280px;  // Wide desktop
$breakpoint-2xl: 1536px; // Ultra-wide
```

#### Container Widths
```scss
$container-sm: 640px;
$container-md: 768px;
$container-lg: 1024px;
$container-xl: 1280px;
```

#### Grid System
- 12-column grid on desktop
- 4-column grid on tablet
- 2-column grid on mobile
- Gap: $space-4 (16px) default

### Elevation System

#### Shadows
```scss
$shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
$shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
$shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
$shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
$shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
```

#### Z-Index Scale
```scss
$z-base: 0;
$z-dropdown: 1000;
$z-sticky: 1020;
$z-fixed: 1030;
$z-modal-backdrop: 1040;
$z-modal: 1050;
$z-popover: 1060;
$z-tooltip: 1070;
```

### Motion System

#### Duration
```scss
$duration-fast: 150ms;
$duration-base: 250ms;
$duration-slow: 350ms;
$duration-slower: 500ms;
```

#### Easing
```scss
$ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
$ease-out: cubic-bezier(0, 0, 0.2, 1);
$ease-in: cubic-bezier(0.4, 0, 1, 1);
```

## Component Design Patterns

### States

#### Interactive States
1. **Default** - Resting state
2. **Hover** - Mouse over (desktop only)
3. **Focus** - Keyboard navigation
4. **Active** - Being pressed
5. **Disabled** - Not interactive
6. **Loading** - Async operation

#### Validation States
1. **Valid** - Green border/text
2. **Invalid** - Red border/text
3. **Warning** - Yellow indicators
4. **Info** - Blue indicators

### Responsive Behavior

#### Mobile-First Approach
```scss
// Base styles (mobile)
.component {
  padding: $space-3;
  font-size: $text-base;
}

// Tablet and up
@media (min-width: $breakpoint-md) {
  .component {
    padding: $space-4;
    font-size: $text-sm;
  }
}
```

#### Touch Targets
- Minimum 44px × 44px (iOS/Android guideline)
- Spacing between targets: minimum 8px
- Larger targets for primary actions

### Accessibility Standards

#### Color Contrast
- Normal text: 4.5:1 minimum
- Large text: 3:1 minimum
- Non-text: 3:1 minimum

#### Keyboard Navigation
- All interactive elements focusable
- Logical tab order
- Skip links for navigation
- Escape key closes modals

#### Screen Readers
- Semantic HTML
- ARIA labels where needed
- Live regions for updates
- Descriptive link text

### Content Guidelines

#### Voice & Tone
- **Clear**: Use simple, direct language
- **Helpful**: Guide users to success
- **Professional**: Maintain business context
- **Friendly**: Approachable, not robotic

#### Writing Principles
1. **Scannable**: Headers, bullets, short paragraphs
2. **Action-Oriented**: Start with verbs
3. **Specific**: Avoid vague language
4. **Consistent**: Same terms throughout

#### Error Messages
```
Structure: [What happened] + [Why] + [How to fix]

Good: "Unable to save booking. The selected date is in the past. Please choose a future date."
Bad: "Error: Invalid date"
```

## Implementation Guidelines

### Component Structure
```tsx
// Component file structure
components/
  Button/
    Button.tsx         // Component logic
    Button.styles.ts   // Styled components
    Button.test.tsx    // Unit tests
    Button.stories.tsx // Storybook stories
    index.ts          // Public exports
    README.md         // Documentation
```

### Naming Conventions

#### Components
- PascalCase: `DataTable`, `FormInput`
- Descriptive: What it is, not what it does
- Consistent suffixes: `*Modal`, `*Button`, `*Card`

#### Props
- camelCase: `isLoading`, `hasError`
- Boolean props: `is*`, `has*`, `should*`
- Event handlers: `on*`

#### CSS Classes
- BEM-inspired: `component__element--modifier`
- Utility classes: `u-text-center`, `u-mt-4`
- State classes: `is-active`, `has-error`

### Documentation Standards

#### Component Documentation
1. **Purpose**: What problem it solves
2. **Usage**: When and how to use
3. **Props**: Complete API reference
4. **Examples**: Common use cases
5. **Accessibility**: Special considerations
6. **Related**: Similar components

#### Code Comments
```tsx
/**
 * DataTable displays tabular data with sorting, filtering, and pagination.
 * 
 * @example
 * <DataTable
 *   columns={columns}
 *   data={users}
 *   onRowClick={(user) => navigate(`/users/${user.id}`)}
 * />
 */
```

## Quality Checklist

### Before Component Release
- [ ] Follows design system principles
- [ ] Responsive across breakpoints
- [ ] Accessible (keyboard, screen reader)
- [ ] Documented with examples
- [ ] Unit tests written
- [ ] Storybook story created
- [ ] Performance optimized
- [ ] Cross-browser tested

### Design Review Criteria
- [ ] Consistent with existing patterns
- [ ] Solves a real user need
- [ ] Flexible for various use cases
- [ ] Maintainable code structure
- [ ] Following naming conventions

## Evolution Process

### Proposing Changes
1. Document the problem
2. Research existing solutions
3. Design multiple options
4. Get stakeholder feedback
5. Build prototype
6. Test with users
7. Implement if approved

### Deprecation Process
1. Mark as deprecated in code
2. Document migration path
3. Support for 2 major versions
4. Automated migration where possible
5. Remove in major version

### Contribution Guidelines
- Fork and pull request workflow
- Include tests and documentation
- Follow code style guide
- Get design review first
- Update changelog

## Conclusion
This design system provides the foundation for building consistent, accessible, and maintainable user interfaces across the Anchor Management Tools application. By following these principles and patterns, we ensure a cohesive experience for users and an efficient development process for the team.