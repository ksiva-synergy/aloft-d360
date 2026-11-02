'use client'

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <input
        className={cn(
          "h-9 w-full px-3 text-size-ui",
          "bg-[var(--surface-1)] text-[var(--ink-1)] border border-[var(--line-2)] rounded-ctl shadow-xs placeholder:text-[var(--ink-3)]",
          "transition-[border-color,box-shadow] duration-hover ease-out-strong hover:border-[color-mix(in_srgb,var(--ink-3)_45%,var(--line-2))]",
          "focus:outline-none focus:border-[var(--brand-a)] focus:shadow-[var(--focus-ring)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-[var(--bad)] focus:border-[var(--bad)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--bad)_20%,transparent)]",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'

export { Input }