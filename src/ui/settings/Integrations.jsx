import { CircleAlertIcon, CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Group, Row, Section } from "./parts";
import { useSettings } from "./store";

const ICON = { ok: CircleCheckIcon, warn: TriangleAlertIcon, bad: CircleAlertIcon };

/** One line on how something is set up, and the button that fixes it (while it needs fixing). */
function Status({ kind, text, action, busyText, onAction }) {
  const [busy, setBusy] = useState(false);
  const Icon = ICON[kind];
  return (
    <Alert variant={kind === "bad" ? "destructive" : "default"}>
      <Icon />
      <AlertTitle>{text}</AlertTitle>
      {action && (
        <AlertAction>
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await onAction();
              if (!ok) {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? busyText : action}
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}

function Hooks() {
  const { state, installHooks } = useSettings();
  const h = state.hooks || {};
  const ok = h.complete;
  const partial = h.installed && !h.complete;
  const text = h.justInstalled
    ? "Hooks installed"
    : ok
      ? "Claude Code hooks are installed"
      : partial
        ? `Claude Code hooks are only partly installed (${h.events?.length || 0} of 9 events)`
        : "Claude Code hooks are not installed";
  return (
    <Status
      kind={ok ? "ok" : partial ? "warn" : "bad"}
      text={text}
      action={ok ? null : "Install hooks"}
      busyText="Installing…"
      onAction={installHooks}
    />
  );
}

// Only on GNOME: the extension that lets Bayloob list and focus native Wayland windows
function Extension() {
  const { state, installExtension } = useSettings();
  const ext = state.extension || {};
  if (!ext.gnome) {
    return null;
  }
  const result = state.extensionResult;
  const relogin = result?.needsRelogin || (ext.installed && !ext.state);
  const ok = (!result && ext.state === "ACTIVE") || (result && !result.needsRelogin);
  const text = ok
    ? "GNOME extension is running (window focus on Wayland)"
    : relogin
      ? "GNOME extension installed — log out and back in once to load it"
      : "GNOME extension is not enabled — needed to focus windows on Wayland";
  return (
    <Status
      kind={ok ? "ok" : relogin ? "warn" : "bad"}
      text={text}
      action={ok || relogin ? null : "Enable"}
      busyText="Enabling…"
      onAction={installExtension}
    />
  );
}

// Applied at once (it edits the shell's rc file), not on Save
function Shell() {
  const { state, shellIntegration } = useSettings();
  const sh = state.shell || {};
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!sh.supported) {
    return null;
  }
  return (
    <Row
      label="Agents in tmux"
      hint={
        note ||
        "Typing claude or codex in any terminal starts it inside tmux, so Bayloob can send replies straight to it."
      }
    >
      <Switch
        aria-label="Run agents in tmux"
        checked={!!sh.installed}
        disabled={busy}
        onCheckedChange={async on => {
          setBusy(true);
          const r = await shellIntegration(on);
          setBusy(false);
          if (r) {
            setNote(
              on
                ? `Added to ${sh.rc}${r.backup ? ` (backup: ${r.backup})` : ""}. New terminals pick it up; in an open one run: source ${sh.rc}`
                : `Removed from ${sh.rc}. New terminals start agents as before.`
            );
          }
        }}
      />
    </Row>
  );
}

export function Integrations() {
  const { state, draft, setField, locked } = useSettings();
  const detected = state.detectedTerminal;
  return (
    <Section
      title="Integrations"
      lead="The hooks that tell Bayloob what your agents do, and the apps it opens for you."
    >
      <Hooks />
      <Extension />
      <Group>
        <Row
          label="Terminal"
          htmlFor="terminal"
          wide
          hint="Used for launched sessions. The command is appended, e.g. gnome-terminal --."
        >
          <Input
            id="terminal"
            value={draft.terminal}
            placeholder={detected ? `Auto-detect (${detected})` : "Auto-detect"}
            spellCheck={false}
            disabled={locked("terminal")}
            onChange={e => setField("terminal", e.target.value)}
          />
        </Row>
        <Row
          label="Editor"
          htmlFor="editor"
          wide
          hint={
            '"Open folder" runs it with the agent\'s folder, e.g. code. Empty opens the file manager.'
          }
        >
          <Input
            id="editor"
            value={draft.editor}
            placeholder="File manager"
            spellCheck={false}
            disabled={locked("editor")}
            onChange={e => setField("editor", e.target.value)}
          />
        </Row>
        <Shell />
        <Row
          label="Watch clipboard"
          hint="When you copy a stack trace, offer to hand it to an agent. Nothing is sent without you."
        >
          <Switch
            aria-label="Watch clipboard for errors"
            checked={!!draft.watchClipboard}
            onCheckedChange={v => setField("watchClipboard", v)}
          />
        </Row>
      </Group>
    </Section>
  );
}
