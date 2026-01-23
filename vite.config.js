import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Use relative base for builds so deploys work under subpaths (e.g. /test/)
  base: command === 'build' ? './' : '/',
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: './index.html',
      },
    },
  },
  server: {
    open: true,
    port: 3000,
  },
}));
