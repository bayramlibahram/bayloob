import { Card } from "./Cards";
import { List } from "./List";
import { Pill } from "./Pill";
import { useVoice, Voice } from "./Voice";

// the chevron closes the voice prompt with the list (the store can't import the panel: it imports the store)
globalThis.__closeVoice = () => useVoice.getState().close();

/** The pill: its bar, the card on view, the voice prompt, the agents' list. */
export function App() {
  return <Pill card={<Card />} voice={<Voice />} list={<List />} />;
}
