/**
 * Application initialization
 * Runs environment checks and sets up monitoring
 */

import { checkEnvironment } from './env-validation'
import { config } from '@/config/environment'

// Only run initialization once
let initialized = false

export function initializeApp() {
  if (initialized) return
  initialized = true
  
  checkEnvironment()

  if (process.env.NODE_ENV !== 'production') {
    return
  }

  console.warn('Initializing The Anchor Management Tools')
  console.warn(`Environment: ${config.name}`)
  console.warn(`App URL: ${config.app.url}`)
  console.warn(`SMS: ${config.features.sms ? 'Enabled' : 'Disabled'}`)
  console.warn(`Rate Limiting: ${config.features.rateLimiting ? 'Enabled' : 'Disabled'}`)
  console.warn(`Background Jobs: ${config.features.backgroundJobs ? 'Enabled' : 'Disabled'}`)
  console.warn('Application initialized successfully')
}
