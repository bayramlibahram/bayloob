import { Card } from "./Cards";
import { List } from "./List";
import { Pill } from "./Pill";

/** The pill: its bar, the card on view, the agents' list (the voice prompt comes in the next step). */
export function App() {
  return <Pill card={<Card />} list={<List />} />;
}
