import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export { Stepper } from "@/components/stepper";

/** A section: its heading, one line on what it is for, then its groups. */
export function Section({ title, lead, children }) {
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {lead && <p className="text-muted-foreground">{lead}</p>}
      </header>
      {children}
    </section>
  );
}

/** A group of settings (a card), with an optional small heading above it. */
export function Group({ title, children }) {
  return (
    <div className="flex flex-col gap-2">
      {title && (
        <h3 className="px-0.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
      )}
      <div className="flex flex-col divide-y rounded-xl border bg-card">{children}</div>
    </div>
  );
}

/**
 * One setting: its name and hint on the left, the control on the right (`wide`: the control goes underneath,
 * the whole width — a text box, a list).
 */
export function Row({ label, htmlFor, hint, wide = false, children }) {
  const name = htmlFor ? (
    <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
  ) : (
    <FieldTitle>{label}</FieldTitle>
  );
  return (
    <Field orientation={wide ? "vertical" : "horizontal"} className="px-4 py-3">
      <FieldContent>
        {name}
        {hint && <FieldDescription>{hint}</FieldDescription>}
      </FieldContent>
      {children}
    </Field>
  );
}

/** One of a few options ([[value, label, aria?]]), as a segmented control. */
export function Choice({ value, options, onChange, label, disabled = false }) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={String(value)}
      onValueChange={v => v && onChange(v)}
      aria-label={label}
      disabled={disabled}
    >
      {options.map(([v, text, aria]) => (
        <ToggleGroupItem key={v} value={String(v)} aria-label={aria || text}>
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
