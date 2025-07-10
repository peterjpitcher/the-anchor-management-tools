export interface LogEntry {
  timestamp: number;
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  message: string;
  stack?: string;
}

export class ConsoleLogger {
  private logs: LogEntry[] = [];
  private maxLogs = 1000;
  private originalMethods: { [key: string]: Function } = {};
  
  constructor() {
    this.interceptConsole();
  }
  
  private interceptConsole() {
    const methods: Array<'log' | 'warn' | 'error' | 'info' | 'debug'> = ['log', 'warn', 'error', 'info', 'debug'];
    
    methods.forEach((method) => {
      this.originalMethods[method] = console[method];
      
      console[method] = (...args: unknown[]) => {
        // Call original method
        this.originalMethods[method].apply(console, args);
        
        // Capture log
        try {
          this.logs.push({
            timestamp: Date.now(),
            level: method,
            message: args.map(arg => {
              if (arg instanceof Error) {
                return `${arg.message}${arg.stack ? '\n' + arg.stack : ''}`;
              }
              return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg);
            }).join(' '),
            stack: method === 'error' && (args[0] as any)?.stack ? (args[0] as any).stack : undefined,
          });
          
          // Trim logs if too many
          if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
          }
        } catch (captureError) {
          // Fail silently to avoid breaking the app
        }
      };
    });
  }
  
  getLogs(): string {
    return this.logs.map(log => 
      `[${new Date(log.timestamp).toISOString()}] ${log.level.toUpperCase()}: ${log.message}${
        log.stack && !log.message.includes(log.stack) ? '\n' + log.stack : ''
      }`
    ).join('\n');
  }
  
  getLogsAsArray(): LogEntry[] {
    return [...this.logs];
  }
  
  clear() {
    this.logs = [];
  }
  
  destroy() {
    // Restore original console methods
    Object.keys(this.originalMethods).forEach((method) => {
      (console as any)[method] = this.originalMethods[method];
    });
  }
}