import { createStore } from "zustand/vanilla";

// Files attached to a prompt or a task, and large pasted text. Main copies each
// file into Bayloob's cache; a prompt carries their paths as `@/path` mentions, a task copies them into its
// folder when it starts. A file that seems to hold a secret isn't sent until the owner says "Send anyway".

// A paste this long (or with this many lines) goes into a chip; shorter text pastes as usual
export const PASTE_MIN_CHARS = 1200;
export const PASTE_MIN_LINES = 20;
export const PASTE_PREVIEW_LINES = 30;

const lineCount = text => (text ? String(text).split("\n").length : 0);

export const isLargePaste = text =>
  text.length >= PASTE_MIN_CHARS || lineCount(text) >= PASTE_MIN_LINES;

/** "245 chars", "3 lines · 1.2k chars" — "" for no text. */
export function lengthLabel(text) {
  const n = String(text || "").length;
  if (!n) {
    return "";
  }
  const chars =
    n < 1000
      ? `${n} char${n === 1 ? "" : "s"}`
      : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k chars`;
  const lines = lineCount(text);
  return lines > 1 ? `${lines} lines · ${chars}` : chars;
}

/** The text, then each pasted block. */
export const withPastes = (text, pastes = []) =>
  [String(text || "").trim(), ...pastes.map(p => p.trim())].filter(Boolean).join("\n\n");

/** The text, then one `@path` per attached file. */
export function withFiles(text, items = []) {
  const refs = items.map(i => `@${/\s/.test(i.path) ? `"${i.path}"` : i.path}`).join(" ");
  return [String(text || "").trim(), refs].filter(Boolean).join("\n\n");
}

export function sizeLabel(n) {
  if (n < 1024) {
    return `${n} B`;
  }
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Files whose secret warning hasn't been answered: nothing is sent while there are any. */
export const unconfirmed = items => items.filter(i => i.secrets?.length && !i.secretsOk);

/** What a task's configuration keeps of a file. */
export const toConfig = items =>
  items.map(({ path, name, size, secretsOk }) => ({ path, name, size, secretsOk: !!secretsOk }));

/** A name for a file that has none of its own (a pasted screenshot). */
export function nameFor(file, now = new Date()) {
  const ext = (file.type.split("/")[1] || "bin").replace("jpeg", "jpg").replace(/\W.*$/, "");
  const stamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return file.name && file.name !== `image.${ext}` ? file.name : `pasted-${stamp}.${ext}`;
}

/**
 * One list of attached files, as a small store a window keeps (and a box shows): { items, busy } and what
 * changes them. opts: { api: the window's uploads API, task: only the types a task takes, onError(text) }.
 */
export function createFiles({ api = null, task = false, onError = () => {} } = {}) {
  return createStore((set, get) => {
    // Runs `fn` (→ { items, errors }) and adds what it attached, once each
    async function add(fn) {
      set(s => ({ busy: s.busy + 1 }));
      try {
        const r = await fn();
        const known = new Set(get().items.map(i => i.path));
        const errors = [...(r?.errors || [])];
        const fresh = [];
        for (const i of r?.items || []) {
          if (known.has(i.path)) {
            continue;
          }
          if (task && i.typeError) {
            errors.push(`${i.name}: ${i.typeError}`);
            continue;
          }
          known.add(i.path);
          fresh.push(i);
        }
        set(s => ({ items: [...s.items, ...fresh] }));
        if (errors.length) {
          onError(`Couldn’t attach ${errors.join("; ")}`);
        }
      } catch (e) {
        onError(`Couldn’t attach: ${e?.message || e}`);
      } finally {
        set(s => ({ busy: s.busy - 1 }));
      }
    }

    return {
      items: [],
      busy: 0,
      available: !!api,

      pick: () => (api ? add(() => api.pick()) : undefined),

      /** Files from a drop or a paste; true when there were files (the caller skips its default). */
      fromTransfer(dt) {
        const files = [...(dt?.files || [])];
        if (!files.length || !api) {
          return false;
        }
        add(async () => {
          const out = { items: [], errors: [] };
          const merge = r => {
            out.items.push(...(r?.items || []));
            out.errors.push(...(r?.errors || []));
          };
          const onDisk = files.filter(f => api.pathFor(f));
          if (onDisk.length) {
            merge(await api.addPaths(onDisk.map(f => api.pathFor(f))));
          }
          // No file on disk (a pasted screenshot, a file dragged from a browser): its bytes
          for (const f of files.filter(x => !api.pathFor(x))) {
            merge(await api.addBytes(nameFor(f), new Uint8Array(await f.arrayBuffer())));
          }
          return out;
        });
        return true;
      },

      remove: i => set(s => ({ items: s.items.filter((_, k) => k !== i) })),
      /** "Send anyway": the owner read the secret warning. */
      confirm: i =>
        set(s => ({ items: s.items.map((f, k) => (k === i ? { ...f, secretsOk: true } : f)) })),
      clear: () => get().items.length && set({ items: [] }),

      /** A saved draft's files again, checked anew (a file that's gone is dropped). */
      async restore(list) {
        set({ items: list?.length && api?.inspect ? await api.inspect(list) : [] });
      },

      preview: item => api?.preview?.(item.path, item.name),
    };
  });
}
