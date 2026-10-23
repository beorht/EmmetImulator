/**
 * Управляемая по времени последовательность шагов демонстрации:
 * паузы, остановка и перезапуск без «висящих» таймеров.
 */

export class SequenceCancelled extends Error {}

const TICK = 40;

export class TypingSequence {
  constructor() {
    this.generation = 0;
    this.paused = false;
    this.resumeWaiters = [];
  }

  /** Начинает новую последовательность и отменяет предыдущую. */
  start() {
    this.cancel();
    return this.generation;
  }

  cancel() {
    this.generation += 1;
    this.setPaused(false);
  }

  setPaused(paused) {
    this.paused = paused;
    if (!paused) {
      this.resumeWaiters.splice(0).forEach((resume) => resume());
    }
  }

  assertActive(generation) {
    if (generation !== this.generation) throw new SequenceCancelled();
  }

  async wait(ms, generation) {
    let remaining = ms;
    while (remaining > 0) {
      this.assertActive(generation);
      if (this.paused) {
        await new Promise((resume) => this.resumeWaiters.push(resume));
        continue;
      }
      const step = Math.min(TICK, remaining);
      await new Promise((resolve) => setTimeout(resolve, step));
      remaining -= step;
    }
    this.assertActive(generation);
  }

  /** Печатает текст посимвольно с небольшим «человеческим» разбросом скорости. */
  async type(text, onProgress, generation, { speed = 95 } = {}) {
    for (let i = 1; i <= text.length; i += 1) {
      onProgress(text.slice(0, i));
      const pause = '>+^*{[('.includes(text[i - 1]) ? speed * 1.6 : speed;
      await this.wait(pause * (0.75 + Math.random() * 0.5), generation);
    }
  }
}
