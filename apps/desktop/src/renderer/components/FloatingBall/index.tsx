import React, { useState, useRef, useCallback, useEffect } from 'react'
import { ChatBubble } from '../ChatBubble'
import { QuickInput } from '../QuickInput'
import './styles.css'

const GREETINGS = [
  '在呢～',
  '有什么需要帮忙的吗？',
  '今天怎么样？',
  '嗨～',
  '我在这里 🐾',
  '今天辛苦了！',
  '需要我做点什么吗？',
  '😊',
  '你好呀～',
  '陪着你呢'
]

interface QuickInputState {
  visible: boolean
  direction: 'left' | 'right'
}

export function FloatingBall(): React.JSX.Element {
  const [bubble, setBubble] = useState<{ id: number; text: string } | null>(null)
  const [qiState, setQiState] = useState<QuickInputState | null>(null)
  const movedRef = useRef(false)
  const isDraggingRef = useRef(false)
  const bubbleIdRef = useRef(0)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ballRef = useRef<HTMLDivElement>(null)
  const listenersRef = useRef<{ onMove: () => void; onUp: (e: MouseEvent) => void } | null>(null)

  const isQiVisible = qiState?.visible ?? false

  useEffect(() => {
    return () => {
      if (listenersRef.current) {
        window.removeEventListener('mousemove', listenersRef.current.onMove)
        window.removeEventListener('mouseup', listenersRef.current.onUp)
        listenersRef.current = null
      }
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current)
      }
    }
  }, [])

  const showBubble = useCallback((text: string) => {
    bubbleIdRef.current += 1
    setBubble({ id: bubbleIdRef.current, text })
  }, [])

  const handleSingleClick = useCallback(() => {
    const text = GREETINGS[Math.floor(Math.random() * GREETINGS.length)]
    showBubble(text)
  }, [showBubble])

  const toggleQuickInput = useCallback(async () => {
    const state = await window.electronAPI.toggleQuickInput()
    setQiState(state)
  }, [])

  const handleQuickSend = useCallback(
    (text: string) => {
      showBubble(`收到「${text}」🐾`)
    },
    [showBubble]
  )

  const handleBubbleDismiss = useCallback(() => {
    setBubble(null)
  }, [])

  const handleMouseEnter = useCallback(() => {
    window.electronAPI.setIgnoreMouseEvents(false)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (!isDraggingRef.current) {
      window.electronAPI.setIgnoreMouseEvents(true)
    }
  }, [])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault()

      movedRef.current = false
      isDraggingRef.current = true
      window.electronAPI.dragStart()

      const onMove = (): void => {
        movedRef.current = true
        window.electronAPI.dragMove()
      }

      const onUp = (ev: MouseEvent): void => {
        window.electronAPI.dragEnd()
        isDraggingRef.current = false

        const rect = ballRef.current?.getBoundingClientRect()
        if (rect) {
          const isOver =
            ev.clientX >= rect.left &&
            ev.clientX <= rect.right &&
            ev.clientY >= rect.top &&
            ev.clientY <= rect.bottom
          if (!isOver) {
            window.electronAPI.setIgnoreMouseEvents(true)
          }
        }

        if (movedRef.current && isQiVisible) {
          // QI 展开态拖拽结束 → 重算方向
          window.electronAPI.repositionQuickInput().then((result) => {
            if (result) {
              setQiState({ visible: true, direction: result.direction })
            }
          })
        } else if (!movedRef.current) {
          if (isQiVisible) {
            // QI 展开态单击 → 收起
            toggleQuickInput()
          } else if (clickTimerRef.current) {
            clearTimeout(clickTimerRef.current)
            clickTimerRef.current = null
            toggleQuickInput()
          } else {
            clickTimerRef.current = setTimeout(() => {
              clickTimerRef.current = null
              handleSingleClick()
            }, 250)
          }
        }

        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        listenersRef.current = null
      }

      listenersRef.current = { onMove, onUp }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [isQiVisible, toggleQuickInput, handleSingleClick]
  )

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    window.electronAPI.showContextMenu()
  }, [])

  const expanded = isQiVisible
  const direction = qiState?.direction ?? 'left'

  return (
    <div className={`ball-root${expanded ? ` ball-root--expanded ball-root--${direction}` : ''}`}>
      {expanded && direction === 'left' && (
        <div className="qi-area">
          <QuickInput onSend={handleQuickSend} onClose={toggleQuickInput} />
        </div>
      )}
      <div className="ball-column">
        <div className="bubble-area">
          {bubble && (
            <ChatBubble
              key={bubble.id}
              message={bubble}
              duration={3000}
              onDismiss={handleBubbleDismiss}
            />
          )}
        </div>
        <div
          ref={ballRef}
          className="ball"
          onMouseDown={handleMouseDown}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onContextMenu={handleContextMenu}
          title="Claw 🐾"
        >
          <span className="ball__icon">🐾</span>
        </div>
      </div>
      {expanded && direction === 'right' && (
        <div className="qi-area">
          <QuickInput onSend={handleQuickSend} onClose={toggleQuickInput} />
        </div>
      )}
    </div>
  )
}
