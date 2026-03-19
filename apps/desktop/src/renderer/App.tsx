import React from 'react'
import { FloatingBall } from './components/FloatingBall'
import { ChatPanel } from './components/ChatPanel'

const view = new URLSearchParams(window.location.search).get('view')

function App(): React.JSX.Element {
  if (view === 'panel') return <ChatPanel />
  return <FloatingBall />
}

export default App
