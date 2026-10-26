import { networkInterfaces } from 'node:os';
import exercises from '../src/data/exercises.json' with { type: 'json' };
import containers from '../src/data/containers.json' with { type: 'json' };
import { Store } from './store.js';

/**
 * HTTP API тренажёра. Работает как middleware и в Vite (dev/preview), и в server/index.js.
 *
 *   POST /api/login                 { key } → роль и имя
 *   GET  /api/me                    план работ и прогресс студента
 *   POST /api/events                { type: 'open' | 'attempt' | 'paste' | 'away', exerciseId, … }
 *   GET  /api/admin/overview        все студенты и их статистика
 *   POST /api/admin/reset           { studentId } — обнулить статистику студента
 *   POST /api/admin/reassign        { studentId } — выдать новый случайный набор работ
 *   GET  /api/session               завершено ли занятие (без ключа)
 *   POST /api/admin/session         { closed } — завершить или снова открыть занятие
 *
 * Пока занятие завершено, студентов не пускают и их события не принимаются —
 * результаты остаются такими, какими были в момент завершения.
 *
 * Ключ передаётся в заголовке Authorization: Bearer <ключ>.
 */

/**
 * План студента: личный случайный набор из банка Emmet, затем раздел «Контейнеры» —
 * он одинаковый для всех и идёт после теории (её показывает клиент).
 */
const CONTAINER_IDS = containers.map((exercise) => exercise.id);
const ALL_EXERCISES = [
  ...exercises.map((exercise) => ({ ...exercise, section: 'emmet' })),
  ...containers,
];

const STATUSES = new Set(['success', 'partial', 'error', 'mismatch']);
const MAX_BODY = 64 * 1024;
const MAX_CODE = 20_000;
const BLOCKED_KINDS = new Set(['paste', 'drop', 'bulk']);
const MAX_AWAY = 12 * 60 * 60 * 1000;

// Защита от перебора ключей: не больше 10 неудачных входов за 5 минут с одного адреса.
const LOGIN_WINDOW = 5 * 60 * 1000;
const LOGIN_LIMIT = 10;

const FINISHED = 'Занятие окончено. Ваши результаты сохранены.';

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Слишком большой запрос.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Некорректный JSON.');
  }
}

/** Адреса этого компьютера в локальной сети — по ним заходят студенты. */
function siteUrls(req) {
  const port = /:(\d+)$/.exec(req.headers.host ?? '')?.[1];
  return Object.values(networkInterfaces())
    .flat()
    .filter((address) => address?.family === 'IPv4' && !address.internal)
    .map((address) => `http://${address.address}${port ? `:${port}` : ''}`);
}

const bearer = (req) => /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];

export function createApi({ store = new Store() } = {}) {
  const failures = new Map();

  function checkRateLimit(ip) {
    const now = Date.now();
    const recent = (failures.get(ip) ?? []).filter((time) => now - time < LOGIN_WINDOW);
    failures.set(ip, recent);
    if (recent.length >= LOGIN_LIMIT) {
      throw new HttpError(429, 'Слишком много попыток входа. Подождите несколько минут.');
    }
  }

  function authenticate(req, role) {
    const account = store.findByKey(bearer(req));
    if (!account) throw new HttpError(401, 'Войдите заново: ключ не найден.');
    if (account.role !== role) throw new HttpError(403, 'Недостаточно прав.');
    // 401 — чтобы и вкладки, открытые до завершения, сразу ушли со страницы работы.
    if (role === 'student' && store.closed) throw new HttpError(401, FINISHED, { closed: true });
    return account;
  }

  async function studentIdFrom(req) {
    const { studentId } = await readBody(req);
    if (!store.accounts.students.some((student) => student.id === studentId)) {
      throw new HttpError(404, 'Студент не найден.');
    }
    return studentId;
  }

  const planOf = (id) => [...store.assignmentOf(id, exercises), ...CONTAINER_IDS];

  function progressOf(id) {
    const solved = Object.entries(store.studentStats(id).exercises)
      .filter(([, item]) => item.solvedAt)
      .map(([exerciseId]) => exerciseId);
    return { solved };
  }

  function parseEvent(body, assignment) {
    const { type, exerciseId } = body;
    if (!assignment.includes(exerciseId)) throw new HttpError(400, 'Этой работы нет в вашем наборе.');
    if (type === 'open') return { type, exerciseId };
    if (type === 'paste' && BLOCKED_KINDS.has(body.kind)) return { type, exerciseId, kind: body.kind };
    if (type === 'away' && Number.isFinite(body.ms) && body.ms > 0) {
      return { type, exerciseId, ms: Math.min(Math.round(body.ms), MAX_AWAY) };
    }
    if (type === 'attempt' && STATUSES.has(body.status)) {
      return {
        type,
        exerciseId,
        status: body.status,
        handwritten: Boolean(body.handwritten),
        code: String(body.code ?? '').slice(0, MAX_CODE),
      };
    }
    throw new HttpError(400, 'Некорректное событие.');
  }

  const routes = {
    'POST /api/login': async (req) => {
      const ip = req.socket.remoteAddress;
      checkRateLimit(ip);
      const { key } = await readBody(req);
      const account = store.findByKey(key);
      if (!account) {
        failures.get(ip).push(Date.now());
        throw new HttpError(401, 'Такого ID нет. Проверьте, нет ли опечатки.');
      }
      if (account.role === 'admin') return { role: 'admin' };
      if (store.closed) throw new HttpError(423, FINISHED, { closed: true });
      store.touch(account.student.id);
      return { role: 'student', student: { id: account.student.id, name: account.student.name } };
    },

    'GET /api/me': (req) => {
      const { student } = authenticate(req, 'student');
      return {
        student: { id: student.id, name: student.name },
        assignment: planOf(student.id),
        progress: progressOf(student.id),
      };
    },

    'POST /api/events': async (req) => {
      const { student } = authenticate(req, 'student');
      store.record(student.id, parseEvent(await readBody(req), planOf(student.id)));
      return { ok: true };
    },

    'GET /api/session': () => ({ closed: store.closed }),

    'GET /api/admin/overview': (req) => {
      authenticate(req, 'admin');
      return {
        closedAt: store.session.closedAt,
        siteUrls: siteUrls(req),
        exercises: ALL_EXERCISES.map(({ id, title, difficulty, section }) => ({ id, title, difficulty, section })),
        // Наборы выдаются заранее — преподаватель видит их ещё до первого входа студента.
        students: store.accounts.students.map(({ id, name, key }) => {
          const assignment = planOf(id);
          return { id, name, key, ...store.studentStats(id), assignment };
        }),
      };
    },

    'POST /api/admin/reset': async (req) => {
      authenticate(req, 'admin');
      store.reset(await studentIdFrom(req));
      return { ok: true };
    },

    'POST /api/admin/reassign': async (req) => {
      authenticate(req, 'admin');
      store.reassign(await studentIdFrom(req), exercises);
      return { ok: true };
    },

    'POST /api/admin/session': async (req) => {
      authenticate(req, 'admin');
      const { closed } = await readBody(req);
      if (typeof closed !== 'boolean') throw new HttpError(400, 'Укажите closed: true или false.');
      store.setClosed(closed);
      return { closedAt: store.session.closedAt };
    },
  };

  const middleware = async (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    if (!path.startsWith('/api/')) return next?.();
    const route = routes[`${req.method} ${path}`];
    try {
      if (!route) throw new HttpError(404, 'Нет такого адреса API.');
      send(res, 200, await route(req));
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(error);
      send(res, error.status ?? 500, { error: error.status ? error.message : 'Ошибка сервера.', ...error.extra });
    }
  };
  middleware.store = store;
  return middleware;
}
