import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    lib: {
      entry: 'src/main.ts',
      name: 'CultivationGame',
      formats: ['iife'],
      fileName: () => 'game.js',
      cssFileName: 'game',
    },
    sourcemap: true,
  },
});
