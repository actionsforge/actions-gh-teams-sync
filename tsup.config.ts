import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['scripts/sync-teams.ts'],
  format: ['esm'],
  outDir: 'dist',
  target: 'node20',
  clean: true,
  dts: false,
  minify: false,
  sourcemap: false,
  noExternal: ['@actions/core', '@actions/github', 'js-yaml']
});
