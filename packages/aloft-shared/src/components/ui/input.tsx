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
          "w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg",
          "bg-white dark:bg-slate-700 text-slate-900 dark:text-white",
          "focus:ring-2 focus:ring-orange-500 focus:border-transparent",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          error && "border-red-500 focus:ring-red-500",
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