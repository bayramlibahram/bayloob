import { ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { timeAgo } from "@/lib/time";
import { Group, Section } from "./parts";
import { useSettings } from "./store";

const folder = p => (p || "").split("/").filter(Boolean).pop() || p || "";

/** One remembered rule or denial: the command, where and how often, and the button that drops it. */
function Entry({ code, title, detail, action, onAction }) {
  const [busy, setBusy] = useState(false);
  return (
    <Item size="sm" variant="outline">
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full truncate font-mono text-xs" title={title}>
          {code}
        </ItemTitle>
        <ItemDescription>{detail}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onAction();
            setBusy(false);
          }}
        >
          {action}
        </Button>
      </ItemActions>
    </Item>
  );
}

export function Permissions() {
  const { state, revokeRule, forgetDenial } = useSettings();
  const rules = state.rules || [];
  const denials = state.denials || [];
  return (
    <Section
      title="Permissions"
      lead="Requests you allowed for good, and the ones you denied — revoke or forget any of them."
    >
      {rules.length > 0 && (
        <Group title="Always allowed (from permission cards)">
          <ItemGroup className="gap-2 p-2">
            {rules.map(r => (
              <Entry
                key={r.id}
                code={r.key}
                title={r.cwd}
                detail={`${folder(r.cwd)} · used ${r.hits}×`}
                action="Remove"
                onAction={() => revokeRule(r.id)}
              />
            ))}
          </ItemGroup>
        </Group>
      )}
      {denials.length > 0 && (
        <Group title="Denied before (similar requests get a red card)">
          <ItemGroup className="gap-2 p-2">
            {denials.map(a => (
              <Entry
                key={a.id}
                code={a.command}
                title={a.command}
                detail={`${folder(a.cwd)} · ${timeAgo(a.at)}`}
                action="Forget"
                onAction={() => forgetDenial(a.id)}
              />
            ))}
          </ItemGroup>
        </Group>
      )}
      {!rules.length && !denials.length && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShieldCheckIcon />
            </EmptyMedia>
            <EmptyTitle>No rules yet</EmptyTitle>
            <EmptyDescription>
              “Always allow” on a permission card adds one here; denied requests are remembered here
              too.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </Section>
  );
}
