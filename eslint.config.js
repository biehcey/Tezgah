import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { builtinModules } from 'node:module';

// core yalnızca saf mantıktır: Node, DOM ya da G/Ç yapan paketlere bağımlı olamaz.
const coreForbiddenPackages = [...builtinModules, 'react', 'react-dom', 'pg', 'ws', 'ssh2', '@napi-rs/keyring'];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // `const { password, ...fields } = input` ile alan ayıklamak serbest.
    rules: { '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }] },
  },
  {
    files: ['src/server/**/*.ts', '*.config.{ts,js}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    // core saf mantıktır: server'ı, web'i, Node'u ya da DOM'a bağlı paketleri import edemez.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)(server|web)(/|$)',
              message: 'core, server ya da web katmanını import edemez.',
            },
            {
              regex: '^node:',
              message: 'core Node API\'lerine bağımlı olamaz.',
            },
            {
              group: coreForbiddenPackages.flatMap((m) => [m, `${m}/*`]),
              message: 'core saf kalmalı: Node, DOM ya da G/Ç bağımlılığı olamaz.',
            },
          ],
        },
      ],
    },
  },
);
