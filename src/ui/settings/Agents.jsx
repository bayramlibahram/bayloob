import { Novi } from "@/components/novi";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FormatSelect, NONE } from "./General";
import { Choice, Group, Row, Section, Stepper } from "./parts";
import { Roles } from "./Roles";
import { ATTACH_RANGE, LIMIT_RANGE, useSettings } from "./store";

const PICK = "__pick"; // Radix's Select has no empty value: "no model picked yet"

/** A model pulled in Ollama, to pick (the saved one stays listed even when Ollama doesn't report it). */
function ModelSelect({ models, value, label, onChange }) {
  const has = models.some(m => m.name === value);
  return (
    <Select value={value || PICK} onValueChange={v => onChange(v === PICK ? "" : v)}>
      <SelectTrigger size="sm" aria-label={label} className="min-w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={PICK}>Pick a model…</SelectItem>
          {value && !has && <SelectItem value={value}>{value}</SelectItem>}
          {models.map(m => (
            <SelectItem key={m.name} value={m.name}>
              {m.name}
              {m.params ? ` · ${m.params}` : ""}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

const noModels = url =>
  `No models at ${url} — start Ollama (ollama serve) and pull one (ollama pull qwen3:8b)`;

// One agent: on/off, how many at once, then what Bayloob runs for it, its notes and its response format
function AgentRow({ k, a, i }) {
  const { draft, edit, step } = useSettings();
  const usage = useSettings(s => s.state.usage?.agents?.[k]);
  const name = i.name || k;
  const set = fn => edit(d => fn(d));
  const models = i.ollama?.models || [];
  const fmt = draft.promptFormat.agents[k];
  return (
    <Item size="sm" className="flex-wrap">
      <ItemMedia>
        <Novi agent={k} className={a.enabled && i.installed ? "" : "opacity-55"} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{name}</ItemTitle>
        <ItemDescription>
          {i.installed
            ? `${usage?.running || 0} of ${a.max} running`
            : "Not installed — install the CLI, then restart Bayloob"}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch
          aria-label={`Use ${name} in tasks`}
          title={`Use ${name} in tasks`}
          checked={!!a.enabled && !!i.installed}
          disabled={!i.installed}
          onCheckedChange={v =>
            set(d => {
              d.agents[k].enabled = v;
            })
          }
        />
        <Stepper
          label={`${name} max parallel`}
          value={a.max}
          lo={1}
          hi={16}
          disabled={!i.installed}
          onStep={n => step("agent", k, n)}
        />
      </ItemActions>
      {i.installed && (
        <div className="flex w-full flex-col gap-2 pl-10 text-xs text-muted-foreground">
          {i.text && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-foreground">Model</span>
                <ModelSelect
                  label="Ollama model"
                  models={models}
                  value={draft.ollama.model}
                  onChange={v =>
                    set(d => {
                      d.ollama.model = v;
                    })
                  }
                />
                <span className="font-semibold text-foreground">URL</span>
                <Input
                  aria-label="Ollama URL"
                  className="h-7 w-56"
                  spellCheck={false}
                  value={draft.ollama.url}
                  onChange={e =>
                    set(d => {
                      d.ollama.url = e.target.value.trim();
                    })
                  }
                />
              </div>
              <span>
                {models.length
                  ? "Answers only — no tools, no files: it can be the Arbiter or take part in a discussion"
                  : noModels(draft.ollama.url)}
              </span>
            </>
          )}
          {i.local && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-foreground">Model</span>
                <ModelSelect
                  label="Codex (local) model"
                  models={models}
                  value={draft.ollama.coder}
                  onChange={v =>
                    set(d => {
                      d.ollama.coder = v;
                    })
                  }
                />
              </div>
              <Commands i={i} />
              <span>
                {models.length
                  ? "Codex on a model pulled in Ollama, in its own settings (no plugins or MCP tools). It needs a model that calls tools with 16k+ context — gpt-oss:20b at 16k worked; Qwen3 8B only answered in text. Slow on a laptop: minutes per step"
                  : noModels(draft.ollama.url)}
              </span>
            </>
          )}
          {i.launch && !i.text && !i.local && (
            <>
              <Commands i={i} />
              <Input
                aria-label={`${name} notes`}
                className="h-7"
                placeholder="Notes, e.g. subscription plan — rate limits apply"
                value={a.notes || ""}
                onChange={e =>
                  set(d => {
                    d.agents[k].notes = e.target.value;
                  })
                }
              />
            </>
          )}
          {!i.text && (
            <div className="flex items-center gap-2">
              <span>Response format</span>
              <FormatSelect
                withDefault
                label={`${name} response format`}
                value={fmt === undefined ? "default" : fmt}
                onChange={v =>
                  set(d => {
                    if (v === "default") {
                      delete d.promptFormat.agents[k];
                    } else {
                      d.promptFormat.agents[k] = v === NONE ? NONE : v;
                    }
                  })
                }
              />
            </div>
          )}
        </div>
      )}
    </Item>
  );
}

function Commands({ i }) {
  return (
    <span className="flex flex-col gap-0.5 font-mono break-all">
      <span>
        <b className="mr-1 font-sans text-foreground">Starts</b>
        {i.launch}
      </span>
      <span>
        <b className="mr-1 font-sans text-foreground">Read-only</b>
        {i.readOnly || "no read-only flag — Bayloob denies writes"}
      </span>
    </span>
  );
}

function Limit({ label, sub, value, range, onStep }) {
  return (
    <Field orientation="horizontal" className="px-4 py-2.5">
      <FieldContent>
        <FieldTitle>{label}</FieldTitle>
        <FieldDescription>{sub}</FieldDescription>
      </FieldContent>
      <Stepper label={label} value={value} lo={range[0]} hi={range[1]} onStep={onStep} />
    </Field>
  );
}

export function Agents() {
  const { state, draft, step, setField } = useSettings();
  const info = state.agentInfo || {};
  const l = draft.limits;
  const rows = Object.entries(draft.agents);
  return (
    <Section
      title="Agents"
      lead="Which coding agents Bayloob may start, how many at once, and when the Arbiter may decide."
    >
      <Group title="Agents">
        <ItemGroup>
          {rows.map(([k, a], n) => (
            <div key={k}>
              {n > 0 && <ItemSeparator />}
              <AgentRow k={k} a={a} i={info[k] || {}} />
            </div>
          ))}
        </ItemGroup>
      </Group>
      <Group title="Limits">
        <Limit
          label="Max parallel agents"
          sub="all tasks together"
          value={l.total}
          range={LIMIT_RANGE.total}
          onStep={n => step("limit", "total", n)}
        />
        <Limit
          label="Per project"
          sub="at the same time"
          value={l.perProject}
          range={LIMIT_RANGE.perProject}
          onStep={n => step("limit", "perProject", n)}
        />
        <Limit
          label="Hold launches below"
          sub={`GB of free memory${state.freeGB ? ` · now ${state.freeGB} GB free` : ""}`}
          value={l.minFreeGB}
          range={LIMIT_RANGE.minFreeGB}
          onStep={n => step("limit", "minFreeGB", n)}
        />
        <Limit
          label="Attached file"
          sub="MB at most, each"
          value={draft.attachLimits.fileMB}
          range={ATTACH_RANGE.fileMB}
          onStep={n => step("attach", "fileMB", n)}
        />
        <Limit
          label="Attachments per task"
          sub="MB at most, together"
          value={draft.attachLimits.taskMB}
          range={ATTACH_RANGE.taskMB}
          onStep={n => step("attach", "taskMB", n)}
        />
      </Group>
      <Roles />
      <Group title="Arbiter">
        <Row
          label="Confidence to go on"
          hint="Its pick goes on to your merge only at this confidence or above, with no high risk. You always click merge."
        >
          <Choice
            label="Arbiter confidence"
            value={draft.arbiterConfidence}
            onChange={v => setField("arbiterConfidence", Number(v))}
            options={[0.5, 0.6, 0.7, 0.8, 0.9].map(v => [v, String(v)])}
          />
        </Row>
      </Group>
    </Section>
  );
}
