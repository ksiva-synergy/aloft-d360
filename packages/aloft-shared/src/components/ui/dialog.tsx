import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

export interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

export interface DialogContentProps {
  children: React.ReactNode
  className?: string
}

export interface DialogHeaderProps {
  children: React.ReactNode
  className?: string
}

export interface DialogTitleProps {
  children: React.ReactNode
}

export interface DialogDescriptionProps {
  children: React.ReactNode
  className?: string
  ref?: React.Ref<HTMLDivElement>
}

export interface DialogFooterProps {
  children: React.ReactNode
  className?: string
}

export interface DialogTriggerProps {
  children: React.ReactNode
  asChild?: boolean
}

const Dialog = ({ open, onOpenChange, children }: DialogProps) => {
  const [isAnimating, setIsAnimating] = React.useState(false)
  const [shouldRender, setShouldRender] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setShouldRender(true)
      let cancelled = false
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) setIsAnimating(true)
        })
      })
      const fallback = setTimeout(() => {
        if (!cancelled) setIsAnimating(true)
      }, 50)
      return () => { cancelled = true; cancelAnimationFrame(id); clearTimeout(fallback) }
    } else {
      setIsAnimating(false)
      const timer = setTimeout(() => {
        setShouldRender(false)
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [open])

  React.useEffect(() => {
    if (!open) return

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange?.(false)
      }
    }

    document.addEventListener('keydown', handleEsc)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    
    return () => {
      document.removeEventListener('keydown', handleEsc)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onOpenChange])

  React.useEffect(() => {
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  if (!shouldRender) return null
  
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        className={cn(
          "absolute inset-0 bg-black/40 backdrop-blur-[4px] transition-opacity ease-out-strong",
          isAnimating ? "opacity-100 duration-dialog" : "opacity-0 duration-[150ms]"
        )}
        onClick={() => onOpenChange?.(false)}
      />
      <div 
        onClick={(e) => e.stopPropagation()}
        className={cn(
        "relative z-10 w-full flex items-center justify-center transition-[opacity,transform] ease-out-strong",
        isAnimating
          ? "opacity-100 scale-100 translate-y-0 duration-dialog"
          : "opacity-0 scale-[0.97] translate-y-2 duration-[150ms]"
      )}>
        {children}
      </div>
    </div>,
    document.body
  )
}

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative bg-[var(--surface-1)] text-[var(--ink-1)] p-6 shadow-dialog rounded-dialog border border-[var(--line-1)] max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
)
DialogContent.displayName = "DialogContent"

const DialogHeader = ({ children, className }: DialogHeaderProps) => (
  <div className={cn("mb-4", className)}>{children}</div>
)

const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2
      ref={ref}
      className={cn("text-title-card", className)}
      {...props}
    />
  )
)
DialogTitle.displayName = "DialogTitle"

const DialogDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-size-body text-[var(--ink-2)]", className)}
    {...props}
  />
))
DialogDescription.displayName = "DialogDescription"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end mt-5",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTrigger = React.forwardRef<HTMLButtonElement, DialogTriggerProps>(
  ({ children, asChild = false, ...props }, ref) => {
    if (asChild) {
      return <>{children}</>
    }
    return (
      <button
        ref={ref}
        type="button"
        className="inline-flex items-center justify-center rounded-md text-size-body font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
        {...props}
      >
        {children}
      </button>
    )
  }
)
DialogTrigger.displayName = "DialogTrigger"

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger }
