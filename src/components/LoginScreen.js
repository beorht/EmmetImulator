import { api } from '../services/Api.js';

/**
 * Вход по ID-ключу. onLogin получает ответ сервера и введённый ключ;
 * если вошёл не тот, кого ждали (например, преподаватель на странице студента), решает вызывающий.
 */
export class LoginScreen {
  constructor(root, { title, subtitle, placeholder = 'stWeb-123', onLogin }) {
    this.root = root;
    root.innerHTML = `
      <form class="login-card" novalidate>
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">&lt;/&gt;</span>
          <span class="brand-name">Emmet</span>
          <span class="brand-sub">тетрадь</span>
        </div>
        <h1 class="login-title">${title}</h1>
        <p class="login-text">${subtitle}</p>
        <label class="login-label" for="login-key">Ваш ID</label>
        <input class="login-input" id="login-key" name="key" type="text" placeholder="${placeholder}"
          autocomplete="off" autocapitalize="off" spellcheck="false" required aria-describedby="login-error" />
        <p class="login-error" id="login-error" role="alert"></p>
        <button class="btn btn-primary login-submit" type="submit">Войти</button>
      </form>
    `;
    this.form = root.querySelector('form');
    this.input = root.querySelector('input');
    this.error = root.querySelector('.login-error');
    this.submit = root.querySelector('[type="submit"]');

    this.input.addEventListener('input', () => this.showError(''));
    this.form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const key = this.input.value.trim();
      if (!key) {
        this.showError('Введите ID, который выдал преподаватель.');
        return;
      }
      this.submit.disabled = true;
      try {
        await onLogin(await api.login(key), key);
      } catch (error) {
        this.showError(error.message);
      } finally {
        this.submit.disabled = false;
      }
    });
  }

  show(message = '') {
    this.root.hidden = false;
    this.input.value = '';
    this.showError(message);
    this.input.focus();
  }

  hide() {
    this.root.hidden = true;
  }

  showError(message) {
    this.error.textContent = message;
    this.input.setAttribute('aria-invalid', String(Boolean(message)));
  }
}
