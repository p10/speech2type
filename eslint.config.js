import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['webapp/', 'bin/hotkey-manager', 'bin/permission-checker', 'bin/mic-recorder'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
];
