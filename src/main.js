import '@fontsource/oswald/500.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/main.css';

import { ExerciseStore } from './services/ExerciseStore.js';
import { validate, Status } from './services/ValidationService.js';
import { DemoPanel } from './components/DemoPanel.js';
import { CodeEditorPanel } from './components/CodeEditorPanel.js';
import { LessonNav } from './components/LessonNav.js';

/** App: связывает упражнения, навигацию, демонстрацию и редактор. */
function App() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const store = new ExerciseStore();

  const nav = new LessonNav(document.getElementById('lesson-nav'), { store });
  const demo = new DemoPanel(document.getElementById('demo'), { reducedMotion });
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
    demo.load(store.current);
    editor.load(store.current);
  }

  nav.render();
  showExercise();
  document.documentElement.classList.add('is-ready');
}

App();
