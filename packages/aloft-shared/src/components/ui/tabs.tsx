"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center gap-0.5 rounded-[10px] border border-[var(--line-1)] bg-[var(--surface-2)] p-[3px] text-[var(--ink-3)]",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] px-3 text-ui",
      "transition-[background-color,color,box-shadow] duration-hover ease-out-strong",
      "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
      "disabled:pointer-events-none disabled:opacity-50",
      "data-[state=inactive]:hover:text-[var(--ink-1)]",
      "data-[state=active]:bg-[var(--surface-1)] data-[state=active]:text-[var(--ink-1)] data-[state=active]:shadow-xs",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-3 rounded-ctl focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
      "animate-in fade-in-0 duration-pop",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
