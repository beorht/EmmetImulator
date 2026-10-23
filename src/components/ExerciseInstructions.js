import { escapeHtml } from '../services/highlight.js';

const DIFFICULTY = ['', 'простая', 'средняя', 'сложная'];

/** Условие практической работы и её уровень сложности. */
export class ExerciseInstructions {
  constructor(root) {
    this.root = root;
  }

  load(exercise) {
    this.root.innerHTML = `
      <p class="task-text">${escapeHtml(exercise.description)}</p>
      <div class="task-tools">
        <span class="task-level" title="Уровень сложности">${DIFFICULTY[exercise.difficulty] ?? ''}</span>
      </div>
    `;
    this.root.classList.remove('is-entering');
    void this.root.offsetWidth;
    this.root.classList.add('is-entering');
  }
}
