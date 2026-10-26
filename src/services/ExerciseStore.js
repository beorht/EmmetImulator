import exercises from '../data/exercises.json';
import { expandAbbreviation } from './EmmetService.js';

/**
 * Хранит план студента (работы и шаги с теорией), текущий индекс и решённые задания.
 * Ожидаемый HTML берётся из expectedHtml, а если его нет —
 * получается настоящим развёртыванием emmetExpression. У теории (kind: 'lesson') его нет.
 */
export class ExerciseStore {
  constructor(list = exercises) {
    this.list = list.map((exercise) => (exercise.kind === 'lesson' ? exercise : {
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

  get tasks() {
    return this.list.filter((item) => item.kind !== 'lesson');
  }

  /** Номер работы среди работ, без шагов с теорией (для теории — null). */
  taskNumber(index = this.index) {
    const item = this.list[index];
    return item.kind === 'lesson' ? null : this.list.slice(0, index + 1).filter((entry) => entry.kind !== 'lesson').length;
  }

  /**
   * С чего продолжить: первая нерешённая работа. Если перед ней теория, а раздел
   * ещё не начат, — сначала теория.
   */
  resumeIndex() {
    const first = this.list.findIndex((item) => item.kind !== 'lesson' && !this.solved.has(item.id));
    if (first === -1) return 0;
    const before = this.list[first - 1];
    return before?.kind === 'lesson' ? first - 1 : first;
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
