import React, { useState, useEffect, useCallback } from 'react'
import { backendFetch } from '../../lib/backend-client'
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

interface CalendarViewProps {
  onSelectDate: (date: string) => void
}

export function CalendarView({ onSelectDate }: CalendarViewProps): React.JSX.Element {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth()) // 0-indexed
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set())

  useEffect(() => {
    backendFetch('/calendar/dates')
      .then((r) => r.json())
      .then((data: { dates: string[] }) => setAvailableDates(new Set(data.dates)))
      .catch((err) => console.error('[calendar] failed to fetch dates:', err))
  }, [])

  const prevMonth = useCallback(() => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11) }
    else setMonth((m) => m - 1)
  }, [month])

  const nextMonth = useCallback(() => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0) }
    else setMonth((m) => m + 1)
  }, [month])

  // 生成当月日历格
  const firstDay = new Date(year, month, 1)
  // 周一 = 0, 周日 = 6
  const startWeekday = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const cells: Array<{ day: number; dateStr: string } | null> = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ day: d, dateStr })
  }

  return (
    <div className="calendar-view">
      <div className="calendar-view__nav">
        <button className="calendar-view__nav-btn" onClick={prevMonth}>←</button>
        <span className="calendar-view__month">{year}年{month + 1}月</span>
        <button className="calendar-view__nav-btn" onClick={nextMonth}>→</button>
      </div>

      <div className="calendar-view__grid">
        {WEEKDAYS.map((w) => (
          <div key={w} className="calendar-view__weekday">{w}</div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={`empty-${i}`} className="calendar-view__cell calendar-view__cell--empty" />
          const isToday = cell.dateStr === todayStr
          const hasRecord = availableDates.has(cell.dateStr)
          const clickable = hasRecord || isToday
          return (
            <div
              key={cell.dateStr}
              className={[
                'calendar-view__cell',
                isToday && 'calendar-view__cell--today',
                hasRecord && 'calendar-view__cell--has-record',
                clickable && 'calendar-view__cell--clickable'
              ].filter(Boolean).join(' ')}
              title={hasRecord ? '查看当日回忆' : isToday ? '查看今日对话' : undefined}
              onClick={clickable ? () => onSelectDate(cell.dateStr) : undefined}
            >
              <span className="calendar-view__day">{cell.day}</span>
              {hasRecord && <span className="calendar-view__dot" />}
              {isToday && !hasRecord && <span className="calendar-view__dot calendar-view__dot--today" />}
            </div>
          )
        })}
      </div>

      <div className="calendar-view__hint">点击有标记的日期查看当日回忆 💭</div>
    </div>
  )
}
