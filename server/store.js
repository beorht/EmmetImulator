import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAssignment, isValidAssignment } from './assignment.js';

/**
 * Хранилище в JSON-файлах — для одного класса этого достаточно.
 *   accounts.json — студенты с ключами и ключ преподавателя (создаёт `npm run keys`);
 *   stats.json    — набор работ и статистика по каждому студенту и заданию;
 *   session.json  — завершено ли занятие.
 * Запись атомарная (через временный файл), чтобы сбой не испортил данные.
 */

export const DATA_DIR = new URL('./data/', import.meta.url).pathname;

const SAVE_DELAY = 300;

/**
 * Решение подозрительно, если сдано вскоре после долгого ухода со страницы:
 * ушёл больше чем на AWAY_SUSPICIOUS, а принято не позже SOLVE_WINDOW после возвращения.
 */
export const AWAY_SUSPICIOUS = 15_000;
export const SOLVE_WINDOW = 2 * 60_000;

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path, value) {
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
}

/** Ключ без учёта регистра, пробелов и дефисов: «k7m q4p» = «K7M-Q4P». */
export const normalizeKey = (key) => String(key ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const emptyExercise = () => ({
  openedAt: null,
  lastAt: null,
  attempts: 0,
  success: 0,
  partial: 0,
  error: 0,
  mismatch: 0,
  handwritten: 0,
  pastes: 0,
  aways: 0,
  awayMs: 0,
  lastAwayMs: 0,
  lastReturnAt: null,
  solvedAfterAway: false,
  solvedAt: null,
  attemptsToSolve: null,
  lastStatus: null,
  lastCode: '',
  solvedCode: '',
});

export class Store {
  constructor(dir = DATA_DIR) {
    this.accountsPath = join(dir, 'accounts.json');
    this.statsPath = join(dir, 'stats.json');
    this.sessionPath = join(dir, 'session.json');
    mkdirSync(dir, { recursive: true });
    this.stats = readJson(this.statsPath, {});
    this.session = readJson(this.sessionPath, { closedAt: null });
    this.saveTimer = null;
  }

  /** Аккаунты читаются при каждом входе: новые ключи работают без перезапуска сервера. */
  get accounts() {
    return readJson(this.accountsPath, { admin: null, students: [] });
  }

  findByKey(key) {
    const wanted = normalizeKey(key);
    if (!wanted) return null;
    const { admin, students } = this.accounts;
    if (admin && normalizeKey(admin.key) === wanted) return { role: 'admin' };
    const student = students.find((item) => normalizeKey(item.key) === wanted);
    return student ? { role: 'student', student } : null;
  }

  get closed() {
    return Boolean(this.session.closedAt);
  }

  /** Завершает или снова открывает занятие. Сохраняется сразу: состояние переживает перезапуск. */
  setClosed(closed, now = new Date().toISOString()) {
    this.session = { closedAt: closed ? now : null };
    writeJson(this.sessionPath, this.session);
  }

  studentStats(id) {
    this.stats[id] ??= { firstSeen: null, lastSeen: null, assignment: null, exercises: {} };
    return this.stats[id];
  }

  /** Набор работ студента; выдаётся при первом обращении и потом не меняется. */
  assignmentOf(id, exercises) {
    const stats = this.studentStats(id);
    if (!isValidAssignment(stats.assignment, exercises)) {
      stats.assignment = createAssignment(exercises);
      this.scheduleSave();
    }
    return stats.assignment;
  }

  /** Новый случайный набор. Статистика по уже решённым работам сохраняется. */
  reassign(id, exercises) {
    this.studentStats(id).assignment = createAssignment(exercises);
    this.scheduleSave();
  }

  /** Событие от студента: открыл задание или проверил решение. */
  record(id, event, now = new Date().toISOString()) {
    const stats = this.studentStats(id);
    stats.firstSeen ??= now;
    stats.lastSeen = now;
    // Записи из прошлых версий дополняются новыми полями.
    const exercise = { ...emptyExercise(), ...stats.exercises[event.exerciseId] };
    stats.exercises[event.exerciseId] = exercise;
    exercise.openedAt ??= now;
    exercise.lastAt = now;

    if (event.type === 'paste') exercise.pastes += 1;

    if (event.type === 'away') {
      exercise.aways += 1;
      exercise.awayMs += event.ms;
      exercise.lastAwayMs = event.ms;
      exercise.lastReturnAt = now;
    }

    if (event.type === 'attempt') {
      exercise.attempts += 1;
      exercise[event.status] += 1;
      if (event.handwritten) exercise.handwritten += 1;
      exercise.lastStatus = event.status;
      exercise.lastCode = event.code;
      if (event.status === 'success' && !exercise.solvedAt) {
        exercise.solvedAt = now;
        exercise.attemptsToSolve = exercise.attempts;
        exercise.solvedCode = event.code;
        exercise.solvedAfterAway = Boolean(exercise.lastReturnAt)
          && exercise.lastAwayMs >= AWAY_SUSPICIOUS
          && Date.parse(now) - Date.parse(exercise.lastReturnAt) <= SOLVE_WINDOW;
      }
    }
    this.scheduleSave();
  }

  touch(id, now = new Date().toISOString()) {
    const stats = this.studentStats(id);
    stats.firstSeen ??= now;
    stats.lastSeen = now;
    this.scheduleSave();
  }

  /** Обнуляет статистику, но оставляет выданный набор работ. */
  reset(id) {
    const assignment = this.stats[id]?.assignment ?? null;
    delete this.stats[id];
    this.studentStats(id).assignment = assignment;
    this.scheduleSave();
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY);
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    writeJson(this.statsPath, this.stats);
  }
}
