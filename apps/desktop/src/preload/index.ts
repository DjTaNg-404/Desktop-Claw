import { contextBridge, ipcRenderer } from 'electron'

// 通过 contextBridge 向渲染进程安全暴露 IPC 通道
contextBridge.exposeInMainWorld('electronAPI', {
  /** IPC 通路验证 */
  ping: (): Promise<string> => ipcRenderer.invoke('ipc:ping'),
  /** 悬浮球拖拽 */
  dragStart: (): void => { ipcRenderer.send('drag:start') },
  dragMove: (): void => { ipcRenderer.send('drag:move') },
  dragEnd: (): void => { ipcRenderer.send('drag:end') },
  /** 透明区域点击穿透控制 */
  setIgnoreMouseEvents: (ignore: boolean): void => {
    ipcRenderer.send('set-ignore-mouse-events', ignore)
  },
  /** QuickInput 条形输入框 */
  toggleQuickInput: (): Promise<{ visible: boolean; direction: 'left' | 'right' }> =>
    ipcRenderer.invoke('quickinput:toggle'),
  /** 拖拽后重算 QuickInput 方向 */
  repositionQuickInput: (): Promise<{ direction: 'left' | 'right' } | null> =>
    ipcRenderer.invoke('quickinput:reposition'),
  /** 右键上下文菜单 */
  showContextMenu: (): void => { ipcRenderer.send('contextmenu:show') },
  /** 关闭当前窗口 */
  closeWindow: (): void => { ipcRenderer.send('window:close') },
  /** 本地后端运行时配置 */
  getBackendRuntimeConfig: (): Promise<{
    httpBaseURL: string
    wsBaseURL: string
    authToken: string
  }> => ipcRenderer.invoke('backend:get-runtime-config'),
  /** 读取配置 */
  getConfig: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('config:get'),
  /** 写入配置 */
  setConfig: (config: Record<string, unknown>): Promise<void> => ipcRenderer.invoke('config:set', config)
})
