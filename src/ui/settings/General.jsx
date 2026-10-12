import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PromptFormat } from "@/lib/shared";
import { Choice, Group, Row, Section } from "./parts";
import { useSettings } from "./store";

// Radix's Select has no empty value: "none" stands for "no format" here
export const NONE = "none";

export function General() {
  const { draft, setField, locked } = useSettings();
  return (
    <Section title="General" lead="How Bayloob looks and how you call it up.">
      <Group title="Appearance">
        <Row label="Mascot" hint="Novi is the 3D mascot; Classic the original flat one.">
          <Choice
            label="Mascot"
            value={draft.mascot}
            disabled={locked("mascot")}
            onChange={v => setField("mascot", v)}
            options={[
              ["novi", "Novi (3D)"],
              ["svg", "Classic"],
            ]}
          />
        </Row>
        <Row label="Pill size" hint="The mascot's tile in the pill — the pill's height follows.">
          <Choice
            label="Pill size"
            value={draft.pillSize}
            onChange={v => setField("pillSize", v)}
            options={[
              ["s", "S"],
              ["m", "M"],
              ["l", "L"],
            ]}
          />
        </Row>
        <Row
          label="UI scale"
          hint="The workspace, its dialogs and Settings — also Ctrl + / Ctrl − / Ctrl 0 in any of them. The pill has its own size."
        >
          <Choice
            label="UI scale (%)"
            value={draft.uiScale}
            onChange={v => setField("uiScale", Number(v))}
            options={[0.9, 1, 1.1, 1.25, 1.4, 1.5].map(v => [
              v,
              String(Math.round(v * 100)),
              `${Math.round(v * 100)}%`,
            ])}
          />
        </Row>
        <Row label="Theme" hint="System follows the desktop's light / dark switch.">
          <Choice
            label="Theme"
            value={draft.theme}
            disabled={locked("theme")}
            onChange={v => setField("theme", v)}
            options={[
              ["system", "System"],
              ["light", "Light"],
              ["dark", "Dark"],
            ]}
          />
        </Row>
      </Group>

      <Group title="Behaviour">
        <Row
          label="Launcher shortcut"
          htmlFor="shortcut"
          wide
          hint="Empty turns it off. On Wayland, bind a system shortcut to bayloob --new-session."
        >
          <Input
            id="shortcut"
            value={draft.shortcut}
            placeholder="CommandOrControl+Alt+Space"
            spellCheck={false}
            disabled={locked("shortcut")}
            onChange={e => setField("shortcut", e.target.value)}
          />
        </Row>
        <Row
          label="Workspace shortcut"
          htmlFor="workspaceShortcut"
          wide
          hint="Sends the Workspace window to the pill and brings it back. Empty turns it off. On Wayland, bind bayloob --workspace."
        >
          <Input
            id="workspaceShortcut"
            value={draft.workspaceShortcut}
            placeholder="CommandOrControl+Shift+B"
            spellCheck={false}
            onChange={e => setField("workspaceShortcut", e.target.value)}
          />
        </Row>
        <Row label="Workspace ✕ button" hint="Minimize always hides it to the pill.">
          <Choice
            label="Workspace ✕ button"
            value={draft.onClose}
            onChange={v => setField("onClose", v)}
            options={[
              ["pill", "Hide to pill"],
              ["close", "Close"],
              ["quit", "Quit Bayloob"],
            ]}
          />
        </Row>
        <Row label="Dance to music" hint="Novi dances while music is playing.">
          <Switch
            aria-label="Dance to music"
            checked={!!draft.music}
            disabled={locked("music")}
            onCheckedChange={v => setField("music", v)}
          />
        </Row>
      </Group>

      <Group title="Prompts">
        <Row
          label="Response format"
          hint="Your prompts go into it: your text where {{prompt}} is. An agent can have its own (Agents), and a prompt box can pick another. Workflow, Arbiter and ⚔ Challenge prompts never get one (Bayloob reads their answers), and slash commands go as they are."
        >
          <FormatSelect
            label="Response format"
            value={draft.promptFormat.default || NONE}
            onChange={v =>
              useSettings.getState().edit(d => {
                d.promptFormat.default = v === NONE ? null : v;
              })
            }
          />
        </Row>
        <Formats />
      </Group>
    </Section>
  );
}

/** The formats to pick from: (for an agent, its default,) none, then every format. */
export function FormatSelect({ value, onChange, label, withDefault = false }) {
  const f = useSettings(s => s.draft.promptFormat);
  const all = PromptFormat.formats(f);
  const def = all.find(x => x.id === f.default);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="min-w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {withDefault && (
            <SelectItem value="default">Default ({def ? def.name : "none"})</SelectItem>
          )}
          <SelectItem value={NONE}>None — prompts go as typed</SelectItem>
          {all.map(x => (
            <SelectItem key={x.id} value={x.id}>
              {x.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

// The formats as chips, then the one on view: its name (the owner's own), its template, Remove
function Formats() {
  const { draft, fmtShown, edit, addFormat, removeFormat } = useSettings();
  // the owner's formats as typed (Save cleans them): an emptied name or text stays what was typed
  const all = [
    ...PromptFormat.BUILTIN.map(b => ({ ...b, builtin: true })),
    ...draft.promptFormat.custom,
  ];
  const shown = all.find(x => x.id === fmtShown) || all[0];
  const setShown = (key, value) =>
    edit(d => {
      const c = d.promptFormat.custom.find(x => x.id === shown.id);
      if (c) {
        c[key] = value;
      }
    });
  return (
    <Row label="Formats" hint="Built-in ones can't be changed — add your own." wide>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={shown.id}
          onValueChange={v => v && useSettings.setState({ fmtShown: v })}
          aria-label="Formats"
          className="flex-wrap"
        >
          {all.map(x => (
            <ToggleGroupItem key={x.id} value={x.id}>
              {x.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button variant="outline" size="sm" onClick={addFormat}>
          <PlusIcon data-icon="inline-start" />
          New format
        </Button>
      </div>
      {!shown.builtin && (
        <Input
          aria-label="Format name"
          maxLength={40}
          value={shown.name}
          placeholder="Name"
          onChange={e => setShown("name", e.target.value)}
        />
      )}
      <Textarea
        aria-label="Format template"
        className="min-h-36 font-mono text-xs"
        spellCheck={false}
        readOnly={!!shown.builtin}
        value={shown.text}
        onChange={e => setShown("text", e.target.value)}
      />
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs text-muted-foreground">
          {shown.text.includes(PromptFormat.PLACEHOLDER)
            ? ""
            : "No {{prompt}}: your text goes first, the format after it"}
        </p>
        {!shown.builtin && (
          <Button variant="outline" size="sm" onClick={() => removeFormat(shown.id)}>
            Remove this format
          </Button>
        )}
      </div>
    </Row>
  );
}
