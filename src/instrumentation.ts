import { initializeApp } from './lib/init'

export async function register() {
  // Initialize application
  initializeApp()
  
  // Initialize Sentry if configured
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}