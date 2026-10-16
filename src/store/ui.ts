import { create } from 'zustand'

export type LeftTab = 'sources' | 'library'

interface UiState {
  leftTab: LeftTab
  toast: { id: number; text: string } | null
  setLeftTab: (tab: LeftTab) => void
  showToast: (text: string) => void
  hideToast: () => void
}

export const useUiStore = create<UiState>((set) => ({
  leftTab: 'sources',
  toast: null,
  setLeftTab: (leftTab) => set({ leftTab }),
  showToast: (text) => set({ toast: { id: Date.now(), text } }),
  hideToast: () => set({ toast: null }),
}))
