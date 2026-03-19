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
    ipcRenderer.invoke('quickinput:toggle')
})
