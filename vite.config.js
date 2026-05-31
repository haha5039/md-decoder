import { defineConfig } from 'vite';

export default defineConfig({
  base: '/md-decoder/',
  server: {
    host: true,
    allowedHosts: true, // Allow all hosts for reverse proxy / ngrok
  }
});
