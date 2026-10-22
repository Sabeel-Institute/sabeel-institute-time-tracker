import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-web/**',
      '**/lib/**',
      '**/build/**',
      '**/coverage/**',
      '**/.expo/**',
      'app/android/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // `args: 'all'` rather than the default `after-used`. The default only
      // reports a dead parameter if nothing after it is used, so whether the
      // rule sees one is decided by its POSITION in the signature — the same
      // dead argument was caught in one harness and invisible in a sibling for
      // that reason alone.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'all', argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['app/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    // Every color must come from a semantic theme token (src/theme), so a
    // hardcoded hex/rgb/hsl literal is a bug — it bypasses the Option-1 palette
    // and could not be re-themed in one place (the whole point of the token
    // layer). The only exemption is src/theme/** itself, which IS the palette;
    // the printed statement's stylesheet interpolates the tokens too.
    // app/** not app/src/**: App.tsx lives at app root and hardcoded the header
    // tint before this rule existed.
    files: ['app/**/*.{ts,tsx}'],
    ignores: ['app/src/theme/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
          message:
            'Hardcoded color. Use a semantic token from src/theme (e.g. t.bg.surface, t.text.muted).',
        },
        {
          selector: "Literal[value=/^(?:rgb|rgba|hsl|hsla)\\(/]",
          message: 'Hardcoded color. Use a semantic token from src/theme.',
        },
      ],
    },
  },
  {
    // The `page.evaluate` callbacks in the browser suites run IN THE BROWSER,
    // where `document` and `getComputedStyle` exist. eslint parses each file as
    // one program and cannot tell the two contexts apart, so the browser globals
    // are declared for the whole file. The alternative — and what these files
    // carried before the layout sweep arrived with sixteen more measurements —
    // is a `no-undef` disable comment above every single one.
    files: ['scripts/*-e2e.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  {
    // A hook that closes over a value missing from its dependency array keeps
    // serving the value from the render that created it — the stale-week bug
    // (docs/POSTMORTEM-2026-07-16-stale-week.md) one layer down, and nothing in
    // TypeScript can see it: a live row and a stale one are the same type.
    // exhaustive-deps is the only mechanical check for it, so it is an ERROR,
    // not the preset's warning: a warning does not fail CI.
    //
    // Deliberately NOT the plugin's `recommended` preset. v7 bundles the React
    // Compiler rule family (refs, set-state-in-effect, purity, immutability…),
    // which this app is not built for: its set-state-in-effect rule flags the
    // resets that exist precisely to CLEAR stale state (liveQuery's reset on
    // input change). Adopt that family, if ever, as one deliberate migration
    // with React Compiler, not as a side effect of installing a linter.
    files: ['app/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // The app's subscription primitives, and so the most valuable thing to
      // check: every live screen's freshness depends on `deps` listing what
      // `make` reads. The rule finds the callback at argument 0 and the deps at
      // argument 1 only, which is why both hooks take them in that order; in
      // any other shape it checks nothing and says so only as "dependencies
      // are unknown".
      'react-hooks/exhaustive-deps': ['error', { additionalHooks: '(useLiveQuery|useLiveDoc)' }],
    },
  },
  {
    // Live Firestore subscriptions must go through useLiveQuery/useLiveDoc,
    // which reset state when inputs change and on errors — hand-rolled
    // onSnapshot state showed one week's entries under another on slow
    // connections (docs/POSTMORTEM-2026-07-16-stale-week.md). Exemptions:
    // liveQuery.ts is the choke point; session.ts couples its doc listener to
    // the auth lifecycle and does its own reset.
    files: ['app/src/**/*.{ts,tsx}'],
    ignores: ['app/src/liveQuery.ts', 'app/src/session.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'firebase/firestore',
              importNames: ['onSnapshot'],
              message:
                'Subscribe via useLiveQuery/useLiveDoc (src/liveQuery.ts) — they reset on input change and clear on error. See docs/POSTMORTEM-2026-07-16-stale-week.md.',
            },
          ],
        },
      ],
    },
  },
);
