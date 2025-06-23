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
    
    // In production, you could send logs to a logging service here
    // For now, we'll just use console logging
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

  error(message: string, context?: LogContext & { error?: Error }) {
    this.log('error', message, context);
    
    // Log the error stack trace if available
    if (context?.error?.stack) {
      console.error(context.error.stack);
    }
  }
}

// Export singleton instance
export const logger = new Logger();