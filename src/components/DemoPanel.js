import { expandAbbreviation } from '../services/EmmetService.js';
import { highlightAbbreviation, highlightHtml } from '../services/highlight.js';
import { isPractice } from '../services/ExerciseStore.js';
import { PreviewFrame } from './PreviewFrame.js';
import { TypingSequence, SequenceCancelled } from './TypingSequence.js';
import { icons } from './icons.js';

// Пауза между повторами демонстрации.
const REPEAT_DELAY = 1500;

const STEPS = [
  { id: 'type', label: 'Набор' },
  { id: 'expand', label: 'Tab' },
  { id: 'html', label: 'HTML' },
  { id: 'result', label: 'Результат' },
];

/**
 * Автоматическая демонстрация по кругу: сокращение набирается, на том же
 * месте разворачивается настоящим Emmet, и показывается результат. Ничего не подделывается —
 * HTML и предпросмотр всегда получены из того же сокращения.
 */
export class DemoPanel {
  constructor(root, { reducedMotion }) {
    this.root = root;
    this.reducedMotion = reducedMotion;
    this.sequence = new TypingSequence();
    this.preview = new PreviewFrame({ title: 'Результат демонстрации' });
    this.state = 'idle';

    root.innerHTML = `
      <header class="panel-head">
        <div class="panel-heading">
          <p class="eyebrow"></p>
          <h2 class="panel-title" id="demo-title"></h2>
        </div>
        <div class="toolbar" role="group" aria-label="Управление демонстрацией">
          <button class="icon-btn" type="button" data-action="toggle"></button>
          <button class="icon-btn" type="button" data-action="skip" title="Сразу к результату" aria-label="Сразу к результату">${icons.skip}</button>
          <button class="icon-btn" type="button" data-action="replay" title="Повторить" aria-label="Повторить демонстрацию">${icons.replay}</button>
        </div>
      </header>
      <p class="demo-caption"></p>
      <div class="demo-body">
        <figure class="demo-pane demo-code" aria-label="Код демонстрации">
          <figcaption><span>Код</span><kbd class="keycap">Tab</kbd></figcaption>
          <pre><code></code></pre>
        </figure>
        <figure class="demo-pane demo-result">
          <figcaption><span>Результат</span></figcaption>
        </figure>
      </div>
      <ol class="steps" aria-label="Этапы демонстрации">
        ${STEPS.map((step) => `<li data-step="${step.id}">${step.label}</li>`).join('')}
      </ol>
    `;

    this.eyebrow = root.querySelector('.eyebrow');
    this.title = root.querySelector('.panel-title');
    this.caption = root.querySelector('.demo-caption');
    this.code = root.querySelector('.demo-code code');
    this.codePane = root.querySelector('.demo-code');
    this.result = root.querySelector('.demo-result');
    this.toggleButton = root.querySelector('[data-action="toggle"]');
    this.stepItems = [...root.querySelectorAll('.steps li')];
    this.result.append(this.preview.element);

    root.querySelector('[data-action="replay"]').addEventListener('click', () => {
      if (!isPractice(this.exercise)) this.play();
    });
    root.querySelector('[data-action="skip"]').addEventListener('click', () => this.finish());
    this.toggleButton.addEventListener('click', () => this.togglePause());
    this.updateToggle();
  }

  load(exercise) {
    this.exercise = exercise;
    if (isPractice(exercise)) {
      this.showTarget();
      return;
    }
    this.root.dataset.kind = 'lesson';
    this.eyebrow.textContent = 'Демонстрация';
    this.title.textContent = exercise.topic;
    this.caption.textContent = exercise.demo.caption;
    this.play();
  }

  /** Практическая работа: без анимации — только HTML и вид, которые должны получиться. */
  showTarget() {
    this.sequence.cancel();
    this.setState('idle');
    this.root.dataset.kind = 'practice';
    this.eyebrow.textContent = 'Практическая работа';
    this.title.textContent = 'Что должно получиться';
    this.caption.textContent = '';
    const html = this.exercise.expectedHtml;
    this.codePane.classList.remove('is-typing', 'is-expanding');
    this.renderHtml(html.split('\n'), { animated: false });
    this.preview.render(html);
    this.result.classList.add('is-visible');
  }

  /** Проигрывает демонстрацию по кругу с паузой между повторами. */
  async play({ fromFinish = false } = {}) {
    const generation = this.sequence.start();
    if (this.reducedMotion.matches) {
      this.showFinal();
      this.setState('done');
      return;
    }

    this.setState('playing');
    try {
      if (fromFinish) await this.sequence.wait(REPEAT_DELAY, generation);
      for (;;) {
        await this.runCycle(generation);
        await this.sequence.wait(REPEAT_DELAY, generation);
      }
    } catch (error) {
      if (!(error instanceof SequenceCancelled)) throw error;
    }
  }

  /**
   * Один проход: сокращение набирается в поле кода, по Tab на том же месте
   * заменяется HTML-разметкой, затем показывается результат.
   */
  async runCycle(generation) {
    const { abbreviation } = this.exercise.demo;
    const { html } = expandAbbreviation(abbreviation);
    const { wait } = this;

    this.reset();
    await wait(500, generation);
    this.setStep('type');
    this.codePane.classList.add('is-typing');
    await this.sequence.type(abbreviation, (text) => {
      this.code.innerHTML = `<span class="demo-abbr">${highlightAbbreviation(text)}</span>`;
    }, generation, { speed: 105 });

    await wait(555, generation);
    this.setStep('expand');
    this.codePane.classList.remove('is-typing');
    this.codePane.classList.add('is-expanding');
    await wait(720, generation);

    this.setStep('html');
    this.codePane.classList.remove('is-expanding');
    const lines = html.split('\n');
    this.renderHtml(lines, { animated: true });
    await wait(465 + lines.length * 78, generation);

    this.setStep('result');
    this.preview.render(html);
    this.result.classList.add('is-visible');
    await wait(330, generation);
    this.setStep('result', { complete: true });
  }

  wait = (ms, generation) => this.sequence.wait(ms, generation);

  renderHtml(lines, { animated }) {
    this.code.innerHTML = lines
      .map((line, i) => `<span class="code-line${animated ? '' : ' is-static'}" style="--i:${i}">${highlightHtml(line) || ' '}</span>`)
      .join('\n');
  }

  showFinal() {
    const { html } = expandAbbreviation(this.exercise.demo.abbreviation);
    this.codePane.classList.remove('is-typing', 'is-expanding');
    this.renderHtml(html.split('\n'), { animated: false });
    this.preview.render(html);
    this.result.classList.add('is-visible');
    this.setStep('result', { complete: true });
  }

  /** «Сразу к результату»: показывает итог, а повтор начнётся после обычной паузы. */
  finish() {
    if (!this.exercise || isPractice(this.exercise)) return;
    this.sequence.cancel();
    this.showFinal();
    this.play({ fromFinish: true });
  }

  togglePause() {
    if (isPractice(this.exercise)) return;
    if (this.state === 'done' || this.state === 'idle') {
      this.play();
      return;
    }
    const paused = this.state !== 'paused';
    this.sequence.setPaused(paused);
    this.setState(paused ? 'paused' : 'playing');
  }

  reset() {
    this.code.innerHTML = '';
    this.codePane.classList.remove('is-typing', 'is-expanding');
    this.result.classList.remove('is-visible');
    this.preview.render('');
    this.setStep(null);
  }

  setStep(stepId, { complete = false } = {}) {
    const activeIndex = STEPS.findIndex((step) => step.id === stepId);
    this.stepItems.forEach((item, i) => {
      item.classList.toggle('is-active', i === activeIndex && !complete);
      item.classList.toggle('is-done', i < activeIndex || (complete && i <= activeIndex));
      if (i === activeIndex) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
  }

  setState(state) {
    this.state = state;
    this.root.dataset.state = state;
    this.updateToggle();
  }

  updateToggle() {
    const showPlay = this.state !== 'playing';
    const label = this.state === 'paused' ? 'Продолжить' : showPlay ? 'Воспроизвести' : 'Пауза';
    this.toggleButton.innerHTML = showPlay ? icons.play : icons.pause;
    this.toggleButton.title = label;
    this.toggleButton.setAttribute('aria-label', label);
  }
}
