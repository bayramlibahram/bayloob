import { Pill } from "./Pill";
import { usePill } from "./store";

/** The pill, with what comes in the next steps of the move: the cards, the agents' list, the voice prompt. */
export function App() {
  const api = usePill(s => s.api);
  return (
    <Pill
      list={
        api ? (
          <button type="button" className="new" data-act="new" onClick={() => api.openLauncher()}>
            <span className="plus">
              <i>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 3v10M3 8h10" />
                </svg>
              </i>
            </span>
            New session
          </button>
        ) : null
      }
    />
  );
}
