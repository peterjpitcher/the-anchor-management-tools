const { FlatCompat } = require('@eslint/eslintrc')

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

module.exports = [
  {
    ignores: ['**/.next/**', '**/node_modules/**', '**/out/**', '**/build/**', '**/coverage/**'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'react-hooks/exhaustive-deps': 'off',
      '@next/next/no-img-element': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['src/scripts/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Opening hours are effective-dated: several versions of the weekly schedule
    // can exist at once, so `.from('business_hours')` filtered only by day_of_week
    // returns an arbitrary row. Every reader must go through the resolver, which
    // is the whole point of src/lib/business-hours/.
    //
    // The exceptions below all scope their query with .eq('version_id', ...), so
    // they are already version-correct.
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/lib/business-hours/**',
      'src/services/business-hours.ts',
      'src/app/api/business/hours/route.ts',
      'src/app/api/business-hours/route.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='from'][arguments.0.value='business_hours']",
          message:
            "Do not read business_hours directly. Opening hours are effective-dated, so a day_of_week lookup picks an arbitrary version. Use business_hours_for_date(date) or the helpers in @/lib/business-hours/effective.",
        },
      ],
    },
  },
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/supabase-singleton',
              message:
                'Do not import Supabase singleton clients in client components or generic pages. Use server actions or route handlers with server-side helpers.',
            },
          ],
        },
      ],
    },
  },
]

