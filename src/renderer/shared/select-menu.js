// A styled menu in place of a native <select>'s popup (Chromium paints that one itself, white and plain).
// The <select> stays the source of truth — its value, options, `change` event, `disabled` and `hidden`
// all keep working, so callers don't change — and a button + listbox are drawn on top of it.
// Loaded as a classic script after ui-common.js (uses esc), so `SelectMenu` is a global.
//
// Per <option>, optional:
//   data-label  the text in the menu, when it differs from the closed button's (the option text)
//   data-hint   a dimmer second line in the menu
//   data-sep    a divider above this option

const SELECT_MENU_CHECK =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

class SelectMenu {
  static #n = 0;
  static #open = null; // the one menu open at a time

  /** Draws `select` as a SelectMenu (once); returns it. */
  static enhance(select) {
    return select.selectMenu || new SelectMenu(select);
  }

  /** Every <select> under `root`, now and as pages render more (innerHTML re-renders included). */
  static auto(root = document.body) {
    for (const s of root.querySelectorAll("select")) {
      SelectMenu.enhance(s);
    }
    new MutationObserver(records => {
      for (const r of records) {
        for (const n of r.removedNodes) {
          if (n.nodeType === 1 && !n.isConnected) {
            for (const s of n.matches("select") ? [n] : n.querySelectorAll("select")) {
              s.selectMenu?.destroy();
            }
          }
        }
        for (const n of r.addedNodes) {
          if (n.nodeType === 1 && !n.classList.contains("smenu")) {
            for (const s of n.matches("select") ? [n] : n.querySelectorAll("select")) {
              SelectMenu.enhance(s);
            }
          }
        }
      }
    }).observe(root, { childList: true, subtree: true });
  }

  #at = -1; // the highlighted option
  #keyboard = false; // opened from the keyboard (its focus ring comes back with it)
  #typed = "";
  #typedAt = 0;

  constructor(select) {
    this.select = select;
    select.selectMenu = this;
    const id = `smenu-${++SelectMenu.#n}`;

    this.button = document.createElement("button");
    this.button.type = "button";
    // the select's classes, so a page's own look for it carries over; none: the shared field look
    this.button.className = `${select.className || "smenu-default"} smenu-trigger`;
    this.button.setAttribute("aria-haspopup", "listbox");
    this.button.setAttribute("aria-expanded", "false");
    this.button.setAttribute("aria-controls", id);
    for (const a of ["aria-label", "title"]) {
      if (select.hasAttribute(a)) {
        this.button.setAttribute(a, select.getAttribute(a));
      }
    }
    this.button.innerHTML = '<span class="smenu-value"></span>';

    this.list = document.createElement("div");
    this.list.className = "smenu";
    this.list.id = id;
    this.list.setAttribute("role", "listbox");
    this.list.tabIndex = -1;
    this.list.hidden = true;
    if (select.hasAttribute("aria-label")) {
      this.list.setAttribute("aria-label", select.getAttribute("aria-label"));
    }

    select.classList.add("smenu-native");
    select.tabIndex = -1;
    select.after(this.button);
    document.body.append(this.list);

    // `select.value = …` fires no event: wrap it so the button follows
    const proto = HTMLSelectElement.prototype;
    for (const p of ["value", "selectedIndex"]) {
      const d = Object.getOwnPropertyDescriptor(proto, p);
      Object.defineProperty(select, p, {
        configurable: true,
        get: () => d.get.call(select),
        set: v => {
          d.set.call(select, v);
          this.sync();
        },
      });
    }
    new MutationObserver(() => this.sync()).observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "disabled", "selected", "label"],
    });
    select.addEventListener("change", () => this.sync());
    // A <label> for the select (around it or with for=) focuses the button instead of the hidden select
    for (const l of select.labels || []) {
      l.addEventListener("click", e => {
        if (!this.button.contains(e.target)) {
          e.preventDefault();
          refocus(this.button, false); // a click: no keyboard ring
        }
      });
    }

    this.button.addEventListener("click", e => {
      this.#keyboard = !e.detail; // a click from Enter / Space has no detail
      return this.isOpen ? this.close() : this.open();
    });
    this.button.addEventListener("keydown", e => this.#buttonKey(e));
    this.list.addEventListener("keydown", e => this.#listKey(e));
    this.list.addEventListener("click", e => {
      const o = e.target.closest("[data-i]");
      if (o && !o.classList.contains("off")) {
        this.#choose(+o.dataset.i);
      }
    });
    this.list.addEventListener("pointermove", e => {
      const o = e.target.closest("[data-i]");
      if (o && +o.dataset.i !== this.#at) {
        this.#highlight(+o.dataset.i, false);
      }
    });
    this.sync();
  }

  /** The select left the page: its menu (on <body>) goes too. */
  destroy() {
    this.close(false);
    this.list.remove();
    this.button.remove();
  }

  get isOpen() {
    return !this.list.hidden;
  }

  /** The button mirrors the select: its chosen option's text, hidden, disabled. */
  sync() {
    const s = this.select;
    const o = s.options[s.selectedIndex];
    this.button.querySelector(".smenu-value").textContent = o ? o.text : "";
    this.button.hidden = s.hidden;
    this.button.disabled = s.disabled;
    if (this.isOpen && (s.hidden || s.disabled)) {
      this.close(false);
    } else if (this.isOpen) {
      this.#render();
    }
  }

  open() {
    if (this.select.disabled || this.isOpen) {
      return;
    }
    SelectMenu.#open?.close(false);
    SelectMenu.#open = this;
    this.#at = this.select.selectedIndex;
    this.#render();
    this.list.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.#place();
    this.list.focus({ preventScroll: true });
    this.#scrollTo(this.#at);
    document.addEventListener("pointerdown", this.#outside, true);
    window.addEventListener("blur", this.#dismiss);
    window.addEventListener("resize", this.#follow);
    document.addEventListener("scroll", this.#scrolled, true);
  }

  close(giveFocusBack = true) {
    if (!this.isOpen) {
      return;
    }
    this.list.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    this.list.removeAttribute("aria-activedescendant");
    if (SelectMenu.#open === this) {
      SelectMenu.#open = null;
    }
    document.removeEventListener("pointerdown", this.#outside, true);
    window.removeEventListener("blur", this.#dismiss);
    window.removeEventListener("resize", this.#follow);
    document.removeEventListener("scroll", this.#scrolled, true);
    if (giveFocusBack) {
      refocus(this.button, this.#keyboard); // the ring only when it was opened from the keyboard
    }
  }

  #outside = e => {
    if (!this.list.contains(e.target) && !this.button.contains(e.target)) {
      this.close(false);
    }
  };
  #dismiss = () => this.close(false);
  // Something else scrolled — e.g. an agent's live output under the menu: the menu stays. Only when what moved holds
  // the button does the menu follow it, and it closes once the button is out of sight.
  #scrolled = e => {
    const t = e.target === document ? document.documentElement : e.target;
    if (!this.list.contains(t) && t.contains?.(this.button)) {
      this.#follow();
    }
  };
  // The window resized (the pill's panel fits its content) or the button moved: the menu goes with it
  #follow = () => {
    const r = this.button.getBoundingClientRect();
    const vh = document.documentElement.clientHeight;
    if (!r.width || r.bottom < 0 || r.top > vh) {
      return this.close(false);
    }
    this.#place();
  };

  #render() {
    const s = this.select;
    const id = this.list.id;
    this.list.innerHTML = [...s.options]
      .map((o, i) => {
        const on = i === s.selectedIndex;
        const label = o.dataset.label || o.text;
        const hint = o.dataset.hint ? `<small>${esc(o.dataset.hint)}</small>` : "";
        return `${o.dataset.sep !== undefined && i ? '<div class="smenu-sep" role="separator"></div>' : ""}<div class="smenu-opt${on ? " on" : ""}${o.disabled ? " off" : ""}${i === this.#at ? " at" : ""}" role="option" id="${id}-${i}" data-i="${i}" aria-selected="${on}"${o.disabled ? ' aria-disabled="true"' : ""}><span class="smenu-check">${on ? SELECT_MENU_CHECK : ""}</span><span class="smenu-text"><span>${esc(label)}</span>${hint}</span></div>`;
      })
      .join("");
    if (this.#at >= 0) {
      this.list.setAttribute("aria-activedescendant", `${id}-${this.#at}`);
    }
  }

  // Below the button when it fits, else above (the prompt boxes sit at the bottom of the window)
  #place() {
    const gap = 6;
    const pad = 8;
    const r = this.button.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const l = this.list;
    l.style.maxHeight = "";
    l.style.minWidth = `${Math.min(Math.max(r.width, 200), vw - 2 * pad)}px`;
    l.style.maxWidth = `${vw - 2 * pad}px`;
    const below = vh - r.bottom - gap - pad;
    const above = r.top - gap - pad;
    const h = l.scrollHeight + 2;
    const down = h <= below || below >= above;
    l.style.maxHeight = `${Math.max(down ? below : above, 80)}px`;
    l.style.top = down ? `${r.bottom + gap}px` : "";
    l.style.bottom = down ? "" : `${vh - r.top + gap}px`;
    l.classList.toggle("up", !down);
    const w = l.offsetWidth;
    l.style.left = `${Math.max(pad, Math.min(r.left, vw - w - pad))}px`;
  }

  #enabled() {
    return [...this.select.options].map((o, i) => (o.disabled ? -1 : i)).filter(i => i >= 0);
  }

  #highlight(i, scroll = true) {
    this.#at = i;
    for (const el of this.list.querySelectorAll(".smenu-opt")) {
      el.classList.toggle("at", +el.dataset.i === i);
    }
    this.list.setAttribute("aria-activedescendant", `${this.list.id}-${i}`);
    if (scroll) {
      this.#scrollTo(i);
    }
  }

  #scrollTo(i) {
    this.list.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
  }

  #move(step) {
    const ok = this.#enabled();
    if (!ok.length) {
      return;
    }
    const k = ok.indexOf(this.#at);
    const next =
      step === "first"
        ? ok[0]
        : step === "last"
          ? ok[ok.length - 1]
          : ok[k < 0 ? 0 : Math.max(0, Math.min(ok.length - 1, k + step))];
    this.#highlight(next);
  }

  #choose(i) {
    const changed = i !== this.select.selectedIndex;
    this.select.selectedIndex = i;
    this.close();
    if (changed) {
      this.select.dispatchEvent(new Event("input", { bubbles: true }));
      this.select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  // Type the first letters of an option to jump to it
  #typeAhead(ch) {
    const now = Date.now();
    this.#typed = (now - this.#typedAt > 700 ? "" : this.#typed) + ch.toLowerCase();
    this.#typedAt = now;
    const opts = [...this.select.options];
    const hit = this.#enabled().find(i =>
      (opts[i].dataset.label || opts[i].text).toLowerCase().startsWith(this.#typed)
    );
    if (hit !== undefined) {
      this.#highlight(hit);
    }
  }

  #buttonKey(e) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      this.#keyboard = true;
      this.open();
    }
  }

  #listKey(e) {
    this.#keyboard = true; // picked with the keyboard: the ring comes back on the button
    const keys = {
      ArrowDown: () => this.#move(1),
      ArrowUp: () => this.#move(-1),
      Home: () => this.#move("first"),
      End: () => this.#move("last"),
      PageDown: () => this.#move(5),
      PageUp: () => this.#move(-5),
      Enter: () => this.#at >= 0 && this.#choose(this.#at),
      " ": () => this.#at >= 0 && this.#choose(this.#at),
      Escape: () => this.close(),
    };
    if (e.key === "Tab") {
      return this.close();
    }
    e.stopPropagation(); // the menu's keys are its own: Escape closes it, not the window
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.#typeAhead(e.key);
    }
  }
}
