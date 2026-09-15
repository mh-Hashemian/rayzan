import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-electron/**',
      '**/release/**',
      '**/node_modules/**',
      'apps/rayzan-desktop/scripts/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['apps/browser-extension/**/*.ts'],
    languageOptions: {
      globals: {
        chrome: 'readonly',
        document: 'readonly',
        window: 'readonly',
        location: 'readonly',
        HTMLElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        Element: 'readonly',
        Event: 'readonly',
        KeyboardEvent: 'readonly',
        CustomEvent: 'readonly',
        RequestInit: 'readonly',
      },
    },
  },
  {
    files: ['apps/rayzan-desktop/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        HTMLElement: 'readonly',
      },
    },
  },
);
