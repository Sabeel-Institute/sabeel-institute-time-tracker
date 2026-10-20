// Metro configured for the npm-workspaces monorepo: watch the repo root and resolve
// modules from both the app and the hoisted root node_modules.
// Sentry's wrapper adds debug IDs to bundles so uploaded source maps match
// exactly; it delegates to expo's default config otherwise.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');

const config = getSentryExpoConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

/**
 * Keep the transform cache INSIDE this repo.
 *
 * Expo's default is `os.tmpdir()/metro-cache` — one directory shared by every
 * Expo project on the machine. That would be merely wasteful, except that
 * `--clear` does not clear *this project's* entries: Expo's FileStore sees a
 * root inside `os.tmpdir()` and `renameSync`s THE WHOLE DIRECTORY away, then
 * deletes it in the background (`@expo/metro-config/build/file-store.js`).
 *
 * Every e2e script here passes `--clear`, and so do the sibling repos' — each
 * one documented as load-bearing, because `EXPO_PUBLIC_*` is inlined at bundle
 * time and a stale cache serves a bundle built under different env. So three
 * projects were taking turns deleting each other's warm cache, and a Metro
 * already running elsewhere kept writing into shard directories that no longer
 * existed.
 *
 * A repo-local root fixes it for every entry point, including a hand-run
 * `npx expo start` that no wrapper script sets TMPDIR for.
 *
 * Set as a FUNCTION, not an array: Metro calls it with the `metro-cache` module
 * (`metro-config/src/loadConfig.js` `mergeConfigObjects`), so the store is built
 * without this file importing `metro-cache` directly — which would mean
 * declaring a dependency whose version is pinned transitively by `@expo/metro`
 * and would drift from it.
 */
config.cacheStores = ({ FileStore }) => [
  new FileStore({ root: path.resolve(projectRoot, '.metro-cache') }),
];

module.exports = config;
