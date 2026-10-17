import { create } from 'zustand'

export type LeftTab = 'sources' | 'library'
export type WorkspaceMode = 'source' | 'composition'

interface UiState {
  leftTab: LeftTab
  workspaceMode: WorkspaceMode
  toast: { id: number; text: string } | null
  setLeftTab: (tab: LeftTab) => void
  setWorkspaceMode: (mode: WorkspaceMode) => void
  showToast: (text: string) => void
  hideToast: () => void
}

export const useUiStore = create<UiState>((set) => ({
  leftTab: 'sources',
  workspaceMode: 'source',
  toast: null,
  // Components are placed on the canvas, so the library tab brings the composition forward.
  setLeftTab: (leftTab) => set(leftTab === 'library' ? { leftTab, workspaceMode: 'composition' } : { leftTab }),
  setWorkspaceMode: (workspaceMode) => set({ workspaceMode }),
  showToast: (text) => set({ toast: { id: Date.now(), text } }),
  hideToast: () => set({ toast: null }),
}))
