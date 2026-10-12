import { FileIcon, ImageIcon, PaperclipIcon, PilcrowIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { isLargePaste, lengthLabel, PASTE_PREVIEW_LINES, sizeLabel, withPastes } from "@/lib/files";
import { cn } from "@/lib/utils";

const ATTACH_TIP = "Attach files — or drop them here, or paste a screenshot (Ctrl+V)";

/**
 * One prompt box, the same wherever there is one: its text (it grows up to its max height, then scrolls),
 * attached files, large-paste chips, a length label and the page's own tools. What sending means stays with
 * the page: `onSubmit()` on Enter (Shift+Enter is a new line), `onKey(e)` first for each key (true: it took it).
 *
 * value / onValueChange: the text. pastes / onPastesChange: large pasted text, kept out of the box as chips.
 * files: a store from createFiles (lib/files.js) — its chips show here, and a drop or a pasted file goes to it.
 * autoFocus takes the focus without scrolling the page; caretStart puts the caret at the start.
 */
export function Composer({
  value,
  onValueChange,
  pastes = [],
  onPastesChange,
  files,
  onSubmit,
  onKey,
  label,
  placeholder,
  rows = 3,
  mono = false,
  autoFocus = false,
  caretStart = false,
  count = false,
  note = "",
  attachTip = ATTACH_TIP,
  tools = null,
  className,
}) {
  const text = useRef(null);
  const caret = useRef(null); // where the caret goes once a chip's text is back in the box
  const [dropping, setDropping] = useState(0);
  const { items, busy, available, fromTransfer, pick } = useStore(files);

  // `autoFocus` without scrolling the page to the box (what is above it stays in view)
  useEffect(() => {
    const ta = text.current;
    if (autoFocus && ta) {
      ta.focus({ preventScroll: true });
      if (caretStart) {
        // a handed-in prompt ("Fix this error: …") reads from its first line, not scrolled to the end
        ta.setSelectionRange(0, 0);
        ta.scrollTop = 0;
      }
    }
  }, [autoFocus, caretStart]);

  useEffect(() => {
    if (caret.current !== null && text.current) {
      text.current.focus();
      text.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });

  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes("Files");
  const label2 = lengthLabel(withPastes(value, pastes));

  return (
    <InputGroup
      data-dropping={dropping > 0 || undefined}
      className={cn(
        "bg-card data-dropping:border-ring data-dropping:bg-primary/5 dark:bg-card",
        className
      )}
      onDragEnter={e => hasFiles(e) && setDropping(n => n + 1)}
      onDragLeave={() => setDropping(n => Math.max(0, n - 1))}
      onDragOver={e => {
        if (hasFiles(e)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={e => {
        setDropping(0);
        if (fromTransfer(e.dataTransfer)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <InputGroupTextarea
        ref={text}
        rows={rows}
        value={value}
        spellCheck={false}
        aria-label={label}
        placeholder={placeholder}
        className={cn("max-h-52 min-h-16", mono && "font-mono text-[12.5px]")}
        onChange={e => onValueChange(e.target.value)}
        onPaste={e => {
          if (fromTransfer(e.clipboardData)) {
            e.preventDefault(); // a file or a screenshot: attached
            return;
          }
          const pasted = e.clipboardData?.getData("text/plain") || "";
          if (onPastesChange && isLargePaste(pasted)) {
            e.preventDefault();
            onPastesChange([...pastes, pasted]);
          }
        }}
        onKeyDown={e => {
          if (onKey?.(e)) {
            return;
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit?.();
          }
        }}
      />
      <InputGroupAddon align="block-end" className="flex-col items-stretch gap-1.5">
        {(items.length > 0 || busy > 0) && <FileChips files={files} />}
        {pastes.length > 0 && (
          <PasteChips
            pastes={pastes}
            onChange={onPastesChange}
            onEdit={i => {
              const t = pastes[i];
              const ta = text.current;
              const a = ta?.selectionStart ?? value.length;
              const b = ta?.selectionEnd ?? value.length;
              onPastesChange(pastes.filter((_, k) => k !== i));
              onValueChange(value.slice(0, a) + t + value.slice(b));
              caret.current = a + t.length;
            }}
          />
        )}
        <div className="flex items-center gap-1">
          {available && (
            <InputGroupButton title={attachTip} onClick={pick}>
              <PaperclipIcon data-icon="inline-start" />
              Attach
            </InputGroupButton>
          )}
          {tools}
          <InputGroupText className="ml-auto text-xs tabular-nums">
            {count ? label2 : note}
          </InputGroupText>
        </div>
      </InputGroupAddon>
    </InputGroup>
  );
}

/** The attached files as chips: name (click: preview), size, a secret warning, remove. */
export function FileChips({ files }) {
  const { items, busy, remove, confirm, preview } = useStore(files);
  const [shown, setShown] = useState(null);
  return (
    <>
      <ul className="flex flex-wrap gap-1.5" aria-label="Attached files">
        {items.map((a, i) => {
          const found = a.secrets || [];
          const what = [...new Set(found.map(s => s.label))].join(", ");
          const where = found
            .map(
              s =>
                `${s.label}${s.line ? ` (line ${s.line}${s.preview ? `: ${s.preview}` : ""})` : ""}`
            )
            .join("\n");
          const warn = found.length > 0 && !a.secretsOk;
          const Icon = a.image ? ImageIcon : FileIcon;
          return (
            <li
              key={a.path}
              title={a.path}
              className={cn(
                "flex max-w-60 items-center gap-1.5 rounded-full border bg-muted py-0.5 pr-0.5 pl-2.5 text-xs",
                warn && "max-w-full border-working/60 bg-working/10"
              )}
            >
              <Icon className="size-3 shrink-0 text-brand" aria-hidden="true" />
              <button
                type="button"
                className="min-w-0 cursor-zoom-in truncate text-left hover:underline"
                title={`Preview ${a.name}`}
                onClick={() => setShown(a)}
              >
                {a.name}
              </button>
              <small className="text-muted-foreground tabular-nums">{sizeLabel(a.size)}</small>
              {found.length > 0 &&
                (a.secretsOk ? (
                  <small className="text-muted-foreground" title={where}>
                    ⚠ sent anyway
                  </small>
                ) : (
                  <>
                    <small className="cursor-help font-semibold text-working" title={where}>
                      ⚠ {what}?
                    </small>
                    <Button
                      size="xs"
                      variant="secondary"
                      className="rounded-full"
                      title="It's fine: send it as it is"
                      onClick={() => confirm(i)}
                    >
                      Send anyway
                    </Button>
                  </>
                ))}
              <Button
                size="icon-xs"
                variant="ghost"
                className="rounded-full hover:text-destructive"
                aria-label={`Remove ${a.name}`}
                title="Remove"
                onClick={() => remove(i)}
              >
                <XIcon />
              </Button>
            </li>
          );
        })}
        {busy > 0 && (
          <li className="flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
            <Spinner className="size-3" />
            Attaching…
          </li>
        )}
      </ul>
      <FilePreview item={shown} load={preview} onClose={() => setShown(null)} />
    </>
  );
}

/** Large pasted text as chips: open to read it, put it back in the box to edit, remove. */
function PasteChips({ pastes, onChange, onEdit }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = i =>
    setOpen(s => {
      const n = new Set(s);
      if (n.has(i)) {
        n.delete(i);
      } else {
        n.add(i);
      }
      return n;
    });
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Pasted text">
      {pastes.map((p, i) => {
        const lines = p.split("\n");
        const more = lines.length - PASTE_PREVIEW_LINES;
        const isOpen = open.has(i);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: pasted blocks have no identity but their place
          <li key={i} className="rounded-lg border bg-muted text-xs">
            <div className="flex items-center gap-1 py-0.5 pr-0.5 pl-2">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                aria-expanded={isOpen}
                title={`${isOpen ? "Hide" : "Show"} the pasted text`}
                onClick={() => toggle(i)}
              >
                <PilcrowIcon className="size-3 shrink-0 text-brand" aria-hidden="true" />
                Pasted text
                <small className="text-muted-foreground">{lengthLabel(p)}</small>
              </button>
              <Button
                size="xs"
                variant="ghost"
                title="Put the text into the box, to edit it"
                onClick={() => onEdit(i)}
              >
                Edit in box
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                className="hover:text-destructive"
                aria-label="Remove the pasted text"
                title="Remove"
                onClick={() => {
                  setOpen(new Set());
                  onChange(pastes.filter((_, k) => k !== i));
                }}
              >
                <XIcon />
              </Button>
            </div>
            {isOpen && (
              <pre className="max-h-40 overflow-auto border-t px-2.5 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-muted-foreground">
                {lines.slice(0, PASTE_PREVIEW_LINES).join("\n")}
                {more > 0 && `\n… ${more} more line${more === 1 ? "" : "s"}`}
              </pre>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A file, previewed: text with line numbers, a CSV's first rows, an image. */
export function FilePreview({ item, load, onClose }) {
  const [p, setP] = useState(null);
  useEffect(() => {
    if (!item) {
      return;
    }
    let live = true;
    setP(null);
    Promise.resolve(load(item))
      .catch(() => null)
      .then(r => live && setP(r || { kind: "none", note: "It can't be previewed" }));
    return () => {
      live = false;
    };
  }, [item, load]);
  return (
    <Dialog open={!!item} onOpenChange={o => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">{item?.name}</DialogTitle>
          <DialogDescription>
            {p ? [p.size || sizeLabel(item?.size || 0), p.note].filter(Boolean).join(" · ") : " "}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-auto rounded-md border bg-muted/40 text-xs">
          {!p ? (
            <p className="p-3 text-muted-foreground">Loading…</p>
          ) : p.kind === "image" ? (
            <img src={p.dataUrl} alt={item?.name} className="mx-auto max-w-full" />
          ) : p.kind === "table" ? (
            <PreviewTable rows={p.rows} more={p.more} />
          ) : p.kind === "text" ? (
            <>
              <ol className="list-decimal py-2 pr-3 pl-12 font-mono whitespace-pre-wrap marker:text-muted-foreground">
                {p.lines.map((l, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a line is its number
                  <li key={i}>{l || " "}</li>
                ))}
              </ol>
              {p.more && <p className="p-3 text-muted-foreground">The beginning of the file</p>}
            </>
          ) : (
            <p className="p-3 text-muted-foreground">{p.note || "No preview"}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreviewTable({ rows, more }) {
  const [head, ...body] = rows;
  return (
    <>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {head.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a column is its place
              <th key={i} className="border-b px-2 py-1 text-left font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a row is its place
            <tr key={i}>
              {r.map((c, k) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a cell is its place
                <td key={k} className="border-b px-2 py-1">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {more && <p className="p-3 text-muted-foreground">First 100 rows</p>}
    </>
  );
}
