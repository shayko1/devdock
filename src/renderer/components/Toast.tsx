import React, { useEffect } from 'react'

interface Props {
  message: string
  type?: 'info' | 'success' | 'error'
  onDismiss: () => void
}

export function Toast({ message, type = 'info', onDismiss }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <div className={`toast toast-${type}`} onClick={onDismiss}>
      {message}
    </div>
  )
}
