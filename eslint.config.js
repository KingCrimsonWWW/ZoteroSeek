import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.worker,
        React: 'readonly',
        // Zotero globals
        Zotero: 'readonly',
        ztoolkit: 'readonly',
        Zotero_Tabs: 'readonly',
        Components: 'readonly',
        // Zotero plugin globals
        _globalThis: 'writable',
        addon: 'readonly',
        __env__: 'readonly',
        // Fluent API globals
        Localization: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      react: react,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...react.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'no-console': 'error',
    },
    settings: {
      react: {
        version: '18.3.1',
      },
    },
  },
  {
    ignores: [
      'dist/',
      'build/',
      'node_modules/',
      'addon/',
      '.reference-*/',
      '.scaffold/',
      '.sisyphus/',
      'patches/',
      '*.config.js',
      '*.config.mjs',
      'src/typings/',
      'typings/',
    ],
  },
];
