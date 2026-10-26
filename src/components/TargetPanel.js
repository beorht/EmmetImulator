import { highlightHtml } from '../services/highlight.js';
import { PreviewFrame } from './PreviewFrame.js';

const VIEWS = { clean: 'Браузер', boxes: 'Схема' };

/**
 * Образец практической работы.
 * Задания Emmet: HTML, который должен получиться, и его вид в браузере.
 * Сокращение не показывается — его ученик подбирает сам.
 * Задания на контейнеры: код не показывается вовсе. Сверху — как выглядит код ученика,
 * снизу — как должно выглядеть. По умолчанию это чистый HTML, как в браузере;
 * «Схема» рисует те же страницы коробками с метками тегов, id и class.
 */
export class TargetPanel {
  constructor(root) {
    this.view = 'clean';
    this.preview = new PreviewFrame({ title: 'Образец результата' });
    this.studentFrame = new PreviewFrame({ title: 'Как выглядит ваш код', variant: this.view });
    this.targetFrame = new PreviewFrame({ title: 'Как должно выглядеть', variant: this.view });

    root.innerHTML = `
      <header class="panel-head">
        <div class="panel-heading">
          <p class="eyebrow">Образец</p>
          <h2 class="panel-title" id="target-title">Что должно получиться</h2>
        </div>
        <div class="view-switch" role="group" aria-label="Вид" hidden>
          ${Object.entries(VIEWS).map(([id, name]) => `
            <button class="view-tab" type="button" data-view="${id}" aria-pressed="${id === this.view}">${name}</button>`).join('')}
        </div>
      </header>
      <div class="target-body" data-mode="code">
        <figure class="target-pane target-code" aria-label="HTML образца">
          <figcaption><span>HTML</span></figcaption>
          <pre><code></code></pre>
        </figure>
        <figure class="target-pane target-result">
          <figcaption><span>Результат</span></figcaption>
        </figure>
      </div>
      <div class="target-body" data-mode="render" hidden>
        <figure class="target-pane render-student">
          <figcaption><span>Ваш код</span><span class="pane-note">обновляется, пока вы печатаете</span></figcaption>
        </figure>
        <figure class="target-pane render-target">
          <figcaption><span>Как должно выглядеть</span></figcaption>
        </figure>
      </div>
    `;

    this.code = root.querySelector('.target-code code');
    this.codeBody = root.querySelector('[data-mode="code"]');
    this.renderBody = root.querySelector('[data-mode="render"]');
    this.viewSwitch = root.querySelector('.view-switch');
    root.querySelector('.target-result').append(this.preview.element);
    root.querySelector('.render-student').append(this.studentFrame.element);
    root.querySelector('.render-target').append(this.targetFrame.element);

    this.viewSwitch.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-view]');
      if (tab) this.setView(tab.dataset.view);
    });
  }

  setView(view) {
    this.view = view;
    for (const tab of this.viewSwitch.querySelectorAll('[data-view]')) {
      tab.setAttribute('aria-pressed', String(tab.dataset.view === view));
    }
    this.studentFrame.setVariant(view);
    this.targetFrame.setVariant(view);
  }

  load(exercise) {
    const html = exercise.expectedHtml;
    const rendered = exercise.section === 'containers';
    this.codeBody.hidden = rendered;
    this.renderBody.hidden = !rendered;
    this.viewSwitch.hidden = !rendered;

    if (rendered) {
      this.targetFrame.render(html);
      this.showStudent('');
      return;
    }
    this.code.innerHTML = html
      .split('\n')
      .map((line, i) => `<span class="code-line" style="--i:${i}">${highlightHtml(line) || ' '}</span>`)
      .join('\n');
    this.preview.render(html);
  }

  /** Вид кода ученика — вызывается редактором при каждом изменении. */
  showStudent(code) {
    if (!this.renderBody.hidden) this.studentFrame.render(code);
  }
}
