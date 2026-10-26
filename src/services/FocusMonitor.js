/**
 * Замечает, когда ученик уходит со страницы: на другую вкладку, в другое окно
 * или программу (например, к чат-боту), и сколько времени его не было.
 *
 * События blur/visibilitychange срабатывают сразу. Опрос document.hasFocus()
 * раз в секунду ловит остальное: hasFocus() учитывает фокус во вложенном iframe,
 * поэтому клик по предпросмотру уходом не считается, а переключение в другую
 * программу из предпросмотра — считается.
 */

const POLL_INTERVAL = 1000;

export class FocusMonitor {
  constructor({ onReturn, minAway = 2000 }) {
    this.onReturn = onReturn;
    this.minAway = minAway;
    this.awaySince = null;

    const check = () => (document.visibilityState === 'visible' && document.hasFocus() ? this.back() : this.leave());
    window.addEventListener('blur', () => setTimeout(check, 0));
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    setInterval(check, POLL_INTERVAL);
  }

  leave() {
    this.awaySince ??= Date.now();
  }

  back() {
    if (this.awaySince == null) return;
    const ms = Date.now() - this.awaySince;
    this.awaySince = null;
    if (ms >= this.minAway) this.onReturn(ms);
  }
}

export function formatAway(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  return seconds % 60 ? `${minutes} мин ${seconds % 60} с` : `${minutes} мин`;
}
