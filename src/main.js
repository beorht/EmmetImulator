import '@fontsource/oswald/500.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/main.css';
import './styles/boxes.css';

import exercises from './data/exercises.json';
import containers from './data/containers.json';
import { ExerciseStore } from './services/ExerciseStore.js';
import { validate, Status } from './services/ValidationService.js';
import { api, SavedKey, EventReporter } from './services/Api.js';
import { escapeHtml } from './services/highlight.js';
import { FocusMonitor, formatAway } from './services/FocusMonitor.js';
import { TargetPanel } from './components/TargetPanel.js';
import { CodeEditorPanel } from './components/CodeEditorPanel.js';
import { LessonNav } from './components/LessonNav.js';
import { LoginScreen } from './components/LoginScreen.js';
import { LessonView, CONTAINERS_LESSON } from './components/LessonView.js';
import { icons } from './components/icons.js';

const studentKey = new SavedKey('emmet.studentKey');
const adminKey = new SavedKey('emmet.adminKey');

const TOAST_TIME = 6000;
// Как часто открытая страница спрашивает, не завершил ли преподаватель занятие.
const SESSION_POLL = 15_000;

function showToast(text) {
  const toast = document.getElementById('toast');
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, TOAST_TIME);
}

/**
 * Защита от списывания на странице: скопировать образец или код нельзя —
 * значит, их не отнести в чат-бот или однокурснику одним движением.
 */
function blockCopying() {
  for (const type of ['copy', 'cut', 'dragstart']) {
    document.addEventListener(type, (event) => event.preventDefault());
  }
}

/**
 * План студента в порядке, выданном сервером: личный набор Emmet, затем задания на контейнеры.
 * Перед первым заданием на контейнеры вставляется шаг с теорией.
 */
function buildPlan(assignment) {
  const byId = new Map([...exercises, ...containers].map((exercise) => [exercise.id, exercise]));
  const plan = assignment.map((id) => byId.get(id)).filter(Boolean);
  const firstContainer = plan.findIndex((exercise) => exercise.section === 'containers');
  if (firstContainer !== -1) plan.splice(firstContainer, 0, CONTAINERS_LESSON);
  return plan;
}

/** App: связывает практические работы, теорию, навигацию, образец, редактор и отправку статистики. */
function App({ student, assignment, progress }, key) {
  const store = new ExerciseStore(buildPlan(assignment));
  store.solved = new Set(progress.solved);
  store.index = store.resumeIndex();

  const userChip = document.getElementById('user-chip');
  userChip.innerHTML = `
    <span class="user-status" title="Результаты сохраняются"></span>
    <span class="user-name">${escapeHtml(student.name)}</span>
    <button class="icon-btn" type="button" title="Выйти" aria-label="Выйти">${icons.logout}</button>
  `;
  const status = userChip.querySelector('.user-status');
  userChip.querySelector('button').addEventListener('click', logout);

  const reporter = new EventReporter(key, {
    onConnection: (online) => {
      status.classList.toggle('is-offline', !online);
      status.title = online ? 'Результаты сохраняются' : 'Нет связи с сервером — результаты отправятся позже';
    },
    onExpired: () => logout('Ваш ID больше не действует. Обратитесь к преподавателю.'),
    onClosed: () => window.location.reload(),
  });
  watchSession(true);

  const nav = new LessonNav(document.getElementById('lesson-nav'), { store });
  const target = new TargetPanel(document.getElementById('target'));
  const panels = [document.getElementById('target'), document.getElementById('practice')];
  const lessonRoot = document.getElementById('lesson');
  const lesson = new LessonView(lessonRoot, { onStart: () => store.select(store.index + 1) });
  const editor = new CodeEditorPanel(document.getElementById('practice'), {
    store,
    onPreview: (code) => target.showStudent(code),
    validate: (code, context) => validate(code, store.current, context),
    onBlocked: (kind) => reporter.send({ type: 'paste', exerciseId: store.current.id, kind }),
    onResult: (result, code) => {
      if (result.status === Status.success) store.markSolved(store.current.id);
      // Нажатие Tab в пустом редакторе — не попытка решения.
      if (!code.trim()) return;
      reporter.send({
        type: 'attempt',
        exerciseId: store.current.id,
        status: result.status,
        handwritten: Boolean(result.handwritten),
        code,
      });
    },
  });

  let shownId = null;
  store.subscribe(() => {
    nav.render();
    if (store.current.id !== shownId) showExercise();
  });

  function showExercise() {
    shownId = store.current.id;
    const isLesson = store.current.kind === 'lesson';
    lessonRoot.hidden = !isLesson;
    for (const panel of panels) panel.hidden = isLesson;
    if (isLesson) {
      lesson.show();
      store.markSolved(store.current.id); // прочитанная теория отмечается в навигации
      return;
    }
    target.load(store.current);
    editor.load(store.current);
    reporter.send({ type: 'open', exerciseId: shownId });
  }

  new FocusMonitor({
    onReturn: (ms) => {
      if (store.current.kind !== 'lesson') reporter.send({ type: 'away', exerciseId: store.current.id, ms });
      showToast(`Вы были вне тетради ${formatAway(ms)}. Преподаватель видит, когда и надолго ли вы уходили.`);
    },
  });
  blockCopying();

  nav.render();
  showExercise();
  document.getElementById('app').hidden = false;
  document.documentElement.classList.add('is-ready');
}

const login = new LoginScreen(document.getElementById('login'), {
  title: 'Вход в тетрадь',
  subtitle: 'Введите личный ID, который выдал преподаватель. По нему сохраняются ваши результаты.',
  onLogin: async (account, key) => {
    if (account.role === 'admin') {
      adminKey.set(key);
      window.location.href = '/admin';
      return;
    }
    const me = await api.me(key);
    studentKey.set(key);
    login.hide();
    App(me, key);
  },
});

/** Экран вместо тетради, пока занятие завершено. Ключ не стирается — после открытия вход не нужен. */
function showFinished() {
  const root = document.getElementById('login');
  root.innerHTML = `
    <div class="login-card finished-card" role="status">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">&lt;/&gt;</span>
        <span class="brand-name">Emmet</span>
        <span class="brand-sub">тетрадь</span>
      </div>
      <span class="finished-mark" aria-hidden="true">${icons.check}</span>
      <h1 class="login-title">Занятие окончено</h1>
      <p class="login-text">Спасибо за работу! Ваши результаты сохранены и уже у преподавателя.</p>
    </div>
  `;
  root.hidden = false;
  document.getElementById('app').hidden = true;
  watchSession(false);
}

/**
 * Перезагружает страницу, когда занятие перейдёт в состояние reloadWhenClosed:
 * из тетради — когда занятие завершат (true), с экрана «Занятие окончено» — когда откроют (false).
 */
function watchSession(reloadWhenClosed) {
  setInterval(async () => {
    try {
      if ((await api.session()).closed !== reloadWhenClosed) return;
    } catch {
      return; // нет связи — спросим в следующий раз
    }
    window.location.reload();
  }, SESSION_POLL);
}

function logout(message) {
  studentKey.clear();
  try {
    if (typeof message === 'string') sessionStorage.setItem('emmet.loginMessage', message);
  } catch {
    // сообщение не покажем, но выход всё равно произойдёт
  }
  window.location.reload();
}

async function boot() {
  try {
    if ((await api.session()).closed) {
      showFinished();
      return;
    }
  } catch {
    // сервер недоступен — дальше покажем обычную ошибку входа
  }

  let message = '';
  try {
    message = sessionStorage.getItem('emmet.loginMessage') ?? '';
    sessionStorage.removeItem('emmet.loginMessage');
  } catch {
    // нет sessionStorage — нет и сообщения
  }

  const key = studentKey.get();
  if (key) {
    try {
      App(await api.me(key), key);
      return;
    } catch (error) {
      if (error.closed) {
        showFinished();
        return;
      }
      if (error.status === 401) studentKey.clear();
      message = error.message;
    }
  }
  login.show(message);
}

boot();
