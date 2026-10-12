import { PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { soundUrl } from "@/lib/assets";
import { Group, Row, Section } from "./parts";
import { useSettings } from "./store";

const NAMES = {
  permission: "Permission card",
  "permission-reminder": "Reminder (60 s)",
  allow: "Allow",
  deny: "Deny",
  "to-terminal": "To terminal",
  done: "Agent finished",
  "open-terminal": "Open terminal",
  prompt: "Prompt sent",
  tool: "Every tool call",
  "session-start": "Session started",
  "session-end": "Session ended",
  "new-agent": "Another agent joined",
  expand: "List opens",
  collapse: "List closes",
  sleep: "Novi falls asleep",
  wake: "Novi wakes up",
  dance: "Music starts",
};

function play(file, volume) {
  const url = soundUrl(file);
  if (!url) {
    return;
  }
  const a = new Audio(url);
  a.volume = volume / 100;
  a.play().catch(() => {});
}

export function Sounds() {
  const { state, draft, setField, locked, toggleSound } = useSettings();
  const list = state.soundList || [];
  const on = !!draft.sounds;
  return (
    <Section title="Sounds" lead="A short sound when an agent needs you, finishes or falls asleep.">
      <Group>
        <Row label="Play sounds" hint="Volume, a sample, and on / off for all of them.">
          <div className="flex items-center gap-3">
            <Slider
              aria-label="Sound volume"
              className="w-32"
              min={0}
              max={100}
              step={5}
              value={[draft.soundVolume]}
              disabled={!on}
              onValueChange={([v]) => setField("soundVolume", v)}
            />
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Play a sample at this volume"
              title="Play a sample at this volume"
              disabled={!on}
              onClick={() => play("done.ogg", draft.soundVolume)}
            >
              <PlayIcon />
            </Button>
            <Switch
              aria-label="Sounds"
              checked={on}
              disabled={locked("sounds")}
              onCheckedChange={v => setField("sounds", v)}
            />
          </div>
        </Row>
        <Row label="Which sounds" hint="Turning one on plays it." wide>
          <div className="flex flex-wrap gap-1.5">
            {list.map(s => (
              <Toggle
                key={s.name}
                variant="outline"
                size="sm"
                disabled={!on}
                pressed={draft.soundToggles[s.name] ?? s.on}
                onPressedChange={() => {
                  if (toggleSound(s)) {
                    play(s.file, draft.soundVolume);
                  }
                }}
              >
                {NAMES[s.name] || s.name}
              </Toggle>
            ))}
          </div>
        </Row>
      </Group>
    </Section>
  );
}
