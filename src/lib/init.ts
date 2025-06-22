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
  
  // Skip some checks in development to avoid noise
  const isDev = process.env.NODE_ENV === 'development'
  
  if (!isDev) {
    console.log('🚀 Initializing The Anchor Management Tools...')
  }
  
  // Check environment variables
  try {
    checkEnvironment()
  } catch (error) {
    console.error('Failed to initialize application:', error)
    // Re-throw in production
    if (!isDev) {
      throw error
    }
  }
  
  // Log environment info
  if (!isDev) {
    console.log(`📍 Environment: ${config.name}`)
    console.log(`🔗 App URL: ${config.app.url}`)
    console.log(`📱 SMS: ${config.features.sms ? 'Enabled' : 'Disabled'}`)
    console.log(`🚦 Rate Limiting: ${config.features.rateLimiting ? 'Enabled' : 'Disabled'}`)
    console.log(`⚡ Background Jobs: ${config.features.backgroundJobs ? 'Enabled' : 'Disabled'}`)
    console.log(`🛡️  Error Tracking: ${config.features.errorTracking ? 'Enabled' : 'Disabled'}`)
  }
  
  // Set up global error handlers
  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (event) => {
      console.error('Unhandled promise rejection:', event.reason)
    })
  }
  
  if (!isDev) {
    console.log('✅ Application initialized successfully')
  }
}

// Auto-initialize on import in server context
if (typeof window === 'undefined') {
  initializeApp()
}