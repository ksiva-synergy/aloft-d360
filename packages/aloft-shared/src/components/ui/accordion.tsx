"use client"

import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface AccordionContextValue {
  type: "single" | "multiple"
  value: string | string[]
  onValueChange: (value: string) => void
}

const AccordionContext = React.createContext<AccordionContextValue | null>(null)

interface AccordionProps {
  type?: "single" | "multiple"
  value?: string | string[]
  defaultValue?: string | string[]
  onValueChange?: (value: string | string[]) => void
  className?: string
  children: React.ReactNode
}

const Accordion = React.forwardRef<HTMLDivElement, AccordionProps>(
  ({ type = "single", value, defaultValue, onValueChange, className, children, ...props }, ref) => {
    const [internalValue, setInternalValue] = React.useState<string | string[]>(
      defaultValue ?? (type === "multiple" ? [] : "")
    )

    const currentValue = value !== undefined ? value : internalValue

    const handleValueChange = React.useCallback((itemValue: string) => {
      let newValue: string | string[]

      if (type === "multiple") {
        const currentArray = Array.isArray(currentValue) ? currentValue : []
        if (currentArray.includes(itemValue)) {
          newValue = currentArray.filter(v => v !== itemValue)
        } else {
          newValue = [...currentArray, itemValue]
        }
      } else {
        newValue = currentValue === itemValue ? "" : itemValue
      }

      if (value === undefined) {
        setInternalValue(newValue)
      }
      onValueChange?.(newValue)
    }, [type, currentValue, value, onValueChange])

    return (
      <AccordionContext.Provider value={{ type, value: currentValue, onValueChange: handleValueChange }}>
        <div ref={ref} className={cn("w-full", className)} {...props}>
          {children}
        </div>
      </AccordionContext.Provider>
    )
  }
)
Accordion.displayName = "Accordion"

interface AccordionItemContextValue {
  value: string
  isOpen: boolean
}

const AccordionItemContext = React.createContext<AccordionItemContextValue | null>(null)

interface AccordionItemProps {
  value: string
  className?: string
  children: React.ReactNode
}

const AccordionItem = React.forwardRef<HTMLDivElement, AccordionItemProps>(
  ({ value, className, children, ...props }, ref) => {
    const accordionContext = React.useContext(AccordionContext)
    if (!accordionContext) {
      throw new Error("AccordionItem must be used within an Accordion")
    }

    const isOpen = Array.isArray(accordionContext.value)
      ? accordionContext.value.includes(value)
      : accordionContext.value === value

    return (
      <AccordionItemContext.Provider value={{ value, isOpen }}>
        <div
          ref={ref}
          className={cn("border-b", className)}
          {...props}
        >
          {children}
        </div>
      </AccordionItemContext.Provider>
    )
  }
)
AccordionItem.displayName = "AccordionItem"

interface AccordionTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string
  children: React.ReactNode
}

const AccordionTrigger = React.forwardRef<HTMLButtonElement, AccordionTriggerProps>(
  ({ className, children, ...props }, ref) => {
    const accordionContext = React.useContext(AccordionContext)
    const itemContext = React.useContext(AccordionItemContext)

    if (!accordionContext || !itemContext) {
      throw new Error("AccordionTrigger must be used within an AccordionItem")
    }

    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "flex flex-1 items-center justify-between py-4 font-medium transition-all hover:underline w-full text-left",
          className
        )}
        onClick={() => accordionContext.onValueChange(itemContext.value)}
        aria-expanded={itemContext.isOpen}
        {...props}
      >
        {children}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-200",
            itemContext.isOpen && "rotate-180"
          )}
        />
      </button>
    )
  }
)
AccordionTrigger.displayName = "AccordionTrigger"

interface AccordionContentProps {
  className?: string
  children: React.ReactNode
}

const AccordionContent = React.forwardRef<HTMLDivElement, AccordionContentProps>(
  ({ className, children, ...props }, ref) => {
    const itemContext = React.useContext(AccordionItemContext)

    if (!itemContext) {
      throw new Error("AccordionContent must be used within an AccordionItem")
    }

    if (!itemContext.isOpen) {
      return null
    }

    return (
      <div
        ref={ref}
        className={cn(
          "overflow-hidden text-sm transition-all",
          "pb-4 pt-0",
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }
)
AccordionContent.displayName = "AccordionContent"

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
