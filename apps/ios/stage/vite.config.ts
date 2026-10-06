import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const here = import.meta.dirname;

/**
 * The app loads this page from its bundle over file://, where a module script is
 * a cross-origin request and is refused. One classic script has no such problem.
 */
function classicScript(): Plugin {
  return {
    name: 'cairn-classic-script',
    enforce: 'post',
    transformIndexHtml: (html) => html
      .replace(/<script type="module" crossorigin/g, '<script defer')
      .replace(/<link rel="stylesheet" crossorigin/g, '<link rel="stylesheet"'),
  };
}

export default defineConfig({
  root: here,
  base: './',
  plugins: [react(), classicScript()],
  resolve: {
    alias: [
      { find: /^@cairn\/core\/(.*)$/, replacement: `${resolve(here, '../../../packages/core/src')}/$1` },
    ],
  },
  build: {
    outDir: resolve(here, '../Cairn/Resources/Stage'),
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: { format: 'iife', entryFileNames: 'stage.js', assetFileNames: 'stage[extname]' },
    },
  },
});
