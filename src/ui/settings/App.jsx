import { Button } from "@/components/ui/button";
import { useSettings } from "./store";

export function App() {
  const state = useSettings(s => s.state);
  const agents = Object.keys(state?.values?.agents || {});
  return (
    <main className="flex h-full flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Settings</h1>
        <Button variant="outline" onClick={() => window.settingsAPI?.close()}>
          Close
        </Button>
      </header>
      <p className="text-muted-foreground">
        {state ? `React preview · ${agents.length} agents` : "Waiting for Bayloob…"}
      </p>
    </main>
  );
}
