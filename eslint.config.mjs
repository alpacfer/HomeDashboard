import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // assets/ is shelved work, not part of the build: kept as it was so it can
  // be moved back, and checked again when it is. See assets/clock-behavior/.
  globalIgnores(['.next/**', 'out/**', 'build/**', 'dist/**', 'next-env.d.ts', 'assets/**']),
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
          { name: 'leaflet', message: 'lib/ must stay pure. Put map code in components/forecast-map-panel.tsx.' },
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
  {
    // components/ may reach down into lib/ but never up into app/: routes
    // compose components, not the other way round. See docs/ARCHITECTURE.md.
    files: ['components/**/*.ts', 'components/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@/app/*', '../app/*'], message: 'components/ must not import from app/. Dependencies point inward: app/ -> components/ -> lib/.' },
        ],
      }],
    },
  },
  {
    // Every formatter names its time zone. The display is Copenhagen-local
    // whatever the device thinks, and a formatter that forgets to say so is
    // the classic way a date goes wrong at midnight. See AGENTS.md.
    files: ['**/*.ts', '**/*.tsx', 'scripts/**/*.mjs'],
    ignores: ['scripts/generate-daily-facts.mjs'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'NewExpression[callee.object.name="Intl"][callee.property.name="DateTimeFormat"]:not(:has(ObjectExpression > Property[key.name="timeZone"]))',
        message: 'Intl.DateTimeFormat needs an explicit timeZone: Europe/Copenhagen unless the API contract says otherwise.',
      }, {
        selector: 'CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]',
        message: 'toLocale*String uses the device time zone and locale. Use an Intl.DateTimeFormat with timeZone: Europe/Copenhagen.',
      }],
    },
  },
]);

export default eslintConfig;
