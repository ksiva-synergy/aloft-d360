'use client'

import React, { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'default' | 'icon'
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'icon' | 'xs'
  loading?: boolean
  icon?: React.ReactNode
  inlineChildren?: boolean
  asChild?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, icon, children, disabled, inlineChildren = true, asChild, ...props }, ref) => {
    const variants = {
      primary: 'bg-orange-600 hover:bg-orange-700 active:bg-orange-800 dark:bg-[var(--primary)] dark:hover:bg-[#6cb6ff] text-white shadow-sm hover:shadow-md',
      secondary: 'bg-slate-600 hover:bg-slate-700 active:bg-slate-800 dark:bg-[var(--muted)] dark:hover:bg-[var(--table-row-hover-dark)] text-white dark:text-[var(--text-primary)] shadow-sm hover:shadow-md',
      outline: 'border border-slate-300 dark:border-[var(--border)] bg-white dark:bg-[var(--card)] text-slate-700 dark:text-[var(--text-primary)] hover:bg-slate-50 dark:hover:bg-[var(--table-row-hover-dark)] hover:border-slate-400 dark:hover:border-[var(--border-hover)]',
      ghost: 'hover:bg-slate-100 dark:hover:bg-[var(--table-row-hover-dark)] hover:text-slate-900 dark:hover:text-[var(--text-primary)]',
      destructive: 'bg-red-600 hover:bg-red-700 active:bg-red-800 text-white shadow-sm hover:shadow-md',
      default: 'bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white shadow-sm hover:shadow-md',
      icon: 'h-8 w-8 p-0 hover:bg-slate-100 dark:hover:bg-[var(--table-row-hover-dark)]',
    }

    const sizes = {
      xs: 'px-2 py-1 text-xs',
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2',
      lg: 'px-6 py-3 text-lg',
      xl: 'px-8 py-4 text-xl',
      icon: 'h-8 w-8 p-0',
    }

    const buttonClassName = cn(
      "rounded-lg font-medium transition-all duration-200 ease-out",
      "flex items-center justify-center gap-2",
      "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
      "active:scale-[0.97]",
      variants[variant],
      sizes[size],
      className
    )

    // If asChild is true, clone the child element and merge props
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children as React.ReactElement, {
        className: cn(buttonClassName, (children as React.ReactElement).props?.className),
        disabled: disabled || loading,
        ref,
        ...props
      })
    }

    return (
      <button
        className={buttonClassName}
        disabled={disabled || loading}
        ref={ref}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : icon}
        {children && (inlineChildren ? <>{children}</> : <span>{children}</span>)}
      </button>
    )
  }
)

Button.displayName = 'Button'

export { Button }