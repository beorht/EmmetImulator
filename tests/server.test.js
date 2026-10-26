// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../server/api.js';
import { Store, normalizeKey, writeJson } from '../server/store.js';
import { createAssignment, isValidAssignment, PLAN } from '../server/assignment.js';
import pool from '../src/data/exercises.json' with { type: 'json' };
import containers from '../src/data/containers.json' with { type: 'json' };
import { cellState, summarize, taskTotals, toCsv, formatDuration, flagsOf, isAssigned } from '../src/admin/stats.js';

const STUDENT_KEY = 'stWeb-042';
const ADMIN_KEY = 'ADM-TEST-0001';

let dir;
let server;
let base;
let store;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'emmet-'));
  writeJson(join(dir, 'accounts.json'), {
    admin: { key: ADMIN_KEY },
    students: [{ id: 's01', name: 'Иванова Анна', key: STUDENT_KEY }],
  });
  store = new Store(dir);
  const api = createApi({ store });
  server = createServer((req, res) => api(req, res, () => res.writeHead(404).end()));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server.close();
  clearTimeout(store.saveTimer);
  rmSync(dir, { recursive: true, force: true });
});

const call = async (path, { key, body } = {}) => {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
};

describe('вход', () => {
  it('ключ не зависит от регистра, пробелов и дефиса', () => {
    expect(normalizeKey(' STWEB 042 ')).toBe(normalizeKey(STUDENT_KEY));
  });

  it('студент и преподаватель входят по своим ключам', async () => {
    expect((await call('/api/login', { body: { key: 'stweb042' } })).data)
      .toEqual({ role: 'student', student: { id: 's01', name: 'Иванова Анна' } });
    expect((await call('/api/login', { body: { key: ADMIN_KEY } })).data).toEqual({ role: 'admin' });
  });

  it('неверный ключ отклоняется', async () => {
    const { status, data } = await call('/api/login', { body: { key: 'stWeb-999' } });
    expect(status).toBe(401);
    expect(data.error).toMatch(/Такого ID нет/);
  });

  it('студенту закрыта панель преподавателя', async () => {
    expect((await call('/api/admin/overview', { key: STUDENT_KEY })).status).toBe(403);
    expect((await call('/api/admin/overview')).status).toBe(401);
  });
});

const CONTAINER_IDS = containers.map((exercise) => exercise.id);
const emmetPart = (ids) => ids.filter((id) => !CONTAINER_IDS.includes(id));
const levels = (ids) => [1, 2, 3].map((level) => emmetPart(ids).filter((id) => pool.find((e) => e.id === id).difficulty === level).length);

describe('набор работ', () => {
  it('3 лёгких, 2 средних и 5 сложных, от лёгких к сложным, без повторов', () => {
    for (let i = 0; i < 50; i += 1) {
      const ids = createAssignment(pool);
      expect(levels(ids)).toEqual([PLAN[1], PLAN[2], PLAN[3]]);
      expect(new Set(ids).size).toBe(10);
      const order = ids.map((id) => pool.findIndex((e) => e.id === id));
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(isValidAssignment(ids, pool)).toBe(true);
    }
    expect(isValidAssignment(['practice-01'], pool)).toBe(false);
  });

  it('у разных студентов наборы различаются', () => {
    const sets = new Set(Array.from({ length: 20 }, () => createAssignment(pool).join()));
    expect(sets.size).toBeGreaterThan(1);
  });

  it('набор выдаётся один раз и не меняется между входами', async () => {
    const first = (await call('/api/me', { key: STUDENT_KEY })).data.assignment;
    expect(emmetPart(first)).toHaveLength(10);
    expect((await call('/api/me', { key: STUDENT_KEY })).data.assignment).toEqual(first);
  });

  it('после личного набора Emmet идут 10 заданий на контейнеры — одинаковые для всех', async () => {
    const plan = (await call('/api/me', { key: STUDENT_KEY })).data.assignment;
    expect(plan).toHaveLength(20);
    expect(plan.slice(10)).toEqual(CONTAINER_IDS);
    const { status } = await call('/api/events', { key: STUDENT_KEY, body: { type: 'open', exerciseId: CONTAINER_IDS[0] } });
    expect(status).toBe(200);
  });
});

describe('статистика', () => {
  let ids;
  beforeAll(async () => {
    ids = (await call('/api/me', { key: STUDENT_KEY })).data.assignment;
  });

  it('считает попытки до решения и ручной ввод, прогресс видят студент и преподаватель', async () => {
    const send = (event) => call('/api/events', { key: STUDENT_KEY, body: event });
    await send({ type: 'open', exerciseId: ids[0] });
    await send({ type: 'attempt', exerciseId: ids[0], status: 'error', handwritten: true, code: '<p></p>' });
    await send({ type: 'attempt', exerciseId: ids[0], status: 'success', code: '<p class="caption">Фото дня</p>' });
    await send({ type: 'attempt', exerciseId: ids[0], status: 'success', code: 'повтор' });

    expect((await call('/api/me', { key: STUDENT_KEY })).data.progress).toEqual({ solved: [ids[0]] });

    const { data } = await call('/api/admin/overview', { key: ADMIN_KEY });
    const item = data.students[0].exercises[ids[0]];
    expect(item).toMatchObject({ attempts: 3, attemptsToSolve: 2, success: 2, error: 1, handwritten: 1 });
    expect(item.solvedCode).toBe('<p class="caption">Фото дня</p>');
    expect(data.exercises).toHaveLength(40);
    expect(data.exercises.filter((exercise) => exercise.section === 'containers')).toHaveLength(10);
    expect(data.students[0].assignment).toEqual(ids);
  });

  it('фиксирует попытки вставки и уходы со страницы, помечает решение сразу после ухода', async () => {
    const send = (event) => call('/api/events', { key: STUDENT_KEY, body: event });
    await send({ type: 'paste', exerciseId: ids[1], kind: 'paste' });
    await send({ type: 'paste', exerciseId: ids[1], kind: 'bulk' });
    await send({ type: 'away', exerciseId: ids[1], ms: 3000 });
    await send({ type: 'away', exerciseId: ids[1], ms: 45_000 });
    await send({ type: 'attempt', exerciseId: ids[1], status: 'success', code: '<button id="send">Отправить</button>' });
    await send({ type: 'away', exerciseId: ids[2], ms: 2000 });
    await send({ type: 'attempt', exerciseId: ids[2], status: 'success', code: '<div></div>' });

    const { data } = await call('/api/admin/overview', { key: ADMIN_KEY });
    const { exercises } = data.students[0];
    expect(exercises[ids[1]]).toMatchObject({ pastes: 2, aways: 2, awayMs: 48_000, solvedAfterAway: true });
    // Короткий уход (2 с) — не повод подозревать.
    expect(exercises[ids[2]].solvedAfterAway).toBe(false);
  });

  it('не принимает события по работам не из своего набора', async () => {
    const foreign = pool.find((exercise) => !ids.includes(exercise.id)).id;
    const { status, data } = await call('/api/events', { key: STUDENT_KEY, body: { type: 'open', exerciseId: foreign } });
    expect(status).toBe(400);
    expect(data.error).toMatch(/нет в вашем наборе/);
  });

  it('отклоняет неизвестные задания и статусы', async () => {
    expect((await call('/api/events', { key: STUDENT_KEY, body: { type: 'open', exerciseId: 'nope' } })).status).toBe(400);
    expect((await call('/api/events', {
      key: STUDENT_KEY, body: { type: 'attempt', exerciseId: ids[1], status: 'hacked' },
    })).status).toBe(400);
    expect((await call('/api/events', { key: STUDENT_KEY, body: { type: 'paste', exerciseId: ids[1], kind: 'x' } })).status).toBe(400);
    expect((await call('/api/events', { key: STUDENT_KEY, body: { type: 'away', exerciseId: ids[1], ms: -5 } })).status).toBe(400);
  });

  it('сброс статистики сохраняет набор, «Новый набор» его меняет', async () => {
    expect((await call('/api/admin/reset', { key: ADMIN_KEY, body: { studentId: 's01' } })).status).toBe(200);
    const after = (await call('/api/me', { key: STUDENT_KEY })).data;
    expect(after.progress.solved).toEqual([]);
    expect(after.assignment).toEqual(ids);

    expect((await call('/api/admin/reassign', { key: ADMIN_KEY, body: { studentId: 's01' } })).status).toBe(200);
    const fresh = (await call('/api/me', { key: STUDENT_KEY })).data.assignment;
    expect(emmetPart(fresh)).not.toEqual(emmetPart(ids));
    expect(fresh.slice(10)).toEqual(CONTAINER_IDS);
    expect(levels(fresh)).toEqual([3, 2, 5]);
    expect((await call('/api/admin/reassign', { key: STUDENT_KEY, body: { studentId: 's01' } })).status).toBe(403);
  });
});

describe('завершение занятия', () => {
  it('после завершения студента не пускают и события не принимаются, после открытия — снова можно', async () => {
    const [exerciseId] = (await call('/api/me', { key: STUDENT_KEY })).data.assignment;
    expect((await call('/api/admin/session', { key: STUDENT_KEY, body: { closed: true } })).status).toBe(403);

    expect((await call('/api/admin/session', { key: ADMIN_KEY, body: { closed: true } })).data.closedAt).toBeTruthy();
    expect((await call('/api/session')).data).toEqual({ closed: true });
    expect((await call('/api/login', { body: { key: STUDENT_KEY } })).data.closed).toBe(true);
    expect((await call('/api/me', { key: STUDENT_KEY })).data.closed).toBe(true);

    const before = store.studentStats('s01').exercises[exerciseId]?.attempts ?? 0;
    const late = await call('/api/events', {
      key: STUDENT_KEY,
      body: { type: 'attempt', exerciseId, status: 'success', handwritten: true, code: '<p></p>' },
    });
    expect(late).toMatchObject({ status: 401, data: { closed: true } });
    expect(store.studentStats('s01').exercises[exerciseId]?.attempts ?? 0).toBe(before);
    expect((await call('/api/admin/overview', { key: ADMIN_KEY })).data.closedAt).toBeTruthy();
    // Состояние хранится на диске и переживает перезапуск сервера.
    expect(new Store(dir).closed).toBe(true);

    await call('/api/admin/session', { key: ADMIN_KEY, body: { closed: false } });
    expect((await call('/api/session')).data).toEqual({ closed: false });
    expect((await call('/api/me', { key: STUDENT_KEY })).status).toBe(200);
  });
});

describe('расчёты панели', () => {
  const exercises = [{ id: 'a', title: 'Первая' }, { id: 'b', title: 'Вторая' }];
  const student = {
    id: 's01', name: 'Иванова Анна', key: STUDENT_KEY,
    exercises: {
      a: {
        attempts: 3, attemptsToSolve: 2, handwritten: 1, pastes: 2, aways: 1, awayMs: 30_000, solvedAfterAway: true,
        solvedAt: '2026-10-23T10:05:00Z', openedAt: '2026-10-23T10:00:00Z',
      },
      b: { attempts: 0, handwritten: 0, solvedAt: null },
    },
  };

  it('состояния ячеек и итоги', () => {
    expect([cellState(student.exercises.a), cellState(student.exercises.b), cellState(undefined)])
      .toEqual(['solved', 'opened', 'none']);
    expect(summarize(student, exercises)).toEqual({
      total: 2, solved: 1, attempts: 3, handwritten: 1, pastes: 2, violations: 3, aways: 1, awayMs: 30_000, suspicious: 1, avgToSolve: 2,
    });
    expect(flagsOf(student.exercises.a)).toEqual(['HTML вручную: 1', 'попыток вставки: 2', 'решено сразу после ухода со страницы']);
    expect(flagsOf(student.exercises.b)).toEqual([]);
    expect(taskTotals(exercises[0], [student])).toEqual({ assigned: 1, solved: 1, tried: 0, avgToSolve: 2 });
    // Работа не из набора — «не выдано» и не входит в итоги.
    const limited = { ...student, assignment: ['a'] };
    expect(cellState(student.exercises.b, isAssigned(limited, exercises[1]))).toBe('unassigned');
    expect(summarize(limited, exercises).total).toBe(1);
    expect(taskTotals(exercises[1], [limited]).assigned).toBe(0);
    expect(formatDuration(student.exercises.a.openedAt, student.exercises.a.solvedAt)).toBe('5 мин 0 с');
  });

  it('CSV открывается в Excel: BOM, разделитель «;»', () => {
    const csv = toCsv([student], exercises);
    expect(csv.startsWith('﻿ФИО;ID;Решено')).toBe(true);
    expect(csv).toContain('Иванова Анна;stWeb-042;1/2;3;2,0;1;2;1;30 с;1;');
    expect(csv).toContain('решено (2) ⚠;открыто');
  });
});
