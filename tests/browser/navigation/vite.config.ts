import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../../..')
const stub = resolve(__dirname, 'stubs.tsx')
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'next/link', replacement: stub },
      { find: 'next/navigation', replacement: stub },
      { find: '@/contexts/PermissionContext', replacement: stub },
      { find: '@/hooks/useUnreadMessageCount', replacement: stub },
      { find: '@/hooks/useOutstandingCounts', replacement: stub },
      { find: './FohClockBand', replacement: stub },
      { find: '@', replacement: resolve(root, 'src') },
    ],
  },
  server: { host: '127.0.0.1', port: 4317, strictPort: true, fs: { allow: [root, resolve(root, 'node_modules')] } },
})
