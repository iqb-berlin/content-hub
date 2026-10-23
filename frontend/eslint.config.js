// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = defineConfig([
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
      '@angular-eslint/prefer-inject': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-control-regex': 'off',
      'no-useless-assignment': 'off',
      'prefer-const': 'warn',
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended],
    rules: {},
  },
  {
    files: [
      'src/app/core/guards/*.ts',
      'src/app/core/services/acp-navigation.service.ts',
      'src/app/core/services/pending-personal-session-storage.service.ts',
    ],
    ignores: ['**/*.spec.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.app.json', tsconfigRootDir: __dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
]);
