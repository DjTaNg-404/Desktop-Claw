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
    }
  }
}
