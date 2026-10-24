import { create } from 'zustand'

/** 'sources' and 'library' are the gopher mode of v1: the code stays, the interface shows only 'objects'. */
export type LeftTab = 'objects' | 'sources' | 'library'
export type WorkspaceMode = 'source' | 'composition'

interface UiState {
  leftTab: LeftTab
  workspaceMode: WorkspaceMode
  toast: { id: number; text: string } | null
  /** The «Новая палитра» form in the right panel. */
  paletteForm: boolean
  setPaletteForm: (open: boolean) => void
  setLeftTab: (tab: LeftTab) => void
  setWorkspaceMode: (mode: WorkspaceMode) => void
  showToast: (text: string) => void
  hideToast: () => void
}

export const useUiStore = create<UiState>((set) => ({
  leftTab: 'objects',
  workspaceMode: 'composition',
  toast: null,
  paletteForm: false,
  setPaletteForm: (paletteForm) => set({ paletteForm }),
  // Components are placed on the canvas, so the library tab brings the composition forward.
  setLeftTab: (leftTab) => set(leftTab === 'sources' ? { leftTab } : { leftTab, workspaceMode: 'composition' }),
  setWorkspaceMode: (workspaceMode) => set({ workspaceMode }),
  showToast: (text) => set({ toast: { id: Date.now(), text } }),
  hideToast: () => set({ toast: null }),
}))
