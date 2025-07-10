export interface NetworkRequest {
  url: string;
  method: string;
  status: number;
  duration: number;
  timestamp: number;
  error?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
}

export class NetworkLogger {
  private requests: NetworkRequest[] = [];
  private maxRequests = 500;
  private originalFetch: typeof fetch;
  private originalXHROpen: typeof XMLHttpRequest.prototype.open;
  private originalXHRSend: typeof XMLHttpRequest.prototype.send;
  
  constructor() {
    this.originalFetch = window.fetch.bind(window);
    this.originalXHROpen = XMLHttpRequest.prototype.open;
    this.originalXHRSend = XMLHttpRequest.prototype.send;
    this.interceptFetch();
    this.interceptXHR();
  }
  
  private interceptFetch() {
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const [input, init] = args;
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      const method = init?.method || 'GET';
      const startTime = Date.now();
      
      try {
        const response = await this.originalFetch(...args);
        
        // Clone response to read it without consuming
        const clonedResponse = response.clone();
        
        this.logRequest({
          url,
          method,
          status: response.status,
          duration: Date.now() - startTime,
          timestamp: startTime,
          requestHeaders: init?.headers as Record<string, string>,
          responseHeaders: Object.fromEntries(response.headers.entries()),
        });
        
        return response;
      } catch (error) {
        this.logRequest({
          url,
          method,
          status: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
          duration: Date.now() - startTime,
          timestamp: startTime,
        });
        throw error;
      }
    };
  }
  
  private interceptXHR() {
    const self = this;
    
    XMLHttpRequest.prototype.open = function(
      method: string,
      url: string,
      async?: boolean,
      username?: string | null,
      password?: string | null
    ) {
      (this as any)._method = method;
      (this as any)._url = url;
      (this as any)._startTime = Date.now();
      (this as any)._requestHeaders = {};
      
      // Store reference to setRequestHeader to capture headers
      const originalSetRequestHeader = this.setRequestHeader;
      this.setRequestHeader = function(name: string, value: string) {
        (this as any)._requestHeaders[name] = value;
        return originalSetRequestHeader.apply(this, [name, value]);
      };
      
      return self.originalXHROpen.call(this, method, url, async ?? true, username, password);
    };
    
    XMLHttpRequest.prototype.send = function(body?: Document | XMLHttpRequestBodyInit | null) {
      const xhr = this;
      
      xhr.addEventListener('loadend', function() {
        self.logRequest({
          url: (xhr as any)._url,
          method: (xhr as any)._method,
          status: xhr.status,
          duration: Date.now() - (xhr as any)._startTime,
          timestamp: (xhr as any)._startTime,
          requestHeaders: (xhr as any)._requestHeaders,
          error: xhr.status === 0 ? 'Network error' : undefined,
        });
      });
      
      return self.originalXHRSend.call(this, body);
    };
  }
  
  private logRequest(request: NetworkRequest) {
    this.requests.push(request);
    
    // Trim if too many
    if (this.requests.length > this.maxRequests) {
      this.requests = this.requests.slice(-this.maxRequests);
    }
  }
  
  getLogs(): string {
    return this.requests.map(req => {
      const timestamp = new Date(req.timestamp).toISOString();
      const status = req.error ? `ERROR: ${req.error}` : `${req.status}`;
      return `[${timestamp}] ${req.method} ${req.url} - ${status} (${req.duration}ms)`;
    }).join('\n');
  }
  
  getRequestsAsArray(): NetworkRequest[] {
    return [...this.requests];
  }
  
  clear() {
    this.requests = [];
  }
  
  destroy() {
    // Restore original methods
    window.fetch = this.originalFetch;
    XMLHttpRequest.prototype.open = this.originalXHROpen;
    XMLHttpRequest.prototype.send = this.originalXHRSend;
  }
}