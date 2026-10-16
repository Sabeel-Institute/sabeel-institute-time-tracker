// The emulator + web-bundle stack that every browser e2e in this repo runs on.
//
// Extracted from scripts/web-e2e.mjs when scripts/screens-e2e.mjs needed the
// same bring-up. Each guard here is load-bearing and the reasoning is in
// docs/DEV-TOOLING.md — the two lessons worth repeating at the call site:
// **port-open is not function-ready**, and **a leftover emulator answers on the
// port while having registered nothing**.
//
// One deliberate difference from web-e2e's original: the browser is Playwright's
// OWN Chromium, not a system `/usr/bin/google-chrome`. That is what lets a suite
// built on this module run on a CI runner, where no system Chrome is installed.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';
import { EMULATOR_PORTS } from './ports.mjs';

export const ROOT = new URL('../..', import.meta.url).pathname;
export const PROJECT = 'demo-sabeel';
const HOST = '127.0.0.1';
export const EMULATOR_HOSTS = {
  auth: `${HOST}:${EMULATOR_PORTS.auth}`,
  firestore: `${HOST}:${EMULATOR_PORTS.firestore}`,
  functions: `${HOST}:${EMULATOR_PORTS.functions}`,
};

const children = [];

/** Spawn a long-lived child that `shutdown()` will reap. */
function bg(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  children.push(child);
  return child;
}

const closers = [];
/** Register a teardown (a server, a browser) to run on `shutdown()`. */
function onShutdown(fn) {
  closers.push(fn);
}

/**
 * Kill everything this process started, then exit. Detached children are killed
 * by PROCESS GROUP (`-pid`): the emulator spawns its own runtime children, and
 * signalling only the parent leaves them holding the ports for the next run.
 */
export function shutdown(code) {
  for (const close of closers) {
    try {
      close();
    } catch {
      /* already closed */
    }
  }
  for (const c of children) {
    try {
      process.kill(-c.pid, 'SIGTERM');
    } catch {
      try {
        c.kill('SIGTERM');
      } catch {
        /* gone */
      }
    }
  }
  process.exit(code);
}

function waitFor(url, label, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error(`timeout waiting for ${label}`));
        else setTimeout(tick, 500);
      });
    };
    tick();
  });
}

/**
 * The functions emulator ACCEPTS CONNECTIONS on its port well before it has
 * registered any function: until then every call 404s with "Function ... does
 * not exist". A 404 carries no CORS headers, so in the browser that surfaces as
 * a misleading "blocked by CORS policy" error and the app shows a bare
 * "internal" — which looks like a broken callable rather than a race.
 * Wait for a known callable to actually EXIST, not merely for the port to answer.
 */
function waitForFunctionRegistered(name, timeoutMs = 180000) {
  const url = `http://${EMULATOR_HOSTS.functions}/${PROJECT}/us-central1/${name}`;
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const req = http.request(url, { method: 'OPTIONS' }, (res) => {
        res.resume();
        if (res.statusCode !== 404) resolve();
        else if (Date.now() > deadline) reject(new Error(`timeout: ${name} never registered`));
        else setTimeout(tick, 1000);
      });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error(`timeout: ${name} never registered`));
        else setTimeout(tick, 1000);
      });
      req.end();
    };
    tick();
  });
}

/** JDK 21 for the emulators, without disturbing the Gradle default (JDK 17). */
function emulatorEnv() {
  const env = { ...process.env };
  const jdk = env.ST_JDK21_HOME ?? `${env.HOME}/opt/jdk-21`;
  if (existsSync(jdk)) {
    env.JAVA_HOME = jdk;
    env.PATH = `${jdk}/bin:${env.PATH}`;
  }
  return env;
}

/**
 * Build the shared lib + functions, then export the web bundle in emulator mode.
 *
 * `--clear`: EXPO_PUBLIC_* vars are inlined at bundle time and Metro's cache can
 * serve a bundle built under DIFFERENT env (e.g. a prod export) — never trust it.
 */
export function buildWebBundle() {
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync(
    'npx',
    ['expo', 'export', '--platform', 'web', '--output-dir', 'dist-web', '--clear'],
    {
      cwd: join(ROOT, 'app'),
      stdio: 'inherit',
      env: { ...process.env, EXPO_PUBLIC_USE_EMULATORS: '1' },
    },
  );
}

/**
 * Start auth+firestore+functions and wait until they can actually serve.
 *
 * `logPath` is TRUNCATED PER RUN. It used to be appended/left behind, so
 * debugging a failure meant reading a log from days earlier and drawing
 * confident conclusions from it.
 */
export async function startEmulators({ logPath, readyCallable = 'setUserAccess' }) {
  // A previous run that was killed leaves emulators squatting on these ports;
  // the next run then talks to a half-dead one (see free-emulator-ports.sh).
  execFileSync('bash', [join(ROOT, 'scripts/free-emulator-ports.sh')], { stdio: 'inherit' });

  const emu = bg(
    'firebase',
    ['emulators:start', '--project', PROJECT, '--only', 'auth,firestore,functions'],
    { env: emulatorEnv(), detached: true },
  );
  const log = createWriteStream(logPath, { flags: 'w' });
  // Surface emulator trouble (e.g. a function param prompt that would hang a
  // headless run) instead of silently timing out later.
  const watch = (d) => {
    const s = d.toString();
    log.write(s);
    if (/error|Error|Enter a string value|throw|internal/i.test(s)) process.stderr.write(s);
  };
  emu.stderr.on('data', watch);
  emu.stdout.on('data', watch);

  await waitFor(`http://${EMULATOR_HOSTS.auth}`, 'auth emulator');
  await waitFor(`http://${EMULATOR_HOSTS.firestore}`, 'firestore emulator');
  await waitFor(`http://${EMULATOR_HOSTS.functions}`, 'functions emulator', 120000);
  // Port-open is not function-ready; see waitForFunctionRegistered.
  await waitForFunctionRegistered(readyCallable);
}

/**
 * Serve `app/dist-web` with an SPA fallback, on an EPHEMERAL port — a fixed one
 * collides with a prior run's lingering server, and the new process then either
 * fails to bind or (worse) the tests silently drive the stale bundle.
 */
export async function serveWebBundle() {
  const dist = join(ROOT, 'app', 'dist-web');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    let file = join(dist, path);
    if (path === '/' || !existsSync(file)) file = join(dist, 'index.html');
    res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  onShutdown(() => server.close());
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

/**
 * Playwright's bundled Chromium — NOT a system Chrome. `playwright` is already
 * a devDependency here, so this adds no install step beyond `playwright install
 * chromium`, and it is the difference between a suite that can run on a CI
 * runner and one that needs a desktop browser to be present.
 */
export async function launchBrowser() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  onShutdown(() => browser.close());
  return browser;
}

/**
 * A sign-in, settled: the screen this account should land on, or the app's
 * own "Still setting up your account", which appears when the profile has not
 * reached the page in the app's whole wait (session.ts,
 * PROVISIONING_PATIENCE_MS) and is answered with the app's own Try again (a
 * page reload on the web). Returns whether it took Try again, for the caller
 * to COUNT and print, never to hide.
 *
 * Why the suites need it: on a freshly started emulator stack the first
 * sign-in's database connection has delivered nothing at all, the profile made
 * in a second and never heard, until the page reloaded (2026-10-16; closing
 * and reopening the connection did not cure it). Waiting longer does not
 * either, so this is not the ten-second refusal that used to cover it.
 */
export async function settle(page, landing) {
  const slow = page.getByText('Still setting up your account', { exact: false });
  await landing.or(slow).first().waitFor({ timeout: 75000 });
  if (!(await slow.isVisible().catch(() => false))) return false;
  await page.getByText('Try again', { exact: true }).click();
  await landing.first().waitFor({ timeout: 75000 });
  return true;
}

/** The emulator-only sign-in row, which the app offers whenever USE_EMULATORS is set. */
export async function devSignIn(page, email) {
  await page.getByPlaceholder('email').fill(email);
  await page.getByText('Dev: sign in', { exact: true }).click();
}

/**
 * The first-admin bootstrap, run as the script an operator would run — so the
 * path the e2e exercises is the documented one, not a private shortcut.
 */
export function grantAdmin(email) {
  execFileSync('node', ['scripts/grant-admin.mjs', email], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      FIREBASE_AUTH_EMULATOR_HOST: EMULATOR_HOSTS.auth,
      FIRESTORE_EMULATOR_HOST: EMULATOR_HOSTS.firestore,
    },
  });
}
