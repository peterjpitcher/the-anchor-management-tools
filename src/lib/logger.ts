import * as Sentry from '@sentry/nextjs';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  userId?: string;
  action?: string;
  metadata?: Record<string, any>;
  error?: Error;
}

class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development';
  
  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
  }

  private log(level: LogLevel, message: string, context?: LogContext) {
    const formattedMessage = this.formatMessage(level, message, context);
    
    // Console output with color coding in development
    if (this.isDevelopment || level === 'error') {
      switch (level) {
        case 'debug':
          console.debug(`\x1b[36m${formattedMessage}\x1b[0m`); // Cyan
          break;
        case 'info':
          console.info(`\x1b[32m${formattedMessage}\x1b[0m`); // Green
          break;
        case 'warn':
          console.warn(`\x1b[33m${formattedMessage}\x1b[0m`); // Yellow
          break;
        case 'error':
          console.error(`\x1b[31m${formattedMessage}\x1b[0m`); // Red
          break;
      }
    }

    // Send to Sentry for production monitoring
    if (!this.isDevelopment) {
      switch (level) {
        case 'error':
          if (context?.error) {
            Sentry.captureException(context.error, {
              extra: { message, ...context }
            });
          } else {
            Sentry.captureMessage(message, 'error');
          }
          break;
        case 'warn':
          Sentry.captureMessage(message, 'warning');
          break;
        case 'info':
          // Only send important info messages to Sentry
          if (context?.action) {
            Sentry.addBreadcrumb({
              message,
              level: 'info',
              data: context
            });
          }
          break;
      }
    }
  }

  debug(message: string, context?: LogContext) {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext) {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext) {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext) {
    this.log('error', message, context);
  }

  // Specialized logging methods
  
  logApiCall(endpoint: string, method: string, statusCode: number, duration: number) {
    const level: LogLevel = statusCode >= 400 ? 'error' : 'info';
    this.log(level, `API ${method} ${endpoint} - ${statusCode} (${duration}ms)`, {
      action: 'api_call',
      metadata: { endpoint, method, statusCode, duration }
    });
  }

  logDatabaseQuery(query: string, duration: number, error?: Error) {
    if (error) {
      this.error(`Database query failed: ${query}`, {
        action: 'db_query',
        error,
        metadata: { query, duration }
      });
    } else {
      this.debug(`Database query completed in ${duration}ms`, {
        action: 'db_query',
        metadata: { query, duration }
      });
    }
  }

  logSmsEvent(to: string, status: 'sent' | 'failed' | 'delivered', error?: string) {
    const level: LogLevel = status === 'failed' ? 'error' : 'info';
    this.log(level, `SMS ${status} to ${to.substring(0, 8)}****`, {
      action: 'sms_event',
      metadata: { to: to.substring(0, 8) + '****', status, error }
    });
  }

  logAuthEvent(userId: string, event: 'login' | 'logout' | 'signup' | 'password_reset') {
    this.info(`Auth event: ${event}`, {
      userId,
      action: `auth_${event}`,
      metadata: { event }
    });
  }

  logSecurityEvent(event: string, details: Record<string, any>) {
    this.warn(`Security event: ${event}`, {
      action: 'security_event',
      metadata: details
    });
  }

  // Performance logging
  startTimer(label: string): () => void {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.debug(`Timer [${label}]: ${duration}ms`, {
        action: 'performance',
        metadata: { label, duration }
      });
    };
  }
}

// Export singleton instance
export const logger = new Logger();

// Export types for use in other files
export type { LogLevel, LogContext };