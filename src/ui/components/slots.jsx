import { agentColor, displayName } from "@/lib/agents";

/** An agent's slots: ●●○○ 2/4 (+1 queued). */
export function Slots({ agent, used, max, queued = 0, title, extra = null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" title={title}>
      {displayName(agent).split(" ")[0]}
      <span className="inline-flex gap-0.5" aria-hidden="true">
        {Array.from({ length: max }, (_, i) => (
          <i
            // biome-ignore lint/suspicious/noArrayIndexKey: a slot is its place
            key={i}
            className="size-1.5 rounded-full bg-muted"
            style={i < used ? { background: agentColor(agent) } : undefined}
          />
        ))}
      </span>
      <b className="tabular-nums">
        {used}/{max}
      </b>
      {queued > 0 && <em className="text-muted-foreground not-italic tabular-nums">+{queued}</em>}
      {extra}
    </span>
  );
}
