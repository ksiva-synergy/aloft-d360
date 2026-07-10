'use client'

import * as React from 'react'
import { Modal, ModalProps } from './modal'
import { Button } from '../button'
import { Loader2 } from 'lucide-react'

interface FormModalProps extends Omit<ModalProps, 'children' | 'footer'> {
  submitLabel?: string
  cancelLabel?: string
  onSubmit?: () => void | Promise<void>
  isSubmitting?: boolean
  submitDisabled?: boolean
  children: React.ReactNode
  footer?: React.ReactNode
  hideDefaultFooter?: boolean
}

export function FormModal({
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  onSubmit = async () => {},
  isSubmitting = false,
  submitDisabled = false,
  children,
  footer,
  hideDefaultFooter = false,
  ...props
}: FormModalProps) {
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit()
  }

  const defaultFooter = !hideDefaultFooter ? (
    <div className="flex justify-end space-x-3 p-6 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-b-xl">
      <Button
        type="button"
        variant="outline"
        onClick={props.onClose}
        disabled={isSubmitting}
      >
        {cancelLabel}
      </Button>
      <Button
        type="submit"
        form="form-modal-form"
        disabled={isSubmitting || submitDisabled}
        icon={isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
      >
        {submitLabel}
      </Button>
    </div>
  ) : null

  return (
    <Modal {...props} footer={footer || defaultFooter}>
      <form id="form-modal-form" onSubmit={handleSubmit} className="space-y-6">
        {children}
      </form>
    </Modal>
  )
}
