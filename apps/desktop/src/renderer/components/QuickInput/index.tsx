import React, { useRef, useEffect, useCallback } from 'react'
import './styles.css'

interface Props {
  onSend: (text: string) => void
  onClose: () => void
}

export function QuickInput({ onSend, onClose }: Props): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 60)
    return () => clearTimeout(timer)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const text = inputRef.current?.value.trim()
        if (text) {
          onSend(text)
          if (inputRef.current) inputRef.current.value = ''
        }
      } else if (e.key === 'Escape') {
        onClose()
      }
    },
    [onSend, onClose]
  )

  const handleMouseEnter = useCallback(() => {
    window.electronAPI.setIgnoreMouseEvents(false)
  }, [])

  const handleMouseLeave = useCallback(() => {
    window.electronAPI.setIgnoreMouseEvents(true)
  }, [])

  return (
    <div
      className="quick-input"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <input
        ref={inputRef}
        className="quick-input__field"
        type="text"
        placeholder="说点什么..."
        onKeyDown={handleKeyDown}
      />
    </div>
  )
}
