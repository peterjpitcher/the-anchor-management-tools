/**
 * Environment configuration
 * Centralizes environment-specific settings and provides type-safe access
 */

export type Environment = 'development' | 'staging' | 'production'

export interface EnvironmentConfig {
  name: Environment
  isDevelopment: boolean
  isStaging: boolean
  isProduction: boolean
  app: {
    url: string
    name: string
    contactPhone: string
  }
  features: {
    sms: boolean
    rateLimiting: boolean
    backgroundJobs: boolean
    webhookValidation: boolean
    errorTracking: boolean
  }
  security: {
    requireHttps: boolean
    corsOrigins: string[]
    cspDirectives: Record<string, string[]>
  }
  monitoring: {
    logLevel: 'debug' | 'info' | 'warn' | 'error'
    enableProfiling: boolean
  }
}

function getEnvironment(): Environment {
  // Check Vercel environment variable first
  const vercelEnv = process.env.VERCEL_ENV
  if (vercelEnv === 'production') {
    // Check if this is staging based on URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    if (appUrl.includes('staging')) {
      return 'staging'
    }
    return 'production'
  }
  
  // Check NODE_ENV
  const nodeEnv = process.env.NODE_ENV
  if (nodeEnv === 'production') {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    if (appUrl.includes('staging')) {
      return 'staging'
    }
    return 'production'
  }
  
  return 'development'
}

const environment = getEnvironment()

// Environment-specific configurations
const configs: Record<Environment, EnvironmentConfig> = {
  development: {
    name: 'development',
    isDevelopment: true,
    isStaging: false,
    isProduction: false,
    app: {
      url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      name: 'The Anchor Management Tools (Dev)',
      contactPhone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707'
    },
    features: {
      sms: !!process.env.TWILIO_ACCOUNT_SID,
      rateLimiting: false, // Disabled in dev for easier testing
      backgroundJobs: true,
      webhookValidation: false, // Skip in dev
      errorTracking: false
    },
    security: {
      requireHttps: false,
      corsOrigins: ['http://localhost:3000'],
      cspDirectives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'https:'],
        'connect-src': ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co']
      }
    },
    monitoring: {
      logLevel: 'debug',
      enableProfiling: true
    }
  },
  
  staging: {
    name: 'staging',
    isDevelopment: false,
    isStaging: true,
    isProduction: false,
    app: {
      url: process.env.NEXT_PUBLIC_APP_URL || 'https://staging.management.orangejelly.co.uk',
      name: 'The Anchor Management Tools (Staging)',
      contactPhone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707'
    },
    features: {
      sms: !!process.env.TWILIO_ACCOUNT_SID,
      rateLimiting: true,
      backgroundJobs: true,
      webhookValidation: process.env.SKIP_TWILIO_SIGNATURE_VALIDATION !== 'true',
      errorTracking: !!process.env.NEXT_PUBLIC_SENTRY_DSN
    },
    security: {
      requireHttps: true,
      corsOrigins: ['https://staging.management.orangejelly.co.uk'],
      cspDirectives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'https:'],
        'connect-src': ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co', 'https://*.sentry.io']
      }
    },
    monitoring: {
      logLevel: 'info',
      enableProfiling: false
    }
  },
  
  production: {
    name: 'production',
    isDevelopment: false,
    isStaging: false,
    isProduction: true,
    app: {
      url: process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk',
      name: 'The Anchor Management Tools',
      contactPhone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707'
    },
    features: {
      sms: !!process.env.TWILIO_ACCOUNT_SID,
      rateLimiting: true,
      backgroundJobs: true,
      webhookValidation: true, // Always validate in production
      errorTracking: !!process.env.NEXT_PUBLIC_SENTRY_DSN
    },
    security: {
      requireHttps: true,
      corsOrigins: ['https://management.orangejelly.co.uk'],
      cspDirectives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"], // Required for Tailwind
        'img-src': ["'self'", 'data:', 'https:'],
        'connect-src': ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co', 'https://*.sentry.io']
      }
    },
    monitoring: {
      logLevel: 'warn',
      enableProfiling: false
    }
  }
}

// Export the current environment config
export const config = configs[environment]

// Helper functions
export function isFeatureEnabled(feature: keyof EnvironmentConfig['features']): boolean {
  return config.features[feature]
}

export function getAppUrl(path: string = ''): string {
  const baseUrl = config.app.url.replace(/\/$/, '')
  const cleanPath = path.replace(/^\//, '')
  return cleanPath ? `${baseUrl}/${cleanPath}` : baseUrl
}

export function shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
  const levels = ['debug', 'info', 'warn', 'error']
  const configLevel = levels.indexOf(config.monitoring.logLevel)
  const messageLevel = levels.indexOf(level)
  return messageLevel >= configLevel
}

// Environment checks
export const isDevelopment = config.isDevelopment
export const isStaging = config.isStaging
export const isProduction = config.isProduction

// Feature flags
export const features = config.features

// Export environment name
export const environmentName = config.name