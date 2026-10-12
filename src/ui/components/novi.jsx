import { packOf } from "@/lib/agents";
import { noviLayers } from "@/lib/assets";
import { cn } from "@/lib/utils";

/** An agent's still Novi (its pack's idle layers stacked), sized by its box. */
export function Novi({ agent, className }) {
  return (
    <span className={cn("relative inline-block size-7 shrink-0", className)} aria-hidden="true">
      {noviLayers(packOf(agent)).map(src => (
        <img key={src} src={src} alt="" className="absolute inset-0 size-full" />
      ))}
    </span>
  );
}
