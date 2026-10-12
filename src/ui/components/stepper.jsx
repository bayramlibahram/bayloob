import { MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";

/** − value + within [lo, hi]. */
export function Stepper({ value, lo, hi, label, disabled = false, onStep }) {
  return (
    <ButtonGroup aria-label={label}>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Less"
        disabled={disabled || value <= lo}
        onClick={() => onStep(-1)}
      >
        <MinusIcon />
      </Button>
      <ButtonGroupText className="min-w-9 justify-center tabular-nums">{value}</ButtonGroupText>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="More"
        disabled={disabled || value >= hi}
        onClick={() => onStep(1)}
      >
        <PlusIcon />
      </Button>
    </ButtonGroup>
  );
}
