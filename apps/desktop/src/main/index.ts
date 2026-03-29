import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { startBackend, copyInitialTemplates } from '@desktop-claw/backend'

let ballWin: BrowserWindow | null = null
let panelWin: BrowserWindow | null = null
let settingsWin: BrowserWindow | null = null
let backendHandle: { close: () => Promise<void>; sealDay: () => Promise<void> } | null = null

/** 拖拽时记录光标相对于窗口左上角的偏移量 */
let dragOffset = { x: 0, y: 0 }

/** 计算数据目录：dev 用项目内 data/，prod 用 Application Support */
function resolveDataDir(): string {
  if (app.isPackaged) {
    return join(app.getPath('userData'), 'data')
  }
  // dev: 项目根目录 data/（__dirname = apps/desktop/out/main/）
  return join(__dirname, '..', '..', '..', '..', 'data')
}

/** 悬浮球窗口尺寸（含气泡区域） */
const BALL_WIN_W = 240
const BALL_WIN_H = 340

function createBallWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  // 默认位置：球出现在屏幕右下角
  const defaultX = width - 60 - Math.round(BALL_WIN_W / 2)
  const defaultY = height - 60 - (BALL_WIN_H - 36)

  // 从 config 恢复上次位置，超出屏幕则 fallback 到默认
  let x = defaultX
  let y = defaultY
  const saved = readConfig().ballPosition as { x: number; y: number } | undefined
  if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
    const inBounds =
      saved.x >= -BALL_WIN_W / 2 &&
      saved.x <= width - BALL_WIN_W / 2 &&
      saved.y >= 0 &&
      saved.y <= height - 40
    if (inBounds) {
      x = saved.x
      y = saved.y
    }
  }

  ballWin = new BrowserWindow({
    width: BALL_WIN_W,
    height: BALL_WIN_H,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // sandbox 关闭原因：electron-vite preload 打包依赖 Node.js require 机制
      // 仅通过 contextBridge 暴露最小 IPC 通道，不在渲染进程直接使用 Node API
      sandbox: false
    }
  })

  // floating 层级 — macOS 浮于普通窗口之上不遮挡全屏；Windows 无此层级参数
  if (process.platform === 'darwin') {
    ballWin.setAlwaysOnTop(true, 'floating')
  } else {
    ballWin.setAlwaysOnTop(true)
  }

  // 透明区域点击穿透，forward: true 保留 mousemove 以触发 mouseenter/leave
  ballWin.setIgnoreMouseEvents(true, { forward: true })

  ballWin.on('ready-to-show', () => ballWin?.show())

  ballWin.on('closed', () => {
    ballWin = null
  })

  if (process.env['NODE_ENV'] === 'development' && process.env['ELECTRON_RENDERER_URL']) {
    ballWin.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    ballWin.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── IPC: 悬浮球拖拽 ────────────────────────────────────────
ipcMain.on('drag:start', () => {
  if (!ballWin) return
  const cursor = screen.getCursorScreenPoint()
  const [wx, wy] = ballWin.getPosition()
  dragOffset = { x: cursor.x - wx, y: cursor.y - wy }
})

ipcMain.on('drag:move', () => {
  if (!ballWin) return
  const { x, y } = screen.getCursorScreenPoint()
  ballWin.setPosition(
    Math.round(x - dragOffset.x),
    Math.round(y - dragOffset.y)
  )
})

ipcMain.on('drag:end', () => {
  if (!ballWin) return
  const [bx, by] = ballWin.getPosition()
  const existing = readConfig()
  writeConfig({ ...existing, ballPosition: { x: bx, y: by } })
})

// ── IPC: 透明区域点击穿透 ──────────────────────────────────
ipcMain.on('set-ignore-mouse-events', (_event, ignore: boolean) => {
  if (!ballWin) return
  if (ignore) {
    ballWin.setIgnoreMouseEvents(true, { forward: true })
  } else {
    ballWin.setIgnoreMouseEvents(false)
  }
})

// ── IPC: 调试 ──────────────────────────────────────────────
ipcMain.handle('ipc:ping', () => {
  console.log('[main] received ping from renderer')
  return 'pong from main 🐾'
})

// ── IPC: QuickInput 条形输入框 ─────────────────────────────
let quickInputVisible = false
let savedBallBounds: Electron.Rectangle | null = null
let qiDirection: 'left' | 'right' = 'left'
const EXPANDED_W = 420
const BALL_EDGE_OFFSET = 40 // 球中心距最近窗口边缘的距离

ipcMain.handle('quickinput:toggle', () => {
  if (!ballWin) return { visible: false, direction: 'left' }

  if (quickInputVisible) {
    // 收起：恢复原始窗口尺寸与位置
    if (savedBallBounds) {
      ballWin.setBounds(savedBallBounds)
      savedBallBounds = null
    }
    quickInputVisible = false
    ballWin.setIgnoreMouseEvents(true, { forward: true })
    return { visible: false, direction: 'left' }
  }

  // 展开：计算方向并扩大窗口
  const bounds = ballWin.getBounds()
  savedBallBounds = { ...bounds }

  const ballScreenCenterX = bounds.x + Math.round(BALL_WIN_W / 2)
  const display = screen.getDisplayNearestPoint({
    x: ballScreenCenterX,
    y: bounds.y + Math.round(bounds.height / 2)
  })
  const screenCenterX = display.workArea.x + Math.round(display.workArea.width / 2)
  const direction: 'left' | 'right' = ballScreenCenterX > screenCenterX ? 'left' : 'right'

  let newX: number
  if (direction === 'left') {
    // 球在右侧，输入框向左展开
    newX = ballScreenCenterX - (EXPANDED_W - BALL_EDGE_OFFSET)
  } else {
    // 球在左侧，输入框向右展开
    newX = ballScreenCenterX - BALL_EDGE_OFFSET
  }

  ballWin.setBounds({
    x: Math.round(newX),
    y: bounds.y,
    width: EXPANDED_W,
    height: BALL_WIN_H
  })

  quickInputVisible = true
  qiDirection = direction
  return { visible: true, direction }
})

// 拖拽结束后，若 QuickInput 处于展开态，根据新位置重算方向
ipcMain.handle('quickinput:reposition', () => {
  if (!ballWin || !quickInputVisible) return null

  const bounds = ballWin.getBounds()

  // 当前球在窗口内的屏幕中心 X（取决于当前 direction）
  // direction=left → 球列在窗口右侧; direction=right → 球列在窗口左侧
  // 为简化，直接用 savedBallBounds 的球中心 + 拖拽偏移量
  // 拖拽移动的是整个窗口，球列宽 80px，球居中
  const oldDir = savedBallBounds
    ? (savedBallBounds.x < bounds.x - 100 ? 'right' : 'left')
    : 'left'

  // 从当前 bounds 反推球的屏幕中心 X
  // direction=left: 球列在右侧 → ballCenterX = bounds.x + bounds.width - 40
  // direction=right: 球列在左侧 → ballCenterX = bounds.x + 40
  // 但拖拽是整体移动，我们直接用窗口中心来判断新方向
  const windowCenterX = bounds.x + Math.round(bounds.width / 2)
  const display = screen.getDisplayNearestPoint({
    x: windowCenterX,
    y: bounds.y + Math.round(bounds.height / 2)
  })
  const screenCenterX = display.workArea.x + Math.round(display.workArea.width / 2)
  const newDirection: 'left' | 'right' = windowCenterX > screenCenterX ? 'left' : 'right'

  // 从当前 bounds 推算球的实际屏幕位置，得到收起后的 savedBallBounds
  // 当前展开 direction 决定球列在哪侧
  const currentDirection = qiDirection
  let ballColumnX: number
  if (currentDirection === 'left') {
    // 球列在窗口右侧
    ballColumnX = bounds.x + bounds.width - 80
  } else {
    // 球列在窗口左侧
    ballColumnX = bounds.x
  }
  // 球中心在 ballColumnX + 40，savedBallBounds.x = ballCenterX - BALL_WIN_W/2
  const ballCenterX = ballColumnX + 40
  savedBallBounds = {
    x: ballCenterX - Math.round(BALL_WIN_W / 2),
    y: bounds.y,
    width: BALL_WIN_W,
    height: BALL_WIN_H
  }

  // 如果方向变了，需要重新布局窗口
  if (newDirection !== currentDirection) {
    let newX: number
    if (newDirection === 'left') {
      newX = ballCenterX - (EXPANDED_W - BALL_EDGE_OFFSET)
    } else {
      newX = ballCenterX - BALL_EDGE_OFFSET
    }
    ballWin.setBounds({
      x: Math.round(newX),
      y: bounds.y,
      width: EXPANDED_W,
      height: BALL_WIN_H
    })
    qiDirection = newDirection
  }

  return { direction: newDirection }
})

// ── IPC: 右键上下文菜单 ───────────────────────────────────

const PANEL_W = 400
const PANEL_H = 600
const SETTINGS_W = 360
const SETTINGS_H = 420

function createPanelWindow(): void {
  if (panelWin) {
    panelWin.focus()
    return
  }

  // 定位面板在球附近（左上方）
  let x = 100
  let y = 100
  if (ballWin) {
    const ballBounds = ballWin.getBounds()
    const display = screen.getDisplayNearestPoint({
      x: ballBounds.x + Math.round(ballBounds.width / 2),
      y: ballBounds.y + Math.round(ballBounds.height / 2)
    })
    const workArea = display.workArea

    // 面板出现在球的左侧上方，若空间不够则调整
    x = ballBounds.x - PANEL_W - 16
    y = ballBounds.y + ballBounds.height - PANEL_H

    // 防止超出屏幕
    if (x < workArea.x) x = ballBounds.x + ballBounds.width + 16
    if (y < workArea.y) y = workArea.y
    if (x + PANEL_W > workArea.x + workArea.width) x = workArea.x + workArea.width - PANEL_W
    if (y + PANEL_H > workArea.y + workArea.height) y = workArea.y + workArea.height - PANEL_H
  }

  panelWin = new BrowserWindow({
    width: PANEL_W,
    height: PANEL_H,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    minWidth: 320,
    minHeight: 400,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (process.platform === 'darwin') {
    panelWin.setAlwaysOnTop(true, 'floating')
  } else {
    panelWin.setAlwaysOnTop(true)
  }
  panelWin.on('ready-to-show', () => panelWin?.show())
  panelWin.on('closed', () => { panelWin = null })

  const panelParam = '?view=panel'
  if (process.env['NODE_ENV'] === 'development' && process.env['ELECTRON_RENDERER_URL']) {
    panelWin.loadURL(process.env['ELECTRON_RENDERER_URL'] + panelParam)
  } else {
    panelWin.loadFile(join(__dirname, '../renderer/index.html'), { search: 'view=panel' })
  }
}

function createSettingsWindow(): void {
  if (settingsWin) {
    settingsWin.focus()
    return
  }

  // 定位在屏幕中央偏上
  const display = screen.getPrimaryDisplay()
  const workArea = display.workArea
  const x = Math.round(workArea.x + (workArea.width - SETTINGS_W) / 2)
  const y = Math.round(workArea.y + (workArea.height - SETTINGS_H) / 3)

  settingsWin = new BrowserWindow({
    width: SETTINGS_W,
    height: SETTINGS_H,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (process.platform === 'darwin') {
    settingsWin.setAlwaysOnTop(true, 'floating')
  } else {
    settingsWin.setAlwaysOnTop(true)
  }
  settingsWin.on('ready-to-show', () => settingsWin?.show())
  settingsWin.on('closed', () => { settingsWin = null })

  const settingsParam = '?view=settings'
  if (process.env['NODE_ENV'] === 'development' && process.env['ELECTRON_RENDERER_URL']) {
    settingsWin.loadURL(process.env['ELECTRON_RENDERER_URL'] + settingsParam)
  } else {
    settingsWin.loadFile(join(__dirname, '../renderer/index.html'), { search: 'view=settings' })
  }
}

ipcMain.on('contextmenu:show', () => {
  if (!ballWin) return

  const menu = Menu.buildFromTemplate([
    {
      label: '打开面板',
      click: () => {
        createPanelWindow()
      }
    },
    {
      label: '设置',
      click: () => {
        createSettingsWindow()
      }
    },
    { type: 'separator' },
    {
      label: '退出 Claw',
      click: () => {
        app.quit()
      }
    }
  ])

  menu.popup({ window: ballWin })
})

// ── IPC: 关闭当前窗口 ─────────────────────────────────────
ipcMain.on('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})

// ── 配置管理 ──────────────────────────────────────────────

function getConfigPath(): string {
  return join(resolveDataDir(), 'config.json')
}

function readConfig(): Record<string, unknown> {
  const configPath = getConfigPath()
  if (!existsSync(configPath)) return {}
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch {
    return {}
  }
}

function writeConfig(config: Record<string, unknown>): void {
  const configPath = getConfigPath()
  const dir = join(configPath, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

ipcMain.handle('config:get', () => {
  return readConfig()
})

ipcMain.handle('config:set', (_event, config: Record<string, unknown>) => {
  const existing = readConfig()
  writeConfig({ ...existing, ...config })
})

// ── 启动内嵌后端 ───────────────────────────────────────────
// 后端在 app.whenReady() 内启动，确保顺序可控

// ── App 生命周期 ───────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    backendHandle = await startBackend({ dataDir: resolveDataDir() })

    // 首次启动：复制初始模板（生产 → extraResources，开发 → resources/persona）
    const builtinPersona = app.isPackaged
      ? join(process.resourcesPath, 'persona')
      : join(__dirname, '..', '..', 'resources', 'persona')
    if (existsSync(builtinPersona)) {
      copyInitialTemplates(builtinPersona)
    }
  } catch (err: unknown) {
    console.error('[main] Failed to start backend:', err)
  }

  createBallWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createBallWindow()
  })
})

let isQuitting = false
app.on('before-quit', (event) => {
  if (isQuitting) return           // 第二次进入：不拦截，让 Electron 正常退出
  if (!backendHandle) return       // 后端未启动：直接退出
  event.preventDefault()
  isQuitting = true

  // 先关闭所有窗口（断开 WS），再做后端清理
  for (const win of BrowserWindow.getAllWindows()) {
    win.destroy()
  }

  // 关机归档：sealDay → close → exit，设 30s 超时兜底（sealDay 内部有 2×20s LLM 调用）
  const exitTimer = setTimeout(() => {
    console.warn('[main] shutdown timeout, force exit')
    app.exit(0)
  }, 30000)

  const handle = backendHandle
  handle.sealDay()
    .catch((err) => console.error('[main] sealDay error:', err))
    .then(() => handle.close())
    .catch((err) => console.error('[main] close error:', err))
    .finally(() => {
      clearTimeout(exitTimer)
      app.exit(0)
    })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
