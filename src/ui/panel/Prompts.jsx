import { ArrowLeftRightIcon, ArrowUpIcon, FolderIcon, GitBranchIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Composer } from "@/components/composer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { agentColor, displayName } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { BUSY, projectName } from "./model";
import { blockedWhy, slashFor, usePrompts, viaFor } from "./prompts";
import { usePanel } from "./store";

const AS_SET = "default"; // a Select item can't be "": the format as set in Settings
const RESUMABLE = new Set(["claude", "codex", "grok"]); // agents Bayloob can continue in tmux

/** The format this prompt goes into: as set (the agent's, else the default), none, or another one. */
function FormatPick({ agent, value, onChange }) {
  const f = usePrompts(s => s.formats);
  if (!f) {
    return null;
  }
  const set = (agent && f.agents[agent]) || f.default;
  const name = id => f.formats.find(x => x.id === id)?.name;
  const asSet = set && set !== "none" ? name(set) : "none";
  return (
    <Select value={value || AS_SET} onValueChange={v => onChange(v === AS_SET ? "" : v)}>
      <SelectTrigger
        size="sm"
        aria-label="Response format for this prompt"
        title="The format this prompt goes into (Settings → General → Prompts)"
        className="h-7 border-none bg-transparent text-xs shadow-none dark:bg-transparent"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={AS_SET}>Format: {asSet}</SelectItem>
          <SelectItem value="none">No format</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          {f.formats.map(x => (
            <SelectItem key={x.id} value={x.id}>
              {x.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function Hint({ hint, children }) {
  return (
    <p
      aria-live="polite"
      className={cn(
        "min-h-4 px-1 text-xs text-muted-foreground",
        hint?.kind === "err" && "text-destructive",
        hint?.kind === "ok" && "text-done"
      )}
    >
      {hint?.text || children}
    </p>
  );
}

/**
 * The selected agent's prompt box (under its detail): Enter sends it — now, queued while it's busy, or copied
 * to paste when it isn't in tmux. / opens the shortcuts, ↑ at the start walks back through what was sent.
 * Not while it waits on a permission: its card is the way.
 */
export function SayBox({ s }) {
  const p = usePrompts();
  const [slashAt, setSlashAt] = useState(0);
  useEffect(() => {
    p.sayTo(s);
  }, [s, p.sayTo]);
  // the queue under the box, read again while it's on view
  useEffect(() => {
    const t = setInterval(() => usePrompts.getState().loadQueue(), 2000);
    return () => clearInterval(t);
  }, []);
  if (p.sayFor !== s.id) {
    return null;
  }
  const via = viaFor(s);
  const why = blockedWhy(p.say);
  const slash = slashFor(p.say.text);
  const at = Math.min(slashAt, Math.max(0, slash.length - 1));
  const tip =
    via === "queue"
      ? "Add to the queue (Enter) — goes out when the agent finishes its turn"
      : via === "paste"
        ? "Copy it and bring the terminal forward to paste (Enter)"
        : "Send (Enter)";
  const applySlash = c => {
    p.editSay({ text: c.text });
    setSlashAt(0);
  };
  const base =
    via === "paste"
      ? "Not in tmux: Enter copies it and brings the terminal forward to paste"
      : BUSY.has(s.state)
        ? "Busy — Enter adds it to the queue"
        : "Enter sends · Shift+Enter new line";
  const history = p.histories[s.id]?.length;
  const suggestions = s.suggestions || [];
  return (
    <form
      aria-label="Prompt to the agent"
      className="relative flex shrink-0 flex-col gap-1.5 border-t px-3 pt-2.5 pb-2"
      onSubmit={e => {
        e.preventDefault();
        p.send(s);
      }}
    >
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
            Suggested
          </span>
          {suggestions.map(x => (
            <Button
              key={x.label}
              size="xs"
              variant="outline"
              title={`${x.prompt}\nPut it in the box — you confirm before it goes`}
              onClick={() => p.editSay({ text: x.prompt })}
            >
              {x.label}
            </Button>
          ))}
        </div>
      )}
      {slash.length > 0 && (
        <div
          id="slash"
          role="listbox"
          aria-label="Prompt shortcuts"
          className="absolute right-3 bottom-full left-3 z-10 mb-1 flex flex-col rounded-xl border bg-popover p-1 shadow-lg"
        >
          {slash.map((c, i) => (
            <button
              key={c.cmd}
              id={`slash-${i}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={i === at}
              title={c.text}
              onMouseDown={e => {
                e.preventDefault();
                applySlash(c);
              }}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]",
                i === at && "bg-brand/14"
              )}
            >
              <code className="text-brand">{c.cmd}</code>
              <span className="truncate">{c.label}</span>
            </button>
          ))}
          <div className="px-2 pt-1 text-[11px] text-muted-foreground">
            ↑ ↓ choose · Enter or Tab puts it in the box · Esc closes
          </div>
        </div>
      )}
      <Composer
        label="Prompt to the agent"
        placeholder={`Message ${displayName(s.agent)} · ${projectName(s)}`}
        rows={1}
        className="[&_textarea]:min-h-10"
        value={p.say.text}
        onValueChange={text => {
          setSlashAt(0);
          p.editSay({ text });
        }}
        pastes={p.say.pastes}
        onPastesChange={pastes => p.editSay({ pastes })}
        files={p.say.files}
        count
        onSubmit={() => p.send(s)}
        onKey={e => {
          // the shortcuts take the arrows, Enter / Tab and Esc while they're open
          if (slash.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setSlashAt((at + (e.key === "ArrowDown" ? 1 : slash.length - 1)) % slash.length);
              return true;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              applySlash(slash[at]);
              return true;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              p.editSay({ text: "" });
              return true;
            }
          }
          // ↑ at the very start (or while walking) brings back earlier prompts; ↓ walks back
          const ta = e.target;
          const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0;
          const walking = p.histPos !== -1;
          if (
            !e.shiftKey &&
            ((e.key === "ArrowUp" && (atStart || walking)) || (e.key === "ArrowDown" && walking)) &&
            p.walkHistory(e.key === "ArrowUp" ? 1 : -1)
          ) {
            e.preventDefault();
            return true;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            ta.blur();
            return true;
          }
          return false;
        }}
        tools={
          <FormatPick
            agent={s.agent}
            value={p.say.format}
            onChange={format => p.editSay({ format })}
          />
        }
      />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {via !== "now" && (
          <span
            title={tip}
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
              via === "queue" ? "bg-working/15 text-working" : "bg-thinking/15 text-thinking"
            )}
          >
            {via === "queue" ? "Queue" : "Copy & paste"}
          </span>
        )}
        {via === "paste" && RESUMABLE.has(s.agent) && (
          <Button
            type="button"
            variant="link"
            size="xs"
            className="shrink-0 px-0"
            title="Move this conversation into tmux, so replies go straight in (you close it in its terminal once)"
            onClick={p.handoff}
          >
            <ArrowLeftRightIcon data-icon="inline-start" />
            Continue in Bayloob
          </Button>
        )}
        <Hint hint={p.hint}>
          {base}
          {` · / shortcuts${history ? " · ↑ earlier prompts" : ""}`}
        </Hint>
        <span className="flex-1" />
        <Button
          type="submit"
          size="icon-sm"
          disabled={!!why || p.sending}
          title={why || tip}
          aria-label={tip}
        >
          <ArrowUpIcon />
        </Button>
      </div>
      {p.queue.length > 0 && (
        <ol className="flex flex-col gap-1">
          <li className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
            Waiting for this agent · {p.queue.length}
          </li>
          {p.queue.map((t, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: a queued prompt is its place in the queue
              key={i}
              className="flex items-center gap-2 rounded-lg border bg-card py-1 pr-1 pl-2.5 text-[12.5px]"
            >
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={t}>
                {t}
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                title="Remove from the queue"
                aria-label="Remove from the queue"
                onClick={() => p.unqueue(i)}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ol>
      )}
    </form>
  );
}

/** Ask Bayloob: write what should be done, Enter → pick the agent and folder (all on view), Enter starts it. */
export function AskBar() {
  const p = usePrompts();
  const panel = usePanel();
  const cur = panel.launchMode ? null : panel.current();
  const selected = cur?.kind === "agent" ? cur.data : null;
  const cwd = useRef(null);
  return (
    <form
      aria-label="Ask Bayloob"
      className="flex shrink-0 flex-col gap-1.5 border-t px-4 pt-2.5 pb-2"
      onSubmit={e => {
        e.preventDefault();
        p.askNext(selected);
      }}
    >
      <Composer
        label="Ask Bayloob"
        placeholder="Ask Bayloob — what should be done?"
        rows={1}
        className="[&_textarea]:min-h-10"
        value={p.ask.text}
        onValueChange={text => p.editAsk({ text })}
        pastes={p.ask.pastes}
        onPastesChange={pastes => p.editAsk({ pastes })}
        files={p.ask.files}
        count
        onSubmit={() => p.askNext(selected)}
        onKey={e => {
          if (e.key === "Escape" && (p.picking || p.ask.text)) {
            e.preventDefault();
            p.askBack();
            return true;
          }
          return false;
        }}
        tools={
          <FormatPick
            agent={p.askAgent}
            value={p.ask.format}
            onChange={format => p.editAsk({ format })}
          />
        }
      />
      {p.picking && (
        <fieldset aria-label="Agent and folder" className="flex flex-wrap items-center gap-1.5">
          {Object.entries(p.picking.agents).map(([k, a]) => (
            <Button
              key={k}
              size="sm"
              variant="outline"
              disabled={!a.installed}
              title={a.installed ? undefined : "not installed"}
              aria-pressed={k === p.askAgent}
              className={cn(k === p.askAgent && "border-brand/45 bg-brand/14")}
              onClick={() => p.setAsk({ askAgent: k })}
            >
              <i className="size-2 rounded-full" style={{ background: agentColor(k) }} />
              {a.name}
            </Button>
          ))}
          <span className="relative min-w-48 flex-1" title="Choose a project folder">
            <FolderIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={cwd}
              aria-label="Folder"
              placeholder="Folder"
              spellCheck={false}
              className="h-8 pl-8 font-mono text-xs"
              value={p.askCwd}
              onChange={e => p.setAsk({ askCwd: e.target.value })}
            />
          </span>
          <Button
            size="sm"
            variant="outline"
            aria-pressed={p.askWorktree}
            className={cn(p.askWorktree && "border-brand/45 bg-brand/14")}
            onClick={() => p.setAsk({ askWorktree: !p.askWorktree })}
          >
            <GitBranchIcon data-icon="inline-start" />
            New worktree
          </Button>
          <Button size="sm" type="submit">
            Start
          </Button>
        </fieldset>
      )}
      {p.askHint && <Hint hint={p.askHint} />}
    </form>
  );
}
