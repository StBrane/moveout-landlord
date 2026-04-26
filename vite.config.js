import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Inline assets under 100kb — keeps the app self-contained for Capacitor.
    // Without this, Capacitor's webview hits broken asset URLs at runtime.
    assetsInlineLimit: 100000,
  },
});
