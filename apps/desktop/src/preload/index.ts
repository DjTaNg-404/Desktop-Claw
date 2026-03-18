import { contextBridge, ipcRenderer } from 'electron'

// 通过 contextBridge 向渲染进程安全暴露 IPC 通道
contextBridge.exposeInMainWorld('electronAPI', {
  /** 发送 ping，返回 main 进程的回传字符串 */
  ping: (): Promise<string> => ipcRenderer.invoke('ipc:ping')
})
