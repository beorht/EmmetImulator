import { randomInt } from 'node:crypto';

/**
 * Персональный набор работ: из общего банка каждому студенту случайно
 * выбирается PLAN[уровень] работ каждого уровня. Внутри набора работы идут
 * от лёгких к сложным в порядке банка, поэтому сложность растёт плавно,
 * а у соседей по парте наборы разные.
 */
export const PLAN = { 1: 3, 2: 2, 3: 5 };

export const ASSIGNMENT_SIZE = Object.values(PLAN).reduce((a, b) => a + b, 0);

function pick(items, count) {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export function createAssignment(exercises) {
  const chosen = new Set();
  for (const [level, count] of Object.entries(PLAN)) {
    const candidates = exercises.filter((exercise) => exercise.difficulty === Number(level));
    if (candidates.length < count) {
      throw new Error(`В банке ${candidates.length} работ уровня ${level}, а в наборе нужно ${count}.`);
    }
    for (const exercise of pick(candidates, count)) chosen.add(exercise.id);
  }
  return exercises.filter((exercise) => chosen.has(exercise.id)).map((exercise) => exercise.id);
}

/** Набор ещё годится, если все его работы есть в банке и уровни совпадают с планом. */
export function isValidAssignment(assignment, exercises) {
  if (!Array.isArray(assignment) || assignment.length !== ASSIGNMENT_SIZE) return false;
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  if (!assignment.every((id) => byId.has(id))) return false;
  return Object.entries(PLAN).every(([level, count]) =>
    assignment.filter((id) => byId.get(id).difficulty === Number(level)).length === count);
}
