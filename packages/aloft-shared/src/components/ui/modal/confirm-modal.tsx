'use client'

import * as React from 'react'
import { AlertTriangle, CheckCircle, Info, XCircle } from 'lucide-react'
import { Modal, ModalProps } from './modal'
import { Button } from '../button'

interface ConfirmModalProps extends Omit<ModalProps, 'children'> {
  variant?: 'info' | 'success' | 'warning' | 'danger'
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  message?: React.ReactNode
}

const variantConfig = {
  info: {
    icon: Info,
    color: 'text-blue-600',
    bgColor: 'bg-blue-600',
    buttonVariant: 'primary' as const
  },
  success: {
    icon: CheckCircle,
    color: 'text-green-600',
    bgColor: 'bg-green-600',
    buttonVariant: 'primary' as const
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-600',
    buttonVariant: 'primary' as const
  },
  danger: {
    icon: XCircle,
    color: 'text-red-600',
    bgColor: 'bg-red-600',
    buttonVariant: 'primary' as const
  }
}

export function ConfirmModal({
  variant = 'info',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  message,
  ...props
}: ConfirmModalProps) {
  const config = variantConfig[variant]
  const Icon = config.icon

  const footer = (
    <div className="flex justify-end space-x-3 p-6 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-b-xl">
      <Button
        variant="outline"
        onClick={props.onClose}
      >
        {cancelLabel}
      </Button>
      <Button
        variant={config.buttonVariant}
        onClick={() => {
          onConfirm()
          props.onClose()
        }}
      >
        {confirmLabel}
      </Button>
    </div>
  )

  return (
    <Modal
      maxWidth="sm"
      icon={<Icon className="h-5 w-5" />}
      footer={footer}
      {...props}
    >
      {message && (
        <div className="text-gray-600 dark:text-gray-300">
          {message}
        </div>
      )}
    </Modal>
  )
}
