import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useClawSocket } from '../../hooks/useClawSocket'
import { CalendarView } from './CalendarView'
import { DayDetailView } from './DayDetailView'
import { ClawProfile } from '../ClawProfile'
import './styles.css'

type PanelTab = 'chat' | 'review' | 'profile'
type ReviewState = { view: 'calendar' } | { view: 'detail'; date: string }

interface PendingFile {
  path: string
  name: string
  ext: string
  size: number
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const FILE_TYPE_ICONS: Record<string, string> = {
  '.pdf': '📕',
  '.doc': '📘', '.docx': '📘',
  '.xls': '📗', '.xlsx': '📗',
  '.ppt': '📙', '.pptx': '📙',
  '.md': '📝', '.txt': '📝',
  '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️', '.gif': '🖼️', '.webp': '🖼️',
  '.mp3': '🎵', '.wav': '🎵',
  '.mp4': '🎬', '.mov': '🎬',
  '.zip': '📦', '.rar': '📦', '.7z': '📦',
  '.json': '📋', '.csv': '📋',
  '.js': '💻', '.ts': '💻', '.py': '💻', '.java': '💻',
}

function getFileIcon(ext: string): string {
  return FILE_TYPE_ICONS[ext] ?? '📄'
}

const DEFAULT_FILE_PROMPT = '帮我看看这个文件'

export function ChatPanel(): React.JSX.Element {
  const { connectionState, messages, statusText, sendMessage } = useClawSocket()
  const connected = connectionState === 'connected'
  const [inputText, setInputText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [activeTab, setActiveTab] = useState<PanelTab>('chat')
  const [reviewState, setReviewState] = useState<ReviewState>({ view: 'calendar' })
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])

  // 监听 main 进程传来的文件附件（面板已存在时的 push 通道）
  useEffect(() => {
    const cleanup = window.electronAPI.onReceiveFiles((files) => {
      setPendingFiles(files)
      setActiveTab('chat')
      setTimeout(() => inputRef.current?.focus(), 100)
    })
    return cleanup
  }, [])

  // 挂载时拉取待处理的文件附件（新窗口场景，避免 push 时 React 未挂载的 race condition）
  useEffect(() => {
    window.electronAPI.getPendingFiles().then((files) => {
      if (files && files.length > 0) {
        setPendingFiles(files)
        setActiveTab('chat')
        setTimeout(() => inputRef.current?.focus(), 100)
      }
    })
  }, [])

  // 消息列表自动滚到底部（切换 tab 回来时也需要）
  useEffect(() => {
    if (activeTab === 'chat' && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, activeTab])

  const handleSend = useCallback(() => {
    const userText = inputText.trim()
    const hasFiles = pendingFiles.length > 0

    if (!connected) return
    if (!userText && !hasFiles) return

    // 构建发送内容
    let content = ''
    if (hasFiles) {
      const filePaths = pendingFiles.map((f) => `[附件] ${f.path}`).join('\n')
      const prompt = userText || DEFAULT_FILE_PROMPT
      content = `${filePaths}\n${prompt}`
    } else {
      content = userText
    }

    sendMessage(content)
    setInputText('')
    setPendingFiles([])

    setTimeout(() => inputRef.current?.focus(), 0)
  }, [inputText, connected, sendMessage, pendingFiles])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const handleClose = useCallback(() => {
    window.electronAPI.closeWindow()
  }, [])

  const handleSwitchTab = useCallback((tab: PanelTab) => {
    setActiveTab(tab)
    if (tab === 'review') setReviewState({ view: 'calendar' })
  }, [])

  return (
    <div className="chat-panel">
      <div className="chat-panel__header">
        <div className="chat-panel__tabs">
          <button
            className={`chat-panel__tab ${activeTab === 'chat' ? 'chat-panel__tab--active' : ''}`}
            onClick={() => handleSwitchTab('chat')}
          >
            💬 对话
          </button>
          <button
            className={`chat-panel__tab ${activeTab === 'review' ? 'chat-panel__tab--active' : ''}`}
            onClick={() => handleSwitchTab('review')}
          >
            📅 回顾
          </button>
          <button
            className={`chat-panel__tab ${activeTab === 'profile' ? 'chat-panel__tab--active' : ''}`}
            onClick={() => handleSwitchTab('profile')}
          >
            🐾 Claw
          </button>
        </div>
        <button className="chat-panel__close" onClick={handleClose} title="关闭">×</button>
      </div>

      {activeTab === 'chat' ? (
        <>
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

          {statusText && (
            <div className="chat-panel__agent-status">{statusText}</div>
          )}

          <div className="chat-panel__input-area">
            {!connected && (
              <div className="chat-panel__status-bar">
                {connectionState === 'connecting' ? '连接中...' : '已断开，正在重连...'}
              </div>
            )}
            {pendingFiles.length > 0 && (
              <div className="chat-panel__file-cards">
                {pendingFiles.map((f, i) => (
                  <div key={f.path} className="file-card">
                    <span className="file-card__icon">{getFileIcon(f.ext)}</span>
                    <div className="file-card__info">
                      <span className="file-card__name">{f.name}</span>
                      <span className="file-card__meta">{f.ext.replace('.', '').toUpperCase() || '文件'} · {formatFileSize(f.size)}</span>
                    </div>
                    <button
                      className="file-card__remove"
                      onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      title="移除"
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={inputRef}
              className="chat-panel__input"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                !connected
                  ? '等待连接...'
                  : pendingFiles.length > 0
                    ? DEFAULT_FILE_PROMPT
                    : '输入消息... (Enter 发送, Shift+Enter 换行)'
              }
              rows={1}
              disabled={!connected}
            />
            <button
              className="chat-panel__send"
              onClick={handleSend}
              disabled={(!inputText.trim() && pendingFiles.length === 0) || !connected}
              title="发送"
            >
              ↑
            </button>
          </div>
        </>
      ) : activeTab === 'review' ? (
        <div className="chat-panel__review">
          {reviewState.view === 'calendar' ? (
            <CalendarView onSelectDate={(date) => setReviewState({ view: 'detail', date })} />
          ) : (
            <DayDetailView
              date={reviewState.date}
              onBack={() => setReviewState({ view: 'calendar' })}
            />
          )}
        </div>
      ) : (
        <ClawProfile />
      )}
    </div>
  )
}
