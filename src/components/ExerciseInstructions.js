import { escapeHtml, highlightAbbreviation } from '../services/highlight.js';
import { isPractice } from '../services/ExerciseStore.js';
import { icons } from './icons.js';

const DIFFICULTY = ['', 'основы', 'средний', 'сложнее'];
const PRACTICE_DIFFICULTY = ['', 'простая', 'средняя', 'сложная'];

/** Условие задания и постепенно открываемые подсказки (у практических работ подсказок нет). */
export class ExerciseInstructions {
  constructor(root) {
    this.root = root;
    this.revealed = 0;
    this.total = 0;
    this.solutionShown = false;
  }

  load(exercise) {
    this.exercise = exercise;
    this.revealed = 0;
    this.total = exercise.hints?.length ?? 0;
    this.solutionShown = false;
    const practice = isPractice(exercise);
    const levels = practice ? PRACTICE_DIFFICULTY : DIFFICULTY;
    this.root.innerHTML = `
      <p class="task-text">${escapeHtml(exercise.description)}</p>
      <div class="task-tools">
        <span class="task-level" title="Уровень сложности">${levels[exercise.difficulty] ?? ''}</span>
        <button class="btn btn-link hint-btn" type="button" ${practice ? 'hidden' : ''}>${icons.bulb}<span></span></button>
      </div>
      <ul class="hints" aria-label="Подсказки" aria-live="polite"></ul>
    `;
    this.hints = this.root.querySelector('.hints');
    this.hintButton = this.root.querySelector('.hint-btn');
    this.hintButton.addEventListener('click', () => this.revealNext());
    if (!practice) this.updateHintButton();
    this.root.classList.remove('is-entering');
    void this.root.offsetWidth;
    this.root.classList.add('is-entering');
  }

  revealNext() {
    if (this.revealed < this.total) {
      this.addHint(escapeHtml(this.exercise.hints[this.revealed]));
      this.revealed += 1;
    } else if (!this.solutionShown) {
      this.solutionShown = true;
      this.addHint(`Решение: <code class="inline-abbr">${highlightAbbreviation(this.exercise.emmetExpression)}</code>`, 'is-solution');
    }
    this.updateHintButton();
  }

  updateHintButton() {
    const label = this.hintButton.querySelector('span');
    if (this.revealed < this.total) {
      label.textContent = this.revealed ? `Ещё подсказка (${this.revealed}/${this.total})` : 'Подсказка';
    } else {
      label.textContent = 'Показать решение';
      this.hintButton.hidden = this.solutionShown;
    }
  }

  addHint(html, extraClass = '') {
    const item = document.createElement('li');
    item.className = `hint ${extraClass}`.trim();
    item.innerHTML = html;
    this.hints.append(item);
    // Прокручиваем только если подсказки действительно не помещаются.
    if (this.root.scrollHeight > this.root.clientHeight) this.root.scrollTop = this.root.scrollHeight;
  }
}
