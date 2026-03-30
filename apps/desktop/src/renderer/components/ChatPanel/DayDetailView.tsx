import React, { useState, useEffect } from 'react'
import { backendFetch } from '../../lib/backend-client'

interface DaySummary {
  diary: string | null
  summary: string | null
  facts: string[] | null
  messageCount: number
}

interface PersistedMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  ts: string
}

interface DayDetailViewProps {
  date: string
  onBack: () => void
}

export function DayDetailView({ date, onBack }: DayDetailViewProps): React.JSX.Element {
  const [summaryData, setSummaryData] = useState<DaySummary | null>(null)
  const [messages, setMessages] = useState<PersistedMessage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      backendFetch(`/calendar/${date}`).then((r) => (r.ok ? r.json() : null)),
      backendFetch(`/calendar/${date}/messages`).then((r) => (r.ok ? r.json() : null))
    ])
      .then(([sum, msg]) => {
        if (sum) setSummaryData(sum)
        if (msg?.messages) setMessages(msg.messages)
      })
      .catch((err) => console.error('[calendar] failed to load day:', err))
      .finally(() => setLoading(false))
  }, [date])

  // 友好日期显示
  const displayDate = date.replace(/-/g, '/')

  if (loading) {
    return (
      <div className="day-detail">
        <div className="day-detail__header">
          <button className="day-detail__back" onClick={onBack}>← 返回日历</button>
          <span className="day-detail__date">{displayDate}</span>
        </div>
        <div className="day-detail__loading">加载中...</div>
      </div>
    )
  }

  const hasSummary = summaryData && (summaryData.diary || summaryData.summary || summaryData.facts)
  const visibleMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant')

  return (
    <div className="day-detail">
      <div className="day-detail__header">
        <button className="day-detail__back" onClick={onBack}>← 返回日历</button>
        <span className="day-detail__date">{displayDate}</span>
      </div>

      <div className="day-detail__content">
        {!hasSummary && (
          <div className="day-detail__no-summary">
            今日对话进行中，尚未生成回顾 🐾
          </div>
        )}

        {summaryData?.diary && (
          <div className="day-detail__section day-detail__diary">
            <div className="day-detail__section-title">🐾 Claw 的回忆</div>
            <div className="day-detail__diary-text">{summaryData.diary}</div>
          </div>
        )}

        {summaryData?.summary && (
          <div className="day-detail__section">
            <div className="day-detail__section-title">📋 当日摘要</div>
            <div className="day-detail__section-body">{summaryData.summary}</div>
          </div>
        )}

        {summaryData?.facts && summaryData.facts.length > 0 && (
          <div className="day-detail__section">
            <div className="day-detail__section-title">💡 关键信息</div>
            <ul className="day-detail__facts">
              {summaryData.facts.map((fact, i) => (
                <li key={i}>{fact}</li>
              ))}
            </ul>
          </div>
        )}

        {visibleMessages.length > 0 && (
          <>
            <div className="day-detail__divider">
              <span>💬 完整对话（{visibleMessages.length} 条）</span>
            </div>
            <div className="day-detail__messages">
              {visibleMessages.map((msg, i) => (
                <div key={i} className={`chat-msg chat-msg--${msg.role}`}>
                  <div className="chat-msg__bubble">
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {visibleMessages.length === 0 && !hasSummary && (
          <div className="day-detail__empty">这天没有对话记录</div>
        )}
      </div>
    </div>
  )
}
