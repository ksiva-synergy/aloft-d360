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
      primary: 'bg-[var(--brand-a)] text-[var(--on-brand)] shadow-xs hover:bg-[color-mix(in_srgb,var(--brand-a)_88%,black)] active:bg-[color-mix(in_srgb,var(--brand-a)_80%,black)]',
      secondary: 'bg-[var(--surface-2)] text-[var(--ink-1)] border border-[var(--line-1)] hover:bg-[var(--surface-3)]',
      outline: 'border border-[var(--line-2)] bg-[var(--surface-1)] text-[var(--ink-1)] shadow-xs hover:bg-[var(--surface-2)] hover:border-[color-mix(in_srgb,var(--ink-3)_45%,var(--line-2))]',
      ghost: 'text-[var(--ink-2)] hover:bg-[color-mix(in_srgb,var(--ink-1)_6%,transparent)] hover:text-[var(--ink-1)]',
      destructive: 'bg-[var(--destructive)] text-white shadow-xs hover:bg-[color-mix(in_srgb,var(--destructive)_88%,black)]',
      default: 'bg-[var(--brand-a)] text-[var(--on-brand)] shadow-xs hover:bg-[color-mix(in_srgb,var(--brand-a)_88%,black)]',
      icon: 'text-[var(--ink-2)] hover:bg-[color-mix(in_srgb,var(--ink-1)_6%,transparent)] hover:text-[var(--ink-1)]',
    }

    const sizes = {
      xs: 'h-7 px-2.5 text-ui',
      sm: 'h-8 px-3 text-ui',
      md: 'h-9 px-3.5 text-ui',
      lg: 'h-10 px-4 text-ui-lg',
      xl: 'h-11 px-5 text-ui-lg',
      icon: 'h-8 w-8 p-0',
    }

    const buttonClassName = cn(
      "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-ctl font-medium select-none",
      "transition-[background-color,border-color,color,box-shadow,transform] duration-hover ease-out-strong",
      "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
      "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
      "active:scale-[0.97] active:duration-press",
      variants[variant],
      sizes[variant === 'icon' ? 'icon' : size],
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