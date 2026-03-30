import React, { useState, useEffect } from 'react'
import { backendFetch } from '../../lib/backend-client'
import './styles.css'

/** SOUL.md 中允许展示的章节 */
const SOUL_VISIBLE_SECTIONS = ['我是谁', '性格基调', '与用户的关系']

interface PersonaData {
  soul: string | null
  user: string | null
  context: string | null
}

interface SoulSection {
  title: string
  content: string
}

interface KeyValue {
  key: string
  value: string
}

interface UserGroup {
  title: string
  items: KeyValue[]
}

interface ContextBlock {
  title: string
  lines: string[]
}

/* ── 解析工具 ──────────────────────────────────────── */

/** 从 SOUL.md 提取白名单章节 */
function parseSoul(raw: string): SoulSection[] {
  const sections: SoulSection[] = []
  const parts = raw.split(/^## /m).slice(1) // 按 ## 分割，跳过首段
  for (const part of parts) {
    const newlineIdx = part.indexOf('\n')
    if (newlineIdx === -1) continue
    const title = part.slice(0, newlineIdx).trim()
    if (!SOUL_VISIBLE_SECTIONS.includes(title)) continue
    const content = part.slice(newlineIdx + 1).trim()
    sections.push({ title, content })
  }
  return sections
}

/** 从性格基调段落提取标签（**粗体**开头的条目） */
function extractTraits(content: string): string[] {
  const matches = content.match(/\*\*(.+?)\*\*/g)
  if (!matches) return []
  return matches.map((m) => m.replace(/\*\*/g, ''))
}

/** 从 USER.md 提取分组的 key-value */
function parseUser(raw: string): UserGroup[] {
  const groups: UserGroup[] = []
  let currentGroup: UserGroup | null = null

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    // >  开头的引用行跳过
    if (trimmed.startsWith('>')) continue

    // # 一级标题跳过，## 二级标题作为分组
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) continue
    const h2Match = trimmed.match(/^##\s+(.+)$/)
    if (h2Match) {
      currentGroup = { title: h2Match[1], items: [] }
      groups.push(currentGroup)
      continue
    }

    // **粗体标题** 行（不含 ：或 : 的独立粗体行作为分组标题）
    const groupMatch = trimmed.match(/^\*\*(.+?)\*\*$/)
    if (groupMatch) {
      currentGroup = { title: groupMatch[1], items: [] }
      groups.push(currentGroup)
      continue
    }

    // - **key**：value 或 - **key**: value
    const kvMatch = trimmed.match(/^-\s*\*\*(.+?)\*\*[：:]\s*(.+)$/)
    if (kvMatch) {
      if (!currentGroup) {
        currentGroup = { title: '基本信息', items: [] }
        groups.push(currentGroup)
      }
      currentGroup.items.push({ key: kvMatch[1], value: kvMatch[2] })
      continue
    }

    // - key：value 或 - key: value（无粗体格式）
    const plainKvMatch = trimmed.match(/^-\s*(.+?)[：:]\s*(.+)$/)
    if (plainKvMatch) {
      if (!currentGroup) {
        currentGroup = { title: '基本信息', items: [] }
        groups.push(currentGroup)
      }
      currentGroup.items.push({ key: plainKvMatch[1], value: plainKvMatch[2] })
    }
  }

  return groups.filter((g) => g.items.length > 0)
}

/** 从 CONTEXT.md 提取区块 */
function parseContext(raw: string): ContextBlock[] {
  const blocks: ContextBlock[] = []
  let currentBlock: ContextBlock | null = null

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('>') || trimmed.startsWith('#')) continue

    // **粗体标题** 行
    const titleMatch = trimmed.match(/^\*\*(.+?)\*\*$/)
    if (titleMatch) {
      currentBlock = { title: titleMatch[1], lines: [] }
      blocks.push(currentBlock)
      continue
    }

    // 有内容的行
    if (trimmed && currentBlock) {
      // 去掉列表前缀
      const cleaned = trimmed.replace(/^-\s*/, '')
      if (cleaned) currentBlock.lines.push(cleaned)
    }
  }

  return blocks.filter((b) => b.lines.length > 0)
}

/** 判断内容是否为空模板 */
function isEmptyTemplate(raw: string | null): boolean {
  if (!raw) return true
  // 去掉标题、引用、空行后，剩余有效内容 < 30 字符认为是空模板
  const meaningful = raw
    .split('\n')
    .filter((l) => !l.startsWith('#') && !l.startsWith('>') && l.trim().length > 0)
    .join('')
  return meaningful.length < 30
}

/* ── 组件 ──────────────────────────────────────────── */

export function ClawProfile(): React.JSX.Element {
  const [data, setData] = useState<PersonaData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    backendFetch('/persona')
      .then((r) => r.json())
      .then((d: PersonaData) => setData(d))
      .catch((err) => console.error('[profile] failed to fetch persona:', err))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="claw-profile__loading">加载中...</div>
  }

  if (!data) {
    return <div className="claw-profile__empty">暂无数据</div>
  }

  const soulSections = data.soul ? parseSoul(data.soul) : []
  const userGroups = !isEmptyTemplate(data.user) ? parseUser(data.user!) : []
  const contextBlocks = !isEmptyTemplate(data.context) ? parseContext(data.context!) : []

  return (
    <div className="claw-profile">
      {/* ── Claw 卡片 ── */}
      {soulSections.length > 0 && (
        <div className="claw-profile__card">
          <div className="claw-profile__card-title">🐾 Claw</div>
          {soulSections.map((section) => (
            <div key={section.title} className="claw-profile__section">
              {section.title === '性格基调' ? (
                <div className="claw-profile__traits">
                  {extractTraits(section.content).map((trait) => (
                    <span key={trait} className="claw-profile__trait-badge">{trait}</span>
                  ))}
                </div>
              ) : section.title === '我是谁' ? (
                <p className="claw-profile__intro">
                  {section.content.split('\n').filter(Boolean)[0]}
                </p>
              ) : (
                <div className="claw-profile__section-block">
                  <div className="claw-profile__section-label">{section.title}</div>
                  {section.content.split('\n').filter(Boolean).map((line, i) => (
                    <p key={i} className="claw-profile__text">
                      {line.replace(/^-\s*/, '')}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── 关于你 卡片 ── */}
      <div className="claw-profile__card">
        <div className="claw-profile__card-title">🧑 关于你</div>
        {userGroups.length > 0 ? (
          userGroups.map((group) => (
            <div key={group.title} className="claw-profile__group">
              <div className="claw-profile__group-label">{group.title}</div>
              <div className="claw-profile__kv-list">
                {group.items.map((item) => (
                  <div key={item.key} className="claw-profile__kv">
                    <span className="claw-profile__kv-key">{item.key}</span>
                    <span className="claw-profile__kv-value">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className="claw-profile__placeholder">还在了解你中...</p>
        )}
      </div>

      {/* ── 最近认知 卡片 ── */}
      <div className="claw-profile__card">
        <div className="claw-profile__card-title">🧠 最近认知</div>
        {contextBlocks.length > 0 ? (
          contextBlocks.map((block) => (
            <div key={block.title} className="claw-profile__group">
              <div className="claw-profile__group-label">{block.title}</div>
              <ul className="claw-profile__list">
                {block.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p className="claw-profile__placeholder">暂无动态认知</p>
        )}
      </div>
    </div>
  )
}
