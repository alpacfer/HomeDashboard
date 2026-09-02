import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'dist/**', 'next-env.d.ts']),
  {
    // lib/ holds pure logic: parsing, validation, time conversion, selection.
    // Nothing in it may reach for React, the DOM, the network, or Next.js.
    // Keeping this structural is what makes the modules trivially testable
    // from plain node:test without a renderer. See docs/ARCHITECTURE.md.
    files: ['lib/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'react', message: 'lib/ must stay pure. Put React code in components/.' },
          { name: 'react-dom', message: 'lib/ must stay pure. Put React code in components/.' },
          { name: 'leaflet', message: 'lib/ must stay pure. Put map code in components/radar-panel.tsx.' },
        ],
        patterns: [
          { group: ['next', 'next/*'], message: 'lib/ must stay framework-free. Put Next.js code in app/ or components/.' },
          { group: ['@/app/*', '@/components/*'], message: 'lib/ must not depend on routes or components. Dependencies point inward.' },
        ],
      }],
      'no-restricted-globals': ['error',
        { name: 'window', message: 'lib/ must stay pure. Pass values in as arguments and keep browser access in components/.' },
        { name: 'document', message: 'lib/ must stay pure. Pass values in as arguments and keep DOM access in components/.' },
        { name: 'localStorage', message: 'lib/ must stay pure. Read storage in components/ and pass the value in.' },
        { name: 'fetch', message: 'lib/ must stay pure. Fetch in components/ or a route handler and pass the parsed body in.' },
      ],
    },
  },
]);

export default eslintConfig;
