import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { displayName } from "@/lib/agents";
import { Roles as R } from "@/lib/shared";
import { Choice, Group, Row } from "./parts";
import { useSettings } from "./store";

const MODES = { "read-only": "Read-only", writes: "Can change files" };
const needsText = "A role needs instructions — without them it is not saved.";

// Agents → Roles: a chip per role (in its colour), then the form of the one on view
export function Roles() {
  const { draft, roleShown, addRole } = useSettings();
  // The built-in roles (on the engine the owner picked), then the owner's as typed: cleaning them (a name that
  // can't be empty, a role without instructions dropped) is Save's job, not the form's while you type
  const all = [...R.list({ engines: draft.roles.engines }), ...draft.roles.custom];
  const shown = all.find(r => r.id === roleShown) || all[0];
  return (
    <Group title="Roles">
      <Row
        label="Role agents"
        hint="A role runs on one of the agents above, with its own instructions: on its own from New task, or as a workflow stage whose answer the next stage reads. Built-in ones can't be changed — make a copy to change it."
        wide
      >
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={shown.id}
            onValueChange={v => v && useSettings.setState({ roleShown: v })}
            aria-label="Roles"
            className="flex-wrap"
          >
            {all.map(r => (
              <ToggleGroupItem key={r.id} value={r.id}>
                <span
                  className="size-2 rounded-full"
                  style={{ background: r.color }}
                  aria-hidden="true"
                />
                {r.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            variant="outline"
            size="sm"
            onClick={() => addRole({ name: "My role", instructions: "You are …\n- " })}
          >
            <PlusIcon data-icon="inline-start" />
            New role
          </Button>
        </div>
        <RoleForm r={shown} />
      </Row>
    </Group>
  );
}

function RoleForm({ r }) {
  const { state, draft, edit, addRole, removeRole, setRoleEngine } = useSettings();
  const info = state.agentInfo || {};
  // engines: the coding agents (a text-only one can't read the project)
  const engines = Object.keys(draft.agents).filter(k => !info[k]?.text && k !== "ollama");
  if (!engines.includes(r.engine)) {
    engines.unshift(r.engine);
  }
  const def = R.BUILTIN.find(b => b.id === r.id)?.engine; // a built-in role's own engine
  const off = !!r.builtin;
  const setRole = (key, value) =>
    edit(d => {
      const c = d.roles.custom.find(x => x.id === r.id);
      if (c) {
        c[key] = value;
      }
    });
  return (
    <FieldGroup className="gap-3">
      <Field orientation="horizontal">
        <FieldLabel htmlFor="roleName" className="w-28">
          Name
        </FieldLabel>
        <Input
          id="roleName"
          maxLength={40}
          value={r.name}
          disabled={off}
          onChange={e => setRole("name", e.target.value)}
        />
      </Field>
      <Field orientation="horizontal">
        <FieldLabel htmlFor="roleEngine" className="w-28">
          Runs on
        </FieldLabel>
        <div className="flex flex-1 items-center gap-2">
          <Select value={r.engine} onValueChange={v => setRoleEngine(r.id, v)}>
            <SelectTrigger id="roleEngine" className="min-w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {engines.map(k => (
                  <SelectItem key={k} value={k}>
                    {info[k]?.name || displayName(k)}
                    {k === def ? " · default" : ""}
                    {info[k] && !info[k].installed ? " (not installed)" : ""}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <input
            type="color"
            aria-label="Colour"
            className="h-7 w-9 cursor-pointer rounded-md border bg-transparent p-0.5 disabled:cursor-default disabled:opacity-60"
            value={r.color}
            disabled={off}
            onChange={e => setRole("color", e.target.value)}
          />
          {r.builtin && r.engine !== def && (
            <Button variant="link" size="sm" onClick={() => setRoleEngine(r.id, def)}>
              Reset to default
            </Button>
          )}
        </div>
      </Field>
      <Field orientation="horizontal">
        <FieldLabel className="w-28">Permission</FieldLabel>
        <div className="flex-1">
          <Choice
            label="Permission"
            value={r.mode}
            disabled={off}
            onChange={v => setRole("mode", v)}
            options={R.MODES.map(m => [m, MODES[m]])}
          />
        </div>
      </Field>
      <Field orientation="horizontal">
        <FieldLabel htmlFor="roleArtifact" className="w-28">
          Answer file
        </FieldLabel>
        <Input
          id="roleArtifact"
          maxLength={60}
          placeholder="e.g. research.md — the next workflow stage reads it"
          value={r.artifact}
          disabled={off}
          onChange={e => setRole("artifact", e.target.value)}
        />
      </Field>
      <Textarea
        aria-label="Instructions"
        className="min-h-36 font-mono text-xs"
        spellCheck={false}
        readOnly={off}
        value={r.instructions}
        onChange={e => setRole("instructions", e.target.value)}
      />
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs text-muted-foreground">
          {off
            ? "Built-in: pick the agent it runs on here; make a copy to change the rest."
            : r.instructions.trim()
              ? ""
              : needsText}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => addRole({ ...r, name: `${r.name} (copy)`.slice(0, 40) })}
        >
          Make a copy
        </Button>
        {!off && (
          <Button variant="outline" size="sm" onClick={() => removeRole(r.id)}>
            Remove this role
          </Button>
        )}
      </div>
    </FieldGroup>
  );
}
