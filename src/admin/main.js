import '@fontsource/oswald/500.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '../styles/main.css';
import './admin.css';

import { api, SavedKey } from '../services/Api.js';
import { escapeHtml, highlightHtml } from '../services/highlight.js';
import { LoginScreen } from '../components/LoginScreen.js';
import { icons } from '../components/icons.js';
import {
  cellState, STATE_LABEL, summarize, taskTotals, isOnline, flagsOf, assignedExercises, isAssigned,
  formatRelative, formatDuration, formatAverage, formatAwayTotal, toCsv,
} from './stats.js';

const REFRESH_INTERVAL = 10_000;
const LEVEL = ['', 'простая', 'средняя', 'сложная'];
const SECTIONS = { emmet: 'Emmet', containers: 'Контейнеры' };
const sectionOf = (exercise) => exercise.section ?? 'emmet';

const STATUS_LABEL = { success: 'принято', partial: 'почти', error: 'ошибка', mismatch: 'не та структура' };

const adminKey = new SavedKey('emmet.adminKey');

const SORTS = {
  list: (a, b) => a.id.localeCompare(b.id),
  name: (a, b) => a.name.localeCompare(b.name, 'ru'),
  progress: (a, b, exercises) =>
    summarize(b, exercises).solved - summarize(a, exercises).solved || a.name.localeCompare(b.name, 'ru'),
  activity: (a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''),
};

const plural = (n, one, few, many) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

/** Панель преподавателя: сводка по группе, матрица «студент × задание», карточка студента и ключи. */
class AdminPanel {
  constructor(root, key) {
    this.root = root;
    this.key = key;
    this.data = null;
    this.sort = 'list';
    this.query = '';
    this.section = 'emmet';

    root.innerHTML = `
      <header class="admin-bar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">&lt;/&gt;</span>
          <span class="brand-name">Emmet</span>
          <span class="brand-sub">панель преподавателя</span>
        </div>
        <div class="admin-actions">
          <span class="refresh-note" aria-live="polite"></span>
          <button class="btn btn-danger" type="button" data-action="session"></button>
          <button class="btn btn-ghost" type="button" data-action="refresh" title="Обновить сейчас">${icons.refresh}<span>Обновить</span></button>
          <button class="btn btn-ghost" type="button" data-action="keys">${icons.key}<span>Ключи</span></button>
          <button class="btn btn-ghost" type="button" data-action="csv">${icons.download}<span>Excel</span></button>
          <button class="icon-btn" type="button" data-action="logout" title="Выйти" aria-label="Выйти">${icons.logout}</button>
        </div>
      </header>
      <main class="admin-main">
        <p class="session-banner" role="status" hidden></p>
        <section class="summary" aria-label="Сводка"></section>
        <section class="admin-card">
          <header class="admin-card-head">
            <h1 class="admin-title">Прогресс группы</h1>
            <div class="matrix-tools">
              <div class="section-tabs" role="group" aria-label="Раздел">
                ${Object.entries(SECTIONS).map(([id, name]) => `
                  <button class="section-tab" type="button" data-section="${id}" aria-pressed="${id === 'emmet'}">${name}</button>`).join('')}
              </div>
              <input class="search" type="search" placeholder="Поиск по имени" aria-label="Поиск по имени" />
              <select class="sort" aria-label="Сортировка">
                <option value="list">По списку</option>
                <option value="name">По фамилии</option>
                <option value="progress">По прогрессу</option>
                <option value="activity">По активности</option>
              </select>
            </div>
          </header>
          <ul class="legend" aria-label="Обозначения">
            <li><span class="cell-swatch" data-state="solved">2</span>решено, число — попыток до решения</li>
            <li><span class="cell-swatch" data-state="tried">3</span>пробовал, но не решил</li>
            <li><span class="cell-swatch" data-state="opened"></span>открыл, не проверял</li>
            <li><span class="cell-swatch" data-state="none"></span>не открывал</li>
            <li><span class="cell-swatch" data-state="unassigned"></span>нет в наборе студента</li>
            <li><span class="cell-swatch is-flagged" data-state="solved">1</span>есть признаки списывания</li>
          </ul>
          <div class="matrix-wrap"><table class="matrix"></table></div>
        </section>
      </main>
      <dialog class="sheet student-sheet" aria-labelledby="student-sheet-title"></dialog>
      <dialog class="sheet keys-sheet" aria-labelledby="keys-sheet-title"></dialog>
    `;

    this.summary = root.querySelector('.summary');
    this.matrix = root.querySelector('.matrix');
    this.note = root.querySelector('.refresh-note');
    this.sessionButton = root.querySelector('[data-action="session"]');
    this.banner = root.querySelector('.session-banner');
    this.studentSheet = root.querySelector('.student-sheet');
    this.keysSheet = root.querySelector('.keys-sheet');

    root.querySelector('[data-action="refresh"]').addEventListener('click', () => this.load());
    root.querySelector('[data-action="keys"]').addEventListener('click', () => this.openKeys());
    root.querySelector('[data-action="csv"]').addEventListener('click', () => this.downloadCsv());
    this.sessionButton.addEventListener('click', () => this.toggleSession());
    root.querySelector('[data-action="logout"]').addEventListener('click', () => logout());
    root.querySelector('.search').addEventListener('input', (event) => {
      this.query = event.target.value.trim().toLowerCase();
      this.renderMatrix();
    });
    root.querySelector('.sort').addEventListener('change', (event) => {
      this.sort = event.target.value;
      this.renderMatrix();
    });
    root.querySelector('.section-tabs').addEventListener('click', (event) => {
      const tab = event.target.closest('[data-section]');
      if (!tab) return;
      this.section = tab.dataset.section;
      for (const button of root.querySelectorAll('.section-tab')) {
        button.setAttribute('aria-pressed', String(button === tab));
      }
      this.renderMatrix();
    });
    this.matrix.addEventListener('click', (event) => {
      const button = event.target.closest('[data-student]');
      if (button) this.openStudent(button.dataset.student);
    });
    for (const sheet of [this.studentSheet, this.keysSheet]) {
      // Клик по затемнению вокруг окна закрывает его.
      sheet.addEventListener('click', (event) => {
        if (event.target === sheet || event.target.closest('[data-action="close"]')) sheet.close();
      });
    }

    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible') this.load({ quiet: true });
    }, REFRESH_INTERVAL);
  }

  async load({ quiet = false } = {}) {
    if (!quiet) this.note.textContent = 'Обновляю…';
    try {
      this.data = await api.overview(this.key);
      const now = new Date();
      this.note.textContent = `Обновлено в ${now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      this.note.classList.remove('is-error');
      this.renderSession();
      this.renderSummary();
      this.renderMatrix();
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        logout('Ключ преподавателя больше не действует.');
        return;
      }
      this.note.textContent = error.message;
      this.note.classList.add('is-error');
    }
  }

  renderSession() {
    const { closedAt } = this.data;
    this.sessionButton.textContent = closedAt ? 'Открыть занятие' : 'Завершить занятие';
    this.sessionButton.classList.toggle('btn-danger', !closedAt);
    this.sessionButton.classList.toggle('btn-ghost', Boolean(closedAt));
    this.banner.hidden = !closedAt;
    if (closedAt) {
      const time = new Date(closedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      this.banner.textContent = `Занятие завершено ${time}. Студенты видят «Занятие окончено», новые решения не принимаются — результаты зафиксированы.`;
    }
  }

  async toggleSession() {
    const closing = !this.data?.closedAt;
    const question = closing
      ? 'Завершить занятие? Студенты увидят «Занятие окончено», новые решения приниматься не будут.'
      : 'Снова открыть занятие? Студенты смогут продолжить решать.';
    if (!window.confirm(question)) return;
    try {
      await api.setClosed(this.key, closing);
      await this.load();
    } catch (error) {
      window.alert(error.message);
    }
  }

  /** После завершения занятия в тетради никого нет, даже если студент заходил минуту назад. */
  isOnline(student) {
    return !this.data.closedAt && isOnline(student);
  }

  /** Столбцы таблицы — работы выбранного раздела: банк Emmet или задания на контейнеры. */
  get sectionExercises() {
    return this.data.exercises.filter((exercise) => sectionOf(exercise) === this.section);
  }

  get students() {
    const exercises = this.sectionExercises;
    return this.data.students
      .filter((student) => student.name.toLowerCase().includes(this.query))
      .sort((a, b) => SORTS[this.sort](a, b, exercises));
  }

  renderSummary() {
    const { students, exercises } = this.data;
    const totals = students.map((student) => summarize(student, exercises));
    const solved = totals.reduce((sum, total) => sum + total.solved, 0);
    const possible = totals.reduce((sum, total) => sum + total.total, 0);
    const entered = students.filter((student) => student.firstSeen).length;
    const online = students.filter((student) => this.isOnline(student)).length;
    const finished = totals.filter((total) => total.total && total.solved === total.total).length;
    const handwritten = totals.reduce((sum, total) => sum + total.handwritten, 0);
    const pastes = totals.reduce((sum, total) => sum + total.pastes, 0);
    const aways = totals.reduce((sum, total) => sum + total.aways, 0);
    const awayMs = totals.reduce((sum, total) => sum + total.awayMs, 0);
    const suspicious = totals.reduce((sum, total) => sum + total.suspicious, 0);
    const violations = handwritten + pastes + aways;
    const details = [
      handwritten && `HTML вручную: ${handwritten}`,
      pastes && `вставки: ${pastes}`,
      aways && `уходы: ${aways} (${formatAwayTotal(awayMs)})`,
      suspicious && `решено сразу после ухода: ${suspicious}`,
    ].filter(Boolean).join(' · ');

    const card = (label, value, note = '') => `
      <article class="stat">
        <p class="stat-label">${label}</p>
        <p class="stat-value">${value}</p>
        <p class="stat-note">${note}</p>
      </article>`;

    this.summary.innerHTML = [
      card('В тетради', `${online}<small> / ${students.length}</small>`,
        `входили хотя бы раз: ${entered}`),
      card('Решено', `${possible ? Math.round((solved / possible) * 100) : 0}<small>%</small>`,
        `${solved} из ${possible} работ · всё решили: ${finished}`),
      card('Нарушения', violations, details || 'нарушений нет'),
    ].join('');
  }

  renderMatrix() {
    const exercises = this.sectionExercises;
    const students = this.students;
    const allStudents = this.data.students;

    const head = `
      <thead>
        <tr>
          <th class="col-name" scope="col">Студент</th>
          ${exercises.map((exercise, i) => `
            <th class="col-task" scope="col" data-level="${exercise.difficulty}"
              title="${i + 1}. ${escapeHtml(exercise.title)} — ${LEVEL[exercise.difficulty]}">${i + 1}</th>`).join('')}
          <th class="col-num" scope="col">Решено</th>
          <th class="col-num" scope="col">Попыток</th>
          <th class="col-num" scope="col" title="Нарушения: HTML, набранный вручную, и попытки вставки">Наруш.</th>
          <th class="col-num" scope="col" title="Сколько всего времени студент провёл на других вкладках и в других программах">Вне стр.</th>
          <th class="col-time" scope="col">Активность</th>
        </tr>
      </thead>`;

    const rows = students.map((student) => {
      const total = summarize(student, exercises);
      const percent = total.total ? Math.round((total.solved / total.total) * 100) : 0;
      const cells = exercises.map((exercise, i) => {
        const item = student.exercises[exercise.id];
        const state = cellState(item, isAssigned(student, exercise));
        const count = state === 'solved' ? item.attemptsToSolve : state === 'tried' ? item.attempts : '';
        const flags = flagsOf(item);
        const detail = [
          state === 'solved'
            ? `решено с ${item.attemptsToSolve}-й попытки`
            : state === 'tried' ? `${item.attempts} ${plural(item.attempts, 'попытка', 'попытки', 'попыток')}, не решено` : STATE_LABEL[state],
          ...flags,
        ].join('; ');
        return `<td class="cell${flags.length ? ' is-flagged' : ''}" data-state="${state}" title="${i + 1}. ${escapeHtml(exercise.title)}: ${detail}">${count}<span class="visually-hidden">${detail}</span></td>`;
      }).join('');
      return `
        <tr>
          <th class="col-name" scope="row">
            <button class="student-link" type="button" data-student="${student.id}" title="${escapeHtml(student.name)}">
              <span class="online-dot${this.isOnline(student) ? ' is-online' : ''}"></span>
              <span class="student-name">${escapeHtml(student.name)}</span>
            </button>
          </th>
          ${cells}
          <td class="col-num">
            <span class="progress-label${percent === 100 ? ' is-complete' : ''}">${total.solved}<small>/${total.total}</small></span>
          </td>
          <td class="col-num">${total.attempts}</td>
          <td class="col-num${total.violations ? ' has-warning' : ''}" title="HTML вручную: ${total.handwritten}, попыток вставки: ${total.pastes}">${total.violations}</td>
          <td class="col-num${total.suspicious ? ' has-warning' : ''}" title="Уходов: ${total.aways}; решено сразу после ухода: ${total.suspicious}">${formatAwayTotal(total.awayMs)}</td>
          <td class="col-time">${formatRelative(student.lastSeen)}</td>
        </tr>`;
    }).join('');

    const totals = exercises.map((exercise) => taskTotals(exercise, allStudents));
    const foot = `
      <tfoot>
        <tr>
          <th class="col-name" scope="row">Выдано</th>
          ${totals.map((total) => `<td class="col-task-avg">${total.assigned}</td>`).join('')}
          <td colspan="5"></td>
        </tr>
        <tr>
          <th class="col-name" scope="row">Решили</th>
          ${totals.map((total) => `<td class="col-task-total" style="--share:${total.assigned ? total.solved / total.assigned : 0}" title="Решили ${total.solved} из ${total.assigned}, кому выдана работа">${total.solved}</td>`).join('')}
          <td colspan="5"></td>
        </tr>
        <tr>
          <th class="col-name" scope="row">Ср. попыток</th>
          ${totals.map((total) => `<td class="col-task-avg">${formatAverage(total.avgToSolve)}</td>`).join('')}
          <td colspan="5"></td>
        </tr>
      </tfoot>`;

    const empty = students.length
      ? ''
      : `<tbody><tr><td class="matrix-empty" colspan="${exercises.length + 6}">Никого не нашлось.</td></tr></tbody>`;
    this.matrix.innerHTML = `${head}${empty || `<tbody>${rows}</tbody>`}${foot}`;
  }

  openStudent(id) {
    const student = this.data.students.find((item) => item.id === id);
    const { exercises } = this.data;
    const total = summarize(student, exercises);

    const tasks = assignedExercises(student, exercises).map((exercise, i) => {
      const item = student.exercises[exercise.id];
      const state = cellState(item);
      const code = item?.solvedCode || item?.lastCode;
      const codeBlock = code
        ? `<pre class="task-code"><code>${code.split('\n').map((line) => highlightHtml(line)).join('\n')}</code></pre>`
        : '<p class="task-empty">Решение ещё не проверялось.</p>';
      return `
        <details class="task-row" data-state="${state}" ${code ? '' : 'data-empty'}>
          <summary>
            <span class="task-num">${i + 1}</span>
            <span class="task-name">${escapeHtml(exercise.title)}<small>${sectionOf(exercise) === 'emmet'
              ? `${LEVEL[exercise.difficulty]} · №${exercises.indexOf(exercise) + 1} в банке`
              : `контейнеры · ${LEVEL[exercise.difficulty]}`}</small></span>
            <span class="badge" data-state="${state}">${STATE_LABEL[state]}</span>
            <span class="task-metric" title="Попыток всего">${item?.attempts ?? 0}</span>
            <span class="task-metric" title="Время от открытия до решения">${formatDuration(item?.openedAt, item?.solvedAt)}</span>
            <span class="task-metric${flagsOf(item).length ? ' has-warning' : ''}" title="HTML вручную и попытки вставки">${(item?.handwritten ?? 0) + (item?.pastes ?? 0)}</span>
            <span class="task-metric${item?.solvedAfterAway ? ' has-warning' : ''}" title="Время вне страницы">${formatAwayTotal(item?.awayMs)}</span>
          </summary>
          <div class="task-detail">
            ${item?.attempts ? `<p class="task-breakdown">
              Принято: ${item.success} · почти: ${item.partial} · ошибка: ${item.error} · не та структура: ${item.mismatch}
              ${item.lastStatus ? ` · последняя проверка: <b>${STATUS_LABEL[item.lastStatus]}</b>` : ''}
            </p>` : ''}
            ${flagsOf(item).length ? `<p class="task-flags">⚠ ${flagsOf(item).join(' · ')}</p>` : ''}
            ${item?.aways ? `<p class="task-breakdown">Уходил со страницы ${item.aways} ${plural(item.aways, 'раз', 'раза', 'раз')}, всего ${formatAwayTotal(item.awayMs)}.</p>` : ''}
            <p class="task-code-label">${item?.solvedCode ? 'Принятое решение' : 'Последняя попытка'}</p>
            ${codeBlock}
          </div>
        </details>`;
    }).join('');

    this.studentSheet.innerHTML = `
      <header class="sheet-head">
        <div>
          <p class="eyebrow">Студент · ID <span class="key-text">${escapeHtml(student.key)}</span></p>
          <h2 class="sheet-title" id="student-sheet-title">${escapeHtml(student.name)}</h2>
          <p class="sheet-meta">Первый вход: ${formatRelative(student.firstSeen)} · последняя активность: ${formatRelative(student.lastSeen)}</p>
        </div>
        <button class="icon-btn" type="button" data-action="close" aria-label="Закрыть">${icons.close}</button>
      </header>
      <div class="sheet-stats">
        <p><b>${total.solved}</b> / ${total.total} решено</p>
        <p><b>${total.attempts}</b> ${plural(total.attempts, 'попытка', 'попытки', 'попыток')}</p>
        <p><b>${formatAverage(total.avgToSolve)}</b> попыток до решения</p>
        <p class="${total.violations ? 'has-warning' : ''}"><b>${total.violations}</b> ${plural(total.violations, 'нарушение', 'нарушения', 'нарушений')}</p>
        <p class="${total.suspicious ? 'has-warning' : ''}"><b>${formatAwayTotal(total.awayMs)}</b> вне страницы</p>
      </div>
      <div class="task-list">
        <div class="task-list-head" aria-hidden="true">
          <span>№</span><span>Работа</span><span>Статус</span><span>Попыток</span><span>Время</span><span>Наруш.</span><span>Вне стр.</span>
        </div>
        ${tasks}
      </div>
      <footer class="sheet-foot">
        <p class="sheet-hint">Нажмите на работу, чтобы увидеть код студента.</p>
        <div class="sheet-actions">
          <button class="btn btn-ghost" type="button" data-action="reassign">${icons.refresh}<span>Новый набор</span></button>
          <button class="btn btn-danger" type="button" data-action="reset">Сбросить статистику</button>
        </div>
      </footer>
    `;
    this.studentSheet.querySelector('[data-action="reset"]').addEventListener('click', async () => {
      if (!window.confirm(`Удалить всю статистику студента «${student.name}»? Отменить это нельзя.`)) return;
      try {
        await api.reset(this.key, student.id);
        this.studentSheet.close();
        this.load();
      } catch (error) {
        window.alert(error.message);
      }
    });
    this.studentSheet.querySelector('[data-action="reassign"]').addEventListener('click', async () => {
      if (!window.confirm(`Выдать студенту «${student.name}» новый случайный набор работ? Решённые работы останутся в статистике.`)) return;
      try {
        await api.reassign(this.key, student.id);
        await this.load();
        this.openStudent(student.id);
      } catch (error) {
        window.alert(error.message);
      }
    });
    if (!this.studentSheet.open) this.studentSheet.showModal();
  }

  openKeys() {
    const students = [...this.data.students].sort(SORTS.list);
    this.keysSheet.innerHTML = `
      <header class="sheet-head">
        <div>
          <p class="eyebrow">Доступ</p>
          <h2 class="sheet-title" id="keys-sheet-title">Ключи студентов</h2>
          <p class="sheet-meta">Студент входит на <b>${escapeHtml(siteUrl(this.data))}</b> по своему ID. Регистр букв и дефис не важны.</p>
        </div>
        <button class="icon-btn" type="button" data-action="close" aria-label="Закрыть">${icons.close}</button>
      </header>
      <table class="keys-table">
        <thead><tr><th scope="col">№</th><th scope="col">ФИО</th><th scope="col">ID для входа</th></tr></thead>
        <tbody>
          ${students.map((student, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${escapeHtml(student.name)}</td>
              <td><button class="key-copy" type="button" title="Скопировать" data-key="${escapeHtml(student.key)}">${escapeHtml(student.key)}</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
      <footer class="sheet-foot">
        <p class="sheet-hint">Нажмите на ID, чтобы скопировать. Новых студентов добавляет команда <code>npm run keys</code>.</p>
        <button class="btn btn-primary" type="button" data-action="print">${icons.print}<span>Печать карточек</span></button>
      </footer>
    `;
    this.keysSheet.querySelector('tbody').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-key]');
      if (!button) return;
      try {
        await navigator.clipboard.writeText(button.dataset.key);
        button.classList.add('is-copied');
        setTimeout(() => button.classList.remove('is-copied'), 1200);
      } catch {
        // буфер обмена недоступен (не https) — ключ видно и так
      }
    });
    this.keysSheet.querySelector('[data-action="print"]').addEventListener('click', () => printKeys(students, siteUrl(this.data)));
    this.keysSheet.showModal();
  }

  downloadCsv() {
    if (!this.data) return;
    const { exercises } = this.data;
    const blob = new Blob([toCsv(this.students, exercises)], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `emmet-статистика-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
}

/**
 * Адрес сайта для студентов. Если панель открыта на самом сервере (localhost),
 * студентам нужен его адрес в локальной сети.
 */
function siteUrl(data) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  return local && data.siteUrls?.length ? data.siteUrls[0] : window.location.origin;
}

/** Карточки с ключами для печати и раздачи: по одной на студента, с линиями отреза. */
function printKeys(students, url) {
  const sheet = document.getElementById('print-sheet');
  sheet.innerHTML = students.map((student) => `
    <div class="key-card">
      <p class="key-card-site">Emmet · Тетрадь — ${escapeHtml(url)}</p>
      <p class="key-card-name">${escapeHtml(student.name)}</p>
      <p class="key-card-key">${escapeHtml(student.key)}</p>
    </div>`).join('');
  window.print();
}

function logout(message) {
  adminKey.clear();
  try {
    if (message) sessionStorage.setItem('emmet.adminMessage', message);
  } catch {
    // сообщение не покажем, но выход всё равно произойдёт
  }
  window.location.reload();
}

const loginRoot = document.getElementById('login');
const adminRoot = document.getElementById('admin');

async function start(key) {
  const panel = new AdminPanel(adminRoot, key);
  await panel.load();
  loginRoot.hidden = true;
  adminRoot.hidden = false;
}

const login = new LoginScreen(loginRoot, {
  title: 'Панель преподавателя',
  subtitle: 'Введите ключ преподавателя. Он выводится командой npm run keys.',
  placeholder: 'ADM-XXXX-XXXX',
  onLogin: async (account, key) => {
    if (account.role !== 'admin') {
      throw new Error('Это ID студента. Студенты входят на главной странице.');
    }
    adminKey.set(key);
    await start(key);
  },
});

async function boot() {
  let message = '';
  try {
    message = sessionStorage.getItem('emmet.adminMessage') ?? '';
    sessionStorage.removeItem('emmet.adminMessage');
  } catch {
    // нет sessionStorage — нет и сообщения
  }
  const key = adminKey.get();
  if (key) {
    try {
      await api.overview(key);
      await start(key);
      return;
    } catch (error) {
      if (error.status === 401 || error.status === 403) adminKey.clear();
      message = error.message;
    }
  }
  login.show(message);
}

boot();
