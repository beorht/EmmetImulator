/** Расчёты для панели преподавателя: итоги по студенту, по заданию и выгрузка в CSV. */

export const ONLINE_WINDOW = 5 * 60 * 1000;

/** Работы из набора студента в порядке набора (без набора — весь банк). */
export function assignedExercises(student, exercises) {
  if (!student.assignment) return exercises;
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  return student.assignment.map((id) => byId.get(id)).filter(Boolean);
}

export const isAssigned = (student, exercise) => !student.assignment || student.assignment.includes(exercise.id);

/** Состояние ячейки «студент × задание». */
export function cellState(item, assigned = true) {
  if (!assigned) return 'unassigned';
  if (!item) return 'none';
  if (item.solvedAt) return 'solved';
  if (item.attempts) return 'tried';
  return 'opened';
}

export const STATE_LABEL = {
  solved: 'решено',
  tried: 'не решено',
  opened: 'открыто',
  none: 'не открыто',
  unassigned: 'не выдано',
};

/**
 * Признаки списывания по одной работе: HTML набран вручную, попытки вставки,
 * решение сдано сразу после долгого ухода со страницы.
 */
export function flagsOf(item) {
  if (!item) return [];
  const flags = [];
  if (item.handwritten) flags.push(`HTML вручную: ${item.handwritten}`);
  if (item.pastes) flags.push(`попыток вставки: ${item.pastes}`);
  if (item.solvedAfterAway) flags.push('решено сразу после ухода со страницы');
  return flags;
}

const sum = (items, field) => items.reduce((total, item) => total + (item[field] ?? 0), 0);

export function summarize(student, exercises) {
  const assigned = assignedExercises(student, exercises);
  const items = assigned.map((exercise) => student.exercises[exercise.id]).filter(Boolean);
  const solved = items.filter((item) => item.solvedAt);
  const handwritten = sum(items, 'handwritten');
  const pastes = sum(items, 'pastes');
  return {
    total: assigned.length,
    solved: solved.length,
    attempts: sum(items, 'attempts'),
    handwritten,
    pastes,
    violations: handwritten + pastes,
    aways: sum(items, 'aways'),
    awayMs: sum(items, 'awayMs'),
    suspicious: items.filter((item) => item.solvedAfterAway).length,
    avgToSolve: solved.length
      ? solved.reduce((sum, item) => sum + item.attemptsToSolve, 0) / solved.length
      : null,
  };
}

export function taskTotals(exercise, students) {
  const owners = students.filter((student) => isAssigned(student, exercise));
  const items = owners.map((student) => student.exercises[exercise.id]).filter(Boolean);
  const solved = items.filter((item) => item.solvedAt);
  return {
    assigned: owners.length,
    solved: solved.length,
    tried: items.filter((item) => item.attempts && !item.solvedAt).length,
    avgToSolve: solved.length
      ? solved.reduce((sum, item) => sum + item.attemptsToSolve, 0) / solved.length
      : null,
  };
}

export function isOnline(student, now = Date.now()) {
  return Boolean(student.lastSeen) && now - Date.parse(student.lastSeen) < ONLINE_WINDOW;
}

const pad = (value) => String(value).padStart(2, '0');
const clock = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

export function formatRelative(iso, now = new Date()) {
  if (!iso) return '—';
  const date = new Date(iso);
  const minutes = Math.floor((now - date) / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  if (date.toDateString() === now.toDateString()) return `сегодня в ${clock(date)}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `вчера в ${clock(date)}`;
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${clock(date)}`;
}

export function formatDuration(fromIso, toIso) {
  if (!fromIso || !toIso) return '—';
  const seconds = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000));
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин ${seconds % 60} с`;
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

/** Суммарное время вне страницы: «45 с», «12 мин», «1 ч 5 мин». */
export function formatAwayTotal(ms) {
  if (!ms) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} мин` : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

export const formatAverage = (value) => (value == null ? '—' : value.toFixed(1).replace('.', ','));

const csvCell = (value) => {
  const text = String(value ?? '');
  return /[;"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** Таблица для Excel: разделитель «;» и BOM, чтобы кириллица открылась без настройки. */
export function toCsv(students, exercises) {
  const header = [
    'ФИО', 'ID', 'Решено', 'Попыток', 'Ср. попыток до решения', 'HTML вручную', 'Попыток вставки',
    'Уходов со страницы', 'Вне страницы', 'Решено сразу после ухода', 'Последняя активность',
    ...exercises.map((exercise, i) => `${i + 1}. ${exercise.title}`),
  ];
  const rows = students.map((student) => {
    const total = summarize(student, exercises);
    return [
      student.name,
      student.key,
      `${total.solved}/${total.total}`,
      total.attempts,
      formatAverage(total.avgToSolve),
      total.handwritten,
      total.pastes,
      total.aways,
      formatAwayTotal(total.awayMs),
      total.suspicious,
      student.lastSeen ? new Date(student.lastSeen).toLocaleString('ru-RU') : '',
      ...exercises.map((exercise) => {
        const item = student.exercises[exercise.id];
        const state = cellState(item, isAssigned(student, exercise));
        if (state === 'solved') return `решено (${item.attemptsToSolve})${item.solvedAfterAway ? ' ⚠' : ''}`;
        if (state === 'tried') return `не решено (${item.attempts})`;
        return STATE_LABEL[state];
      }),
    ];
  });
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
