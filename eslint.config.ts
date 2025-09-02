import eslintPluginTs from '@typescript-eslint/eslint-plugin';
import parserTs from '@typescript-eslint/parser';
import prettierPlugin from 'eslint-plugin-prettier';

export default [
  {
    ignores: ['node_modules/**/*', 'dist/**/*', '.env', 'eslint.config.ts'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: parserTs,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: ['./tsconfig.json'],
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': eslintPluginTs,
      prettier: prettierPlugin,
    },
    rules: {
      'no-unused-vars': 'off', // Disable core no-unused-vars
      '@typescript-eslint/no-unused-vars': 'warn', // Enable TypeScript-aware no-unused-vars
      'prefer-const': 'error',
      'no-unused-expressions': 'error',
      'no-undef': 'off', // Disable no-undef as it conflicts with TypeScript's global types
      'no-unreachable': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'prettier/prettier': 'error',
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
  },
];
