// Gets a prompt to an agent's terminal. In tmux it's typed in — or queued while the agent is busy, and sent
// when its turn ends. Any other terminal can't be typed into from outside, so the text goes to the
// clipboard and the terminal is brought forward for the user to paste.
const { PromptQueue } = require("./prompt-queue");

class PromptDelivery {
  /**
   * @param queue    PromptQueue
   * @param typeInto (tmuxPane, text) => Promise — types the text and presses Enter
   * @param hasPane  tmuxPane => Promise<boolean> — the pane still exists (a gone one falls back to the clipboard)
   * @param copy     text => void — clipboard
   * @param focus    session => Promise<{ ok }> — brings the session's terminal forward
   * @param onQueued () => void — the queue changed
   */
  constructor({ queue, typeInto, copy, focus, hasPane = async () => true, onQueued = () => {} }) {
    Object.assign(this, { queue, typeInto, copy, focus, hasPane, onQueued });
  }

  /** → { ok, via: 'tmux' | 'clipboard', queued?, focused? } */
  async deliver(session, text) {
    const pane = session.term?.tmux;
    if (pane && (await this.hasPane(pane))) {
      if (PromptQueue.isBusy(session)) {
        this.queue.add(session.id, text);
        this.onQueued();
        return { ok: true, via: "tmux", queued: true };
      }
      try {
        await this.typeInto(pane, text);
        return { ok: true, via: "tmux" };
      } catch (error) {
        // The pane can disappear between the check above and send-keys. Only hide that race;
        // errors from a pane that is still alive (for example, the agent exited to a shell) matter.
        if (await this.hasPane(pane)) {
          throw error;
        }
      }
    }
    this.copy(text);
    const focused = await this.focus(session).catch(() => null);
    return { ok: true, via: "clipboard", focused: !!focused?.ok };
  }
}

module.exports = { PromptDelivery };
