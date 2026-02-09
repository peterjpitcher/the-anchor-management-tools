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

  console.log('Initializing The Anchor Management Tools')
  console.log(`Environment: ${config.name}`)
  console.log(`App URL: ${config.app.url}`)
  console.log(`SMS: ${config.features.sms ? 'Enabled' : 'Disabled'}`)
  console.log(`Rate Limiting: ${config.features.rateLimiting ? 'Enabled' : 'Disabled'}`)
  console.log(`Background Jobs: ${config.features.backgroundJobs ? 'Enabled' : 'Disabled'}`)
  console.log('Application initialized successfully')
}
