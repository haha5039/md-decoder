import { defineConfig } from 'vite';

import { resolve } from 'path';

export default defineConfig({
  base: '/md-decoder/',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true, // Allow all hosts for reverse proxy / ngrok
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        play: resolve(__dirname, 'play.html')
      }
    }
  }
});
