import { create } from 'zustand'

export type LeftTab = 'sources' | 'library'

interface UiState {
  leftTab: LeftTab
  setLeftTab: (tab: LeftTab) => void
}

export const useUiStore = create<UiState>((set) => ({
  leftTab: 'sources',
  setLeftTab: (leftTab) => set({ leftTab }),
}))
