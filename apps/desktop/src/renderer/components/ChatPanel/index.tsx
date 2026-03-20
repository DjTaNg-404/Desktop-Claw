import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useClawSocket } from '../../hooks/useClawSocket'
import './styles.css'

export function ChatPanel(): React.JSX.Element {
  const { connected, messages, sendMessage } = useClawSocket()
  const [inputText, setInputText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 消息列表自动滚到底部
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = useCallback(() => {
    const text = inputText.trim()
    if (!text || !connected) return

    sendMessage(text)
    setInputText('')

    setTimeout(() => inputRef.current?.focus(), 0)
  }, [inputText, connected, sendMessage])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  return (
    <div className="chat-panel">
      <div className="chat-panel__header">
        <span className="chat-panel__title">Claw 🐾</span>
      </div>

      <div className="chat-panel__messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-panel__empty">
            有什么可以帮你的？🐾
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-msg chat-msg--${msg.role}`}
          >
            <div className="chat-msg__bubble">
              {msg.content}
              {msg.streaming && <span className="chat-msg__cursor" />}
            </div>
          </div>
        ))}
      </div>

      <div className="chat-panel__input-area">
        <textarea
          ref={inputRef}
          className="chat-panel__input"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={connected ? '输入消息... (Enter 发送, Shift+Enter 换行)' : '连接中...'}
          rows={1}
          disabled={!connected}
        />
        <button
          className="chat-panel__send"
          onClick={handleSend}
          disabled={!inputText.trim() || !connected}
          title="发送"
        >
          ↑
        </button>
      </div>
    </div>
  )
}
