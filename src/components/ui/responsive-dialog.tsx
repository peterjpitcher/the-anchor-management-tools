'use client'

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { useIsMobile } from "@/hooks/use-media-query"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"

interface ResponsiveDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
  trigger?: React.ReactNode
}

/**
 * ResponsiveDialog - Shows as Dialog on desktop, Sheet on mobile
 */
export function ResponsiveDialog({
  open,
  onOpenChange,
  children,
  trigger,
}: ResponsiveDialogProps) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
        {children}
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      {children}
    </Dialog>
  )
}

export function ResponsiveDialogContent({
  children,
  className,
  ...props
}: React.ComponentProps<typeof SheetContent> | React.ComponentProps<typeof DialogContent>) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <SheetContent side="bottom" className={cn("max-h-[90vh]", className)} {...props}>
        {children}
      </SheetContent>
    )
  }

  return (
    <DialogContent className={className} {...props}>
      {children}
    </DialogContent>
  )
}

export function ResponsiveDialogHeader({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <SheetHeader className={className} {...props}>
        {children}
      </SheetHeader>
    )
  }

  return (
    <DialogHeader className={className} {...props}>
      {children}
    </DialogHeader>
  )
}

export function ResponsiveDialogTitle({
  children,
  className,
  ...props
}: React.ComponentProps<typeof SheetTitle> | React.ComponentProps<typeof DialogTitle>) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <SheetTitle className={className} {...props}>
        {children}
      </SheetTitle>
    )
  }

  return (
    <DialogTitle className={className} {...props}>
      {children}
    </DialogTitle>
  )
}

export function ResponsiveDialogDescription({
  children,
  className,
  ...props
}: React.ComponentProps<typeof SheetDescription> | React.ComponentProps<typeof DialogDescription>) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <SheetDescription className={className} {...props}>
        {children}
      </SheetDescription>
    )
  }

  return (
    <DialogDescription className={className} {...props}>
      {children}
    </DialogDescription>
  )
}

// Standard Dialog components (for desktop)
const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-white p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-gray-950 focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-gray-100">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-gray-500", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}