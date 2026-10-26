/**
 * Обращения к серверу тренажёра и сохранённый ключ входа.
 * Ключ лежит в localStorage, отдельно для студента и преподавателя, —
 * на общем компьютере его стирает кнопка «Выйти».
 */

export class ApiError extends Error {
  constructor(status, message, closed = false) {
    super(message);
    this.status = status;
    this.closed = closed;
  }
}

async function request(path, { key, body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером. Проверьте подключение.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error ?? 'Ошибка сервера.', Boolean(data.closed));
  return data;
}

export const api = {
  login: (key) => request('/api/login', { body: { key } }),
  me: (key) => request('/api/me', { key }),
  sendEvent: (key, event) => request('/api/events', { key, body: event }),
  overview: (key) => request('/api/admin/overview', { key }),
  reset: (key, studentId) => request('/api/admin/reset', { key, body: { studentId } }),
  reassign: (key, studentId) => request('/api/admin/reassign', { key, body: { studentId } }),
  session: () => request('/api/session'),
  setClosed: (key, closed) => request('/api/admin/session', { key, body: { closed } }),
};

/** Сохранённый ключ: storage недоступен в приватном режиме — тогда вход живёт до перезагрузки. */
export class SavedKey {
  constructor(name) {
    this.name = name;
    this.memory = null;
  }

  get() {
    try {
      return localStorage.getItem(this.name) ?? this.memory;
    } catch {
      return this.memory;
    }
  }

  set(key) {
    this.memory = key;
    try {
      localStorage.setItem(this.name, key);
    } catch {
      // остаётся в памяти
    }
  }

  clear() {
    this.memory = null;
    try {
      localStorage.removeItem(this.name);
    } catch {
      // нечего удалять
    }
  }
}

const RETRY_DELAY = 5000;

/**
 * Отправляет события студента по порядку. Если связи нет — держит их в очереди
 * и повторяет, поэтому короткий обрыв сети не теряет попытки.
 */
export class EventReporter {
  constructor(key, { onConnection, onExpired, onClosed }) {
    this.key = key;
    this.queue = [];
    this.sending = false;
    this.onConnection = onConnection;
    this.onExpired = onExpired;
    this.onClosed = onClosed;
  }

  send(event) {
    this.queue.push(event);
    this.flush();
  }

  async flush() {
    if (this.sending) return;
    this.sending = true;
    while (this.queue.length) {
      try {
        await api.sendEvent(this.key, this.queue[0]);
        this.queue.shift();
        this.onConnection(true);
      } catch (error) {
        if (error.closed) {
          this.queue = [];
          this.onClosed();
          break;
        }
        if (error.status === 401) {
          this.queue = [];
          this.onExpired();
          break;
        }
        if (error.status >= 400) {
          this.queue.shift(); // сервер отверг событие — повтор не поможет
          continue;
        }
        this.onConnection(false);
        this.sending = false;
        setTimeout(() => this.flush(), RETRY_DELAY);
        return;
      }
    }
    this.sending = false;
  }
}
