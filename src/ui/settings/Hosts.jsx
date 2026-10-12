import { PlusIcon, ServerIcon } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Section } from "./parts";
import { useSettings } from "./store";

function Host({ h, i }) {
  const { aliases, hostStatus, setHost, removeHost, testHost } = useSettings();
  const [asking, setAsking] = useState(false);
  const st = hostStatus[i];
  const unknown = h.alias && aliases && !aliases.includes(h.alias);
  const id = f => `host-${i}-${f}`;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-3",
        h.env === "prod" && "border-destructive/60"
      )}
      data-host={i}
    >
      <FieldGroup className="grid grid-cols-[1fr_1fr_8rem] gap-2">
        <Field>
          <FieldLabel htmlFor={id("name")}>Name</FieldLabel>
          <Input
            id={id("name")}
            value={h.name}
            spellCheck={false}
            onChange={e => setHost(i, "name", e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={id("alias")}>
            SSH alias (~/.ssh/config)
            {unknown && <span className="text-working">· not in your SSH config</span>}
          </FieldLabel>
          <Input
            id={id("alias")}
            list="sshAliases"
            value={h.alias}
            spellCheck={false}
            onChange={e => setHost(i, "alias", e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={id("env")}>Environment</FieldLabel>
          <Select value={h.env} onValueChange={v => setHost(i, "env", v)}>
            <SelectTrigger id={id("env")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {["dev", "staging", "prod"].map(e => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field className="col-span-3">
          <FieldLabel htmlFor={id("allow")}>
            Allowed commands — one pattern per line; * is one word, a final * the rest
          </FieldLabel>
          <Textarea
            id={id("allow")}
            className="min-h-14 font-mono text-xs"
            spellCheck={false}
            placeholder={"systemctl status *\njournalctl *\ndocker logs *"}
            defaultValue={(h.allow || []).join("\n")}
            onChange={e => setHost(i, "allow", e.target.value)}
          />
        </Field>
        <Field className="col-span-3">
          <FieldLabel htmlFor={id("notes")}>Notes</FieldLabel>
          <Input
            id={id("notes")}
            value={h.notes || ""}
            onChange={e => setHost(i, "notes", e.target.value)}
          />
        </Field>
      </FieldGroup>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex-1 text-xs text-muted-foreground",
            st?.ok && "text-done",
            st?.error && "text-destructive"
          )}
        >
          {st ? (st.ok ? `Connected (${st.ms} ms)` : st.busy ? "Connecting…" : st.error) : ""}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!h.alias || st?.busy}
          onClick={() => setAsking(true)}
        >
          {st?.busy && <Spinner data-icon="inline-start" />}
          Test connection
        </Button>
        <Button variant="outline" size="sm" onClick={() => removeHost(i)}>
          Remove
        </Button>
      </div>
      {/* A real connection: only after the owner says so */}
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Test the connection?</AlertDialogTitle>
            <AlertDialogDescription>
              Test connects once: <code>ssh -o BatchMode=yes {h.alias} true</code> — go on?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => testHost(i)}>Connect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function Hosts() {
  const { draft, aliases, addHost, hostKeys } = useSettings();
  return (
    <Section
      title="Hosts"
      lead="Hosts a runbook may use. Bayloob connects with your own SSH keys (batch mode — it never asks for a password) and runs a step only when you click it. prod refuses any command that isn't in its allowed list."
    >
      {draft.hosts.length ? (
        <div className="flex flex-col gap-2">
          {draft.hosts.map((h, i) => (
            <Host key={hostKeys[i]} h={h} i={i} />
          ))}
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ServerIcon />
            </EmptyMedia>
            <EmptyTitle>No hosts yet</EmptyTitle>
            <EmptyDescription>
              Operations tasks run their steps only on hosts listed here — add one below.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <datalist id="sshAliases">
        {(aliases || []).map(a => (
          <option key={a} value={a} />
        ))}
      </datalist>
      <div>
        <Button variant="outline" onClick={addHost}>
          <PlusIcon data-icon="inline-start" />
          Add a host
        </Button>
      </div>
    </Section>
  );
}
