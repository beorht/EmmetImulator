import { escapeHtml } from '../services/highlight.js';

const IDLE = {
  status: 'idle',
  title: 'Повторите приём',
  message: 'Посмотрите демонстрацию и решите задание по аналогии.',
};

const PRACTICE_IDLE = {
  status: 'idle',
  title: 'Самостоятельная работа',
  message: 'Получите с помощью Emmet такой же HTML, как в образце слева.',
};

/** Сообщение о результате проверки. Живой регион — читается скринридером. */
export class FeedbackMessage {
  constructor(root, { onNext }) {
    this.root = root;
    root.innerHTML = `
      <div class="feedback" role="status" aria-live="polite" data-status="idle">
        <span class="feedback-mark" aria-hidden="true"></span>
        <div class="feedback-text">
          <p class="feedback-title"></p>
          <p class="feedback-message"></p>
        </div>
        <button class="btn btn-link feedback-next" type="button" hidden>Дальше →</button>
      </div>
    `;
    this.box = root.querySelector('.feedback');
    this.titleEl = root.querySelector('.feedback-title');
    this.messageEl = root.querySelector('.feedback-message');
    this.nextButton = root.querySelector('.feedback-next');
    this.nextButton.addEventListener('click', onNext);
    this.reset();
  }

  show({ status, title, message, extra = '' }, { canAdvance = false } = {}) {
    this.box.dataset.status = status;
    this.titleEl.textContent = title;
    this.messageEl.innerHTML = escapeHtml(message) + (extra ? ` <span class="feedback-extra">${escapeHtml(extra)}</span>` : '');
    this.nextButton.hidden = !(status === 'success' && canAdvance);
    // Перезапуск короткой анимации смены статуса.
    this.box.classList.remove('is-updated');
    void this.box.offsetWidth;
    this.box.classList.add('is-updated');
  }

  reset({ practice = false } = {}) {
    this.show(practice ? PRACTICE_IDLE : IDLE);
    this.box.classList.remove('is-updated');
  }
}
