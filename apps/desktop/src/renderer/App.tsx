import React, { useState } from 'react'

// window.electronAPI 由 preload/index.ts 通过 contextBridge 注入
declare global {
  interface Window {
    electronAPI: {
      ping: () => Promise<string>
    }
  }
}

function App(): React.JSX.Element {
  const [reply, setReply] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const handlePing = async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await window.electronAPI.ping()
      setReply(result)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        margin: 0,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        background: '#1a1a2e',
        userSelect: 'none'
      }}
    >
      <h1 style={{ color: '#e0e0ff', fontSize: 32, margin: 0, letterSpacing: 1 }}>
        Hello, Claw 🐾
      </h1>
      <p style={{ color: '#7070aa', marginTop: 12, fontSize: 13 }}>
        Desktop-Claw · Milestone 0
      </p>

      <button
        onClick={handlePing}
        disabled={loading}
        style={{
          marginTop: 32,
          padding: '10px 28px',
          background: '#4a4aaa',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontSize: 14,
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.6 : 1
        }}
      >
        {loading ? '等待回应...' : 'Ping Main Process'}
      </button>

      {reply && (
        <p style={{ marginTop: 16, color: '#88ff88', fontSize: 14 }}>
          ✅ {reply}
        </p>
      )}
    </div>
  )
}

export default App
