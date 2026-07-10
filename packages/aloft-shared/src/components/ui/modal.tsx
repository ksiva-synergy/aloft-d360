'use client'

import { ReactNode } from 'react'
import { X } from 'lucide-react'

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  icon?: ReactNode
  children: ReactNode
  footer?: ReactNode
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '6xl' | '7xl'
  showCloseButton?: boolean
  closeOnClickOutside?: boolean
  closeOnEsc?: boolean
  className?: string
  headerClassName?: string
  bodyClassName?: string
}

const maxWidthClasses: Record<string, string> = {
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
  className,
  bodyClassName
}: ModalProps) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={closeOnClickOutside ? onClose : undefined}
    >
      <div
        className={`bg-white dark:bg-slate-800 rounded-xl w-full max-h-[90vh] overflow-hidden ${maxWidthClasses[maxWidth]} ${className || ''}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-3">
            {icon && (
              <div className="bg-orange-600 p-2 rounded-lg">
                {icon}
              </div>
            )}
            <div>
              {title && (
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
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
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onClose()
              }}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className={`p-6 max-h-[calc(85vh-180px)] overflow-y-auto ${bodyClassName || ''}`}>
          {children}
        </div>
        {footer}
      </div>
    </div>
  )
}
