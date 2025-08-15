# shadcn/ui Component Patterns

## Overview
This document outlines the shadcn/ui components integrated into the Anchor Management Tools and the patterns for using them effectively, particularly for mobile-first responsive design.

## Component Library

### Core Components

#### 1. Sheet (Mobile Drawer)
- **Location**: `/src/components/ui/sheet.tsx`
- **Use Case**: Bottom drawers, mobile navigation, side panels
- **Pattern**: Replace modals on mobile for better UX
```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

// Bottom drawer pattern for mobile
<Sheet open={open} onOpenChange={setOpen}>
  <SheetContent side="bottom" className="h-auto max-h-[80vh] rounded-t-xl">
    <SheetHeader>
      <SheetTitle>Title</SheetTitle>
    </SheetHeader>
    {/* Content */}
  </SheetContent>
</Sheet>
```

#### 2. ResponsiveDialog (Desktop Dialog, Mobile Sheet)
- **Location**: `/src/components/ui/responsive-dialog.tsx`
- **Use Case**: Forms, confirmations, content that needs different mobile/desktop treatment
```tsx
import { ResponsiveDialog } from '@/components/ui/responsive-dialog'

<ResponsiveDialog open={open} onOpenChange={setOpen}>
  {/* Automatically renders as Dialog on desktop, Sheet on mobile */}
</ResponsiveDialog>
```

#### 3. ScrollArea
- **Location**: `/src/components/ui/scroll-area.tsx`
- **Use Case**: Long lists, scrollable content within constrained areas
```tsx
import { ScrollArea } from '@/components/ui/scroll-area'

<ScrollArea className="h-[300px]">
  {/* Long content */}
</ScrollArea>
```

#### 4. Accordion
- **Location**: `/src/components/ui/accordion.tsx`
- **Use Case**: FAQ sections, collapsible content, mobile-friendly data display
```tsx
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'

<Accordion type="single" collapsible>
  <AccordionItem value="item-1">
    <AccordionTrigger>Question</AccordionTrigger>
    <AccordionContent>Answer</AccordionContent>
  </AccordionItem>
</Accordion>
```

#### 5. Tabs
- **Location**: `/src/components/ui/tabs.tsx`
- **Use Case**: Navigation between related content, mobile-optimized tab switching
```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

<Tabs defaultValue="tab1">
  <TabsList>
    <TabsTrigger value="tab1">Tab 1</TabsTrigger>
    <TabsTrigger value="tab2">Tab 2</TabsTrigger>
  </TabsList>
  <TabsContent value="tab1">Content 1</TabsContent>
  <TabsContent value="tab2">Content 2</TabsContent>
</Tabs>
```

#### 6. Card
- **Location**: `/src/components/ui/card.tsx`
- **Use Case**: Mobile data display, content grouping, list items
```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Description</CardDescription>
  </CardHeader>
  <CardContent>
    {/* Content */}
  </CardContent>
</Card>
```

#### 7. Skeleton
- **Location**: `/src/components/ui/skeleton.tsx`
- **Use Case**: Loading states, content placeholders
```tsx
import { Skeleton } from '@/components/ui/skeleton'

<Skeleton className="h-4 w-[200px]" />
```

#### 8. Toast
- **Location**: `/src/components/ui/toast.tsx`
- **Use Case**: Notifications, feedback messages
```tsx
import { useToast } from '@/components/ui/use-toast'

const { toast } = useToast()
toast({
  title: "Success",
  description: "Operation completed",
})
```

#### 9. Button
- **Location**: `/src/components/ui/button.tsx`
- **Use Case**: All interactive buttons with consistent styling
```tsx
import { Button } from '@/components/ui/button'

<Button variant="default" size="default">
  Click me
</Button>
```

## Mobile-First Patterns

### 1. Responsive Table/Card Pattern
Use `ResponsiveTable` component for automatic switching between table (desktop) and card (mobile) views:
```tsx
import { ResponsiveTable } from '@/components/ui/ResponsiveTable'

<ResponsiveTable
  data={data}
  columns={columns}
  mobileCardClassName="space-y-4"
/>
```

### 2. Bottom Navigation with Drawer
Primary navigation items (max 4) in bottom nav, secondary items in Sheet drawer:
```tsx
// BottomNavigation automatically splits items
// First 4 items → Bottom nav
// Remaining items → "More" drawer using Sheet component
```

### 3. Touch-Optimized Forms
Forms automatically stack vertically on mobile with proper touch targets:
```tsx
// FormActions component handles responsive layout
<FormActions>
  <Button>Cancel</Button>
  <Button>Save</Button>
</FormActions>
// Renders as flex-col on mobile, flex-row on desktop
```

### 4. Loading States
Use Skeleton components for consistent loading UI:
```tsx
{loading ? (
  <>
    <Skeleton className="h-10 w-full mb-4" />
    <Skeleton className="h-20 w-full" />
  </>
) : (
  <ActualContent />
)}
```

## Utility Hooks

### useMediaQuery
Detect viewport size for responsive behavior:
```tsx
import { useMediaQuery, useIsMobile } from '@/hooks/use-media-query'

const isMobile = useIsMobile() // true if < 640px
const isTablet = useMediaQuery('(min-width: 768px)')
```

## Configuration

### components.json
Configuration for shadcn/ui:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "src/app/globals.css",
    "baseColor": "gray",
    "cssVariables": false,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

### Tailwind Integration
Required plugins and configuration:
```js
// tailwind.config.js
module.exports = {
  // ... existing config
  plugins: [require("tailwindcss-animate")],
  theme: {
    extend: {
      keyframes: {
        "accordion-down": { /* ... */ },
        "accordion-up": { /* ... */ },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
}
```

## Best Practices

1. **Mobile-First Design**: Always design for mobile first, then enhance for desktop
2. **Touch Targets**: Ensure all interactive elements are at least 44px for touch
3. **Loading States**: Always show loading feedback using Skeleton components
4. **Responsive Dialogs**: Use ResponsiveDialog for forms that need different mobile/desktop treatment
5. **Drawer Pattern**: Use Sheet component for mobile drawers instead of traditional modals
6. **Scrollable Content**: Wrap long lists in ScrollArea for better mobile scrolling
7. **Collapsible Content**: Use Accordion for dense information on mobile
8. **Tab Navigation**: Use Tabs for related content switching on mobile

## Migration Guide

### From Custom Components to shadcn/ui

1. **Drawer → Sheet**: Replace custom drawer implementations with Sheet component
2. **Modal → ResponsiveDialog**: Use ResponsiveDialog for automatic mobile/desktop switching
3. **Custom Cards → Card**: Use Card component for consistent styling
4. **Custom Buttons → Button**: Replace with Button component for consistency
5. **Custom Loading → Skeleton**: Use Skeleton for loading states

## Adding New shadcn/ui Components

```bash
# Manual installation pattern (since npx shadcn-ui init doesn't work)
1. Copy component from shadcn/ui GitHub
2. Place in /src/components/ui/
3. Update imports to match project structure
4. Add any required Radix UI dependencies:
   npm install @radix-ui/react-[component-name]
```

## Component Dependencies

Current Radix UI packages installed:
- @radix-ui/react-accordion
- @radix-ui/react-dialog  
- @radix-ui/react-scroll-area
- @radix-ui/react-slot
- @radix-ui/react-tabs
- @radix-ui/react-toast

Additional utilities:
- class-variance-authority (cva)
- clsx
- tailwind-merge
- tailwindcss-animate