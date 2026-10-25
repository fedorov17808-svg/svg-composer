import { create } from 'zustand'

/** 'sources' and 'library' are the gopher mode of v1: the code stays, the interface shows only 'objects'. */
export type LeftTab = 'objects' | 'sources' | 'library'
export type WorkspaceMode = 'source' | 'composition'

/** From this width the three columns fit; below it the side panels start collapsed. */
export const WIDE_MIN = 1024

export type PanelSide = 'left' | 'right'

interface UiState {
  /** Side panels open or collapsed to a rail; a collapsed panel takes a narrow column, never overlaps the canvas. */
  panels: Record<PanelSide, boolean>
  setPanel: (side: PanelSide, open: boolean) => void
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

const isWide = () => window.innerWidth >= WIDE_MIN

export const useUiStore = create<UiState>((set) => ({
  panels: { left: isWide(), right: isWide() },
  setPanel: (side, open) => set((s) => ({ panels: { ...s.panels, [side]: open } })),
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
