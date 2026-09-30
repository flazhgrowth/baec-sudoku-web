import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In `http` API mode the dev server forwards /ms/sudous/api/* to the real backend,
// so no CORS setup is needed during development.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:12000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/ms/sudous/api': { target: apiTarget, changeOrigin: true } },
  },
  test: { environment: 'node' },
});
