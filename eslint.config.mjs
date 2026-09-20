// eslint.config.mjs
//
// `next lint` was removed in Next.js 16, which left the old `"lint": "next lint"`
// script parsing "lint" as a project directory and exiting 1 with
// "Invalid project directory provided" — so nothing had been linted since the
// upgrade. This is the flat-config replacement.

import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'functions/**',
      'android/**',
      'ios/**',
      'public/**',
      'out/**',
      'worker/**',
      'next-env.d.ts',
    ],
  },
  // core-web-vitals on top of the base config: the extra rules it adds are about
  // image and script loading, which is exactly the ground this app keeps
  // tripping over.
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // The aim is a lint run that exits 0 today and fails on something real
      // tomorrow. A red baseline of 200 pre-existing problems is a run nobody
      // reads, so the noise rules are demoted and the useful ones kept.

      // 95 of the original 107 errors were this rule objecting to apostrophes in
      // prose ("don't", "you're"). The app renders them correctly; escaping them
      // would make the copy harder to edit for no benefit.
      'react/no-unescaped-entities': 'off',

      // This codebase uses `any` deliberately in places (Firestore document
      // shapes, Zod recursive types). Worth revisiting file by file, not as 200
      // blocking errors.
      '@typescript-eslint/no-explicit-any': 'off',

      // Kept as warnings: both catch real problems, and there is a backlog of
      // each to work through (84 unused bindings, 13 dependency arrays).
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'react-hooks/exhaustive-deps': 'warn',
    },
    linterOptions: {
      // Without this, `eslint --fix` deletes the existing
      // `// eslint-disable-next-line react-hooks/exhaustive-deps` directives:
      // demoting that rule to a warning makes ESLint consider them redundant.
      // They record a deliberate decision, so they stay.
      reportUnusedDisableDirectives: 'off',
    },
  },
  {
    // Config files are CommonJS by necessity — next.config.ts requires next-pwa,
    // tailwind.config.ts requires its plugins.
    files: ['**/*.config.{ts,js,mjs}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'import/no-anonymous-default-export': 'off',
    },
  },
];
