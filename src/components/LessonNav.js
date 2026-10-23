import { escapeHtml } from '../services/highlight.js';
import { isPractice } from '../services/ExerciseStore.js';
import { icons } from './icons.js';

/** Навигация по заданиям в верхней панели: стрелки и отметки решённых, обучение и практические работы — отдельными группами. */
export class LessonNav {
  constructor(root, { store }) {
    this.store = store;
    root.innerHTML = `
      <span class="nav-count" aria-hidden="true"></span>
      <button class="icon-btn" type="button" data-action="prev" aria-label="Предыдущее задание">${icons.prev}</button>
      <ol class="lesson-dots"></ol>
      <button class="icon-btn" type="button" data-action="next" aria-label="Следующее задание">${icons.next}</button>
    `;

    this.count = root.querySelector('.nav-count');
    this.dots = root.querySelector('.lesson-dots');
    this.prevButton = root.querySelector('[data-action="prev"]');
    this.nextButton = root.querySelector('[data-action="next"]');

    this.prevButton.addEventListener('click', () => store.select(store.index - 1));
    this.nextButton.addEventListener('click', () => store.select(store.index + 1));
    this.dots.addEventListener('click', (event) => {
      const dot = event.target.closest('[data-index]');
      if (dot) store.select(Number(dot.dataset.index));
    });
  }

  render() {
    const { store } = this;
    this.count.textContent = `${store.index + 1} / ${store.count}`;
    this.prevButton.disabled = store.index === 0;
    this.nextButton.disabled = store.index === store.count - 1;
    this.dots.innerHTML = store.list
      .map((exercise, i) => {
        const solved = store.solved.has(exercise.id);
        const practice = isPractice(exercise);
        const groupStart = practice && !isPractice(store.list[i - 1] ?? exercise);
        const { number } = store.positionOf(exercise);
        const classes = ['lesson-dot'];
        if (practice) classes.push('is-practice');
        if (i === store.index) classes.push('is-current');
        if (solved) classes.push('is-solved');
        return `<li${groupStart ? ' class="group-start"' : ''}><button type="button" class="${classes.join(' ')}" data-index="${i}"
          aria-label="${practice ? 'Практическая работа' : 'Задание'} ${number}: ${escapeHtml(exercise.title)}${solved ? ', решено' : ''}"
          ${i === store.index ? 'aria-current="step"' : ''}></button></li>`;
      })
      .join('');
  }
}
