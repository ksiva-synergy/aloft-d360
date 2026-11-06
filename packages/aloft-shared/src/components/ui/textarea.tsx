import * as React from "react"

import { cn } from "@/lib/utils"

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full px-3 py-2 text-size-ui bg-[var(--surface-1)] text-[var(--ink-1)] border border-[var(--line-2)] rounded-ctl shadow-xs placeholder:text-[var(--ink-3)] transition-[border-color,box-shadow] duration-hover ease-out-strong hover:border-[color-mix(in_srgb,var(--ink-3)_45%,var(--line-2))] focus:outline-none focus-visible:outline-none focus:border-[var(--brand-a)] focus:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
