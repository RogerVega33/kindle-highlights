import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envDir: false,
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:3001' },
    fs: {
      deny: ['**/.env', '**/.env.*', '**/*.env', '**/.git/**', '**/.aws/**', '**/.codex/**', '**/Ejemplos/**'],
    },
  },
  build: { outDir: 'build/dist', sourcemap: false },
});
