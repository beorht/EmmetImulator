import exercises from '../data/exercises.json';
import { expandAbbreviation } from './EmmetService.js';

/**
 * Хранит практические работы, текущий индекс и решённые задания.
 * Ожидаемый HTML берётся из expectedHtml, а если его нет —
 * получается настоящим развёртыванием emmetExpression.
 */
export class ExerciseStore {
  constructor(list = exercises) {
    this.list = list.map((exercise) => ({
      ...exercise,
      expectedHtml: exercise.expectedHtml ?? expandAbbreviation(exercise.emmetExpression).html,
    }));
    this.index = 0;
    this.solved = new Set();
    this.listeners = new Set();
  }

  get current() {
    return this.list[this.index];
  }

  get count() {
    return this.list.length;
  }

  select(index) {
    const next = Math.max(0, Math.min(this.count - 1, index));
    if (next === this.index) return;
    this.index = next;
    this.emit();
  }

  markSolved(id) {
    if (this.solved.has(id)) return;
    this.solved.add(id);
    this.emit();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) listener(this);
  }
}
