type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  userId?: string;
  action?: string;
  metadata?: Record<string, any>;
  error?: Error;
}

class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development';

  private serializeForJson(value: unknown, seen = new WeakSet<object>()): unknown {
    if (value instanceof Error) {
      const extraFields = Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, this.serializeForJson(entry, seen)])
      );

      return {
        name: value.name,
        message: value.message,
        ...extraFields,
        ...(this.isDevelopment && value.stack ? { stack: value.stack } : {}),
      };
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (typeof value === 'function') {
      return `[Function ${value.name || 'anonymous'}]`;
    }

    if (typeof value === 'symbol') {
      return value.toString();
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((entry) => this.serializeForJson(entry, seen));
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, this.serializeForJson(entry, seen)])
    );
  }

  private stringifyContext(context: LogContext): string {
    try {
      return JSON.stringify(this.serializeForJson(context));
    } catch {
      return JSON.stringify({ message: 'Failed to serialize log context' });
    }
  }
  
  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${this.stringifyContext(context)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
  }

  private log(level: LogLevel, message: string, context?: LogContext) {
    const formattedMessage = this.formatMessage(level, message, context);
    
    // Console output with color coding in development
    if (this.isDevelopment || level === 'error') {
      switch (level) {
        case 'debug':
          // eslint-disable-next-line no-console
          console.debug(`\x1b[36m${formattedMessage}\x1b[0m`); // Cyan
          break;
        case 'info':
          // eslint-disable-next-line no-console
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
  }
}

// Export singleton instance
export const logger = new Logger();
