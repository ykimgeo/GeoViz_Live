import {defineConfig} from 'vite';
import {cpSync, existsSync, rmSync} from 'node:fs';
import {resolve} from 'node:path';

function copyDashboardData() {
  return {
    name: 'copy-dashboard-data',
    closeBundle() {
      const source = resolve('data');
      const target = resolve('dist/data');

      if (!existsSync(source)) return;

      rmSync(target, {recursive: true, force: true});
      cpSync(source, target, {recursive: true});
    }
  };
}

export default defineConfig({
  base: './',
  root: '.',
  publicDir: false,
  plugins: [copyDashboardData()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: false
  },
  build: {
    rollupOptions: {
      input: {
        dashboard: 'dashboard.html'
      }
    }
  },
  optimizeDeps: {
    include: [
      '@deck.gl/core',
      '@deck.gl/geo-layers',
      '@deck.gl/layers',
      '@flowmap.gl/layers'
    ]
  }
});
