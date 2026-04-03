// 渲染进程全局类型声明（由 preload/index.ts 通过 contextBridge 注入）
export {}

declare global {
  interface Window {
    electronAPI: {
      /** IPC 通路验证 */
      ping: () => Promise<string>
      /** 悬浮球拖拽 */
      dragStart: () => void
      dragMove: () => void
      dragEnd: () => void
      /** 透明区域点击穿透控制 */
      setIgnoreMouseEvents: (ignore: boolean) => void
      /** QuickInput 条形输入框 */
      toggleQuickInput: () => Promise<{ visible: boolean; direction: 'left' | 'right' }>
      /** 拖拽后重算 QuickInput 方向 */
      repositionQuickInput: () => Promise<{ direction: 'left' | 'right' } | null>
      /** 右键上下文菜单 */
      showContextMenu: () => void
      /** 关闭当前窗口 */
      closeWindow: () => void
      /** 本地后端运行时配置 */
      getBackendRuntimeConfig: () => Promise<{
        httpBaseURL: string
        wsBaseURL: string
        authToken: string
      }>
      /** 读取配置 */
      getConfig: () => Promise<Record<string, unknown>>
      /** 写入配置 */
      setConfig: (config: Record<string, unknown>) => Promise<void>
      /** 获取拖入文件的原生路径（Electron 28+） */
      getPathForFile: (file: File) => string
      /** 解析拖入的文件路径 → 文件元信息 */
      resolveDroppedFiles: (paths: string[]) => Promise<Array<{ path: string; name: string; ext: string; size: number }>>
      /** 打开 ChatPanel 并传入文件附件 */
      openPanelWithFiles: (files: Array<{ path: string; name: string; ext: string; size: number }>) => void
      /** 监听 main → renderer 传递文件附件 */
      onReceiveFiles: (callback: (files: Array<{ path: string; name: string; ext: string; size: number }>) => void) => () => void
      /** 拉取待处理的文件附件 */
      getPendingFiles: () => Promise<Array<{ path: string; name: string; ext: string; size: number }> | null>
    }
  }
}
