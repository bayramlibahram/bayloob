import { create } from "zustand";

// Settings' state: what main sends when the window opens (settings:show), as it came. The React version is a
// preview until it has moved; the old page (src/renderer/settings) is the one Bayloob opens.
export const useSettings = create(set => ({
  state: null,
  setState: state => set({ state }),
}));

/** Hooks the store to main: each settings:show replaces the state. */
export function connect(api) {
  api?.onShow(state => useSettings.getState().setState(state));
}
