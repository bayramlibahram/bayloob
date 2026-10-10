// Gets a prompt to an agent's terminal. In tmux it's typed in — or queued while the agent is busy, and sent
// when its turn ends. Any other terminal can't be typed into from outside, so the text goes to the
// clipboard and the terminal is brought forward for the user to paste.
const { PromptQueue } = require("./prompt-queue");

class PromptDelivery {
  /**
   * @param queue    PromptQueue
   * @param typeInto (tmuxPane, text) => Promise — types the text and presses Enter
   * @param copy     text => void — clipboard
   * @param focus    session => Promise<{ ok }> — brings the session's terminal forward
   * @param onQueued () => void — the queue changed
   */
  constructor({ queue, typeInto, copy, focus, onQueued = () => {} }) {
    Object.assign(this, { queue, typeInto, copy, focus, onQueued });
  }

  /** → { ok, via: 'tmux' | 'clipboard', queued?, focused? } */
  async deliver(session, text) {
    if (session.term?.tmux) {
      if (PromptQueue.isBusy(session)) {
        this.queue.add(session.id, text);
        this.onQueued();
        return { ok: true, via: "tmux", queued: true };
      }
      await this.typeInto(session.term.tmux, text);
      return { ok: true, via: "tmux" };
    }
    this.copy(text);
    const focused = await this.focus(session).catch(() => null);
    return { ok: true, via: "clipboard", focused: !!focused?.ok };
  }
}

module.exports = { PromptDelivery };
