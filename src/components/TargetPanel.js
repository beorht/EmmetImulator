import { highlightHtml } from '../services/highlight.js';
import { PreviewFrame } from './PreviewFrame.js';

/**
 * Образец практической работы: HTML, который должен получиться, и его вид в браузере.
 * Сокращение не показывается — его ученик подбирает сам.
 */
export class TargetPanel {
  constructor(root) {
    this.preview = new PreviewFrame({ title: 'Образец результата' });

    root.innerHTML = `
      <header class="panel-head">
        <div class="panel-heading">
          <p class="eyebrow">Образец</p>
          <h2 class="panel-title" id="target-title">Что должно получиться</h2>
        </div>
      </header>
      <div class="target-body">
        <figure class="target-pane target-code" aria-label="HTML образца">
          <figcaption><span>HTML</span></figcaption>
          <pre><code></code></pre>
        </figure>
        <figure class="target-pane target-result">
          <figcaption><span>Результат</span></figcaption>
        </figure>
      </div>
    `;

    this.code = root.querySelector('.target-code code');
    root.querySelector('.target-result').append(this.preview.element);
  }

  load(exercise) {
    const html = exercise.expectedHtml;
    this.code.innerHTML = html
      .split('\n')
      .map((line, i) => `<span class="code-line" style="--i:${i}">${highlightHtml(line) || ' '}</span>`)
      .join('\n');
    this.preview.render(html);
  }
}
