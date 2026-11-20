import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

const noElectron = {
  name: 'electron',
  message: 'core/ knows nothing about the UI — see docs/architecture.md.'
}

const bareWriteMessage =
  'Write through persist.ts (writeTextFile / writeJsonFile / writeNewFile) — see docs/data/migrations-and-writes.md.'

const noBareWrite = ['node:fs/promises', 'fs/promises'].map((name) => ({
  name,
  importNames: ['writeFile'],
  message: bareWriteMessage
}))

export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', 'coverage/**']
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // The root tsconfig.json is only a dispatcher, so projects are listed explicitly.
        project: ['./tsconfig.node.json', './tsconfig.web.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // §11.3: any is forbidden — genuinely unknown data uses unknown.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true }
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }]
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules
  },
  {
    // §11.1: the core has to stay headless, so it can be tested without a
    // display and extracted into a CLI or daemon later. §11.2: a file is
    // replaced whole, so a reader — a running `sh` included — never sees half.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [noElectron, ...noBareWrite] }]
    }
  },
  {
    files: ['src/main/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: noBareWrite }]
    }
  },
  {
    // A later block replaces the rule's options rather than merging them, so
    // this one restates what core keeps. persist.ts is where the write lives;
    // a test builds its fixtures with a plain write.
    files: ['src/core/persist.ts', 'src/core/**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [noElectron] }]
    }
  },
  {
    files: ['src/main/**/*.test.ts'],
    rules: {
      'no-restricted-imports': 'off'
    }
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off'
    }
  },
  {
    files: ['*.config.{js,ts}', 'eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked]
  },
  prettier
)
