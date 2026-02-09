import { env, isSmsEnabled, skipTwilioSignatureValidation } from '@/lib/env'

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
  const appUrl = env.NEXT_PUBLIC_APP_URL || ''
  const isStagingUrl = appUrl.includes('staging')

  if (process.env.NODE_ENV !== 'production') {
    return 'development'
  }

  return isStagingUrl ? 'staging' : 'production'
}

const environment = getEnvironment()
const isDevelopmentEnv = environment === 'development'
const isStagingEnv = environment === 'staging'
const isProductionEnv = environment === 'production'

const defaultCorsOrigins = [env.NEXT_PUBLIC_APP_URL]

export const config: EnvironmentConfig = {
  name: environment,
  isDevelopment: isDevelopmentEnv,
  isStaging: isStagingEnv,
  isProduction: isProductionEnv,
  app: {
    url: env.NEXT_PUBLIC_APP_URL,
    name: isDevelopmentEnv
      ? 'The Anchor Management Tools (Dev)'
      : isStagingEnv
        ? 'The Anchor Management Tools (Staging)'
        : 'The Anchor Management Tools',
    contactPhone: env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707'
  },
  features: {
    sms: isSmsEnabled(),
    rateLimiting: !isDevelopmentEnv,
    backgroundJobs: true,
    webhookValidation: !skipTwilioSignatureValidation()
  },
  security: {
    requireHttps: isProductionEnv || isStagingEnv,
    corsOrigins: defaultCorsOrigins,
    cspDirectives: {
      'default-src': ["'self'"],
      'script-src': isDevelopmentEnv ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"] : ["'self'", "'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'https:'],
      'connect-src': ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co']
    }
  },
  monitoring: {
    logLevel: isDevelopmentEnv ? 'debug' : isStagingEnv ? 'info' : 'warn',
    enableProfiling: isDevelopmentEnv
  }
}

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
  const configuredLevel = levels.indexOf(config.monitoring.logLevel)
  const messageLevel = levels.indexOf(level)
  return messageLevel >= configuredLevel
}

export const isDevelopment = config.isDevelopment
export const isStaging = config.isStaging
export const isProduction = config.isProduction
export const features = config.features
export const environmentName = config.name
