import { defineConfig } from 'vite';
import { createApi } from './server/api.js';

/** API тренажёра внутри dev- и preview-сервера Vite, плюс короткий адрес /admin. */
function trainerApi() {
  const mount = (server) => {
    const api = createApi();
    server.middlewares.use((req, res, next) => {
      if (req.url === '/admin' || req.url?.startsWith('/admin?')) req.url = req.url.replace('/admin', '/admin.html');
      api(req, res, next);
    });
  };
  return { name: 'trainer-api', configureServer: mount, configurePreviewServer: mount };
}

export default defineConfig({
  plugins: [trainerApi()],
  build: {
    // CodeMirror + Emmet — ожидаемо крупный, но единственный бандл.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      input: { main: 'index.html', admin: 'admin.html' },
    },
  },
});
