import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['scripts/sync-teams.ts'],
  format: ['cjs'],
  outDir: 'dist',
  target: 'node24',
  clean: true,
  dts: false,
  minify: false,
  sourcemap: false,
  noExternal: [
    '@actions/core',
    '@actions/github',
    'js-yaml',
    '@octokit/rest'
  ]
});
