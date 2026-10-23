import '@fontsource/oswald/500.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/main.css';

import { ExerciseStore } from './services/ExerciseStore.js';
import { validate, Status } from './services/ValidationService.js';
import { TargetPanel } from './components/TargetPanel.js';
import { CodeEditorPanel } from './components/CodeEditorPanel.js';
import { LessonNav } from './components/LessonNav.js';

/** App: связывает практические работы, навигацию, образец и редактор. */
function App() {
  const store = new ExerciseStore();

  const nav = new LessonNav(document.getElementById('lesson-nav'), { store });
  const target = new TargetPanel(document.getElementById('target'));
  const editor = new CodeEditorPanel(document.getElementById('practice'), {
    store,
    validate: (code, context) => validate(code, store.current, context),
    onResult: (result) => {
      if (result.status === Status.success) store.markSolved(store.current.id);
    },
  });

  let shownId = null;
  store.subscribe(() => {
    nav.render();
    if (store.current.id !== shownId) showExercise();
  });

  function showExercise() {
    shownId = store.current.id;
    target.load(store.current);
    editor.load(store.current);
  }

  nav.render();
  showExercise();
  document.documentElement.classList.add('is-ready');
}

App();
