'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '6xl' | '7xl'
  showCloseButton?: boolean
  closeOnClickOutside?: boolean
  closeOnEsc?: boolean
  className?: string
  headerClassName?: string
  bodyClassName?: string
}

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-4xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl'
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  maxWidth = 'md',
  showCloseButton = true,
  closeOnClickOutside = true,
  closeOnEsc = true,
  className,
  headerClassName,
  bodyClassName
}: ModalProps) {
  // Handle ESC key
  React.useEffect(() => {
    if (!closeOnEsc) return

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEsc)
    }

    return () => {
      document.removeEventListener('keydown', handleEsc)
    }
  }, [isOpen, onClose, closeOnEsc])

  // Handle scroll lock
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={closeOnClickOutside ? onClose : undefined}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className={cn(
          'relative z-10 w-full mx-4 bg-white dark:bg-gray-800 rounded-xl shadow-xl',
          maxWidthClasses[maxWidth],
          className
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        {(title || description || icon || showCloseButton) && (
          <div
            className={cn(
              'flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700',
              headerClassName
            )}
          >
            <div className="flex items-center space-x-3">
              {icon && (
                <div className="p-2 bg-orange-600 rounded-lg">
                  {React.cloneElement(icon as React.ReactElement, {
                    className: cn('h-5 w-5 text-white', (icon as React.ReactElement).props.className)
                  })}
                </div>
              )}
              <div>
                {title && (
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    {title}
                  </h2>
                )}
                {description && (
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {description}
                  </p>
                )}
              </div>
            </div>
            {showCloseButton && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onClose()
                }}
                className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className={cn('p-6 max-h-[calc(85vh-180px)] overflow-y-auto', bodyClassName)}>
          {children}
        </div>

        {/* Footer - fixed at bottom */}
        {footer}
      </div>
    </div>
  )
}
