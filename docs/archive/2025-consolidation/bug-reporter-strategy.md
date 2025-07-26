# Bug Reporter Strategy

## Overview
This document outlines the strategy for implementing a comprehensive bug reporter that integrates with GitHub Issues API, handling screenshots, console logs, and network logs efficiently.

## GitHub API Constraints (as of 2025)

### Character Limits
- **Issue/Comment Body**: Maximum 65,536 characters (64KB)
- **Issue Title**: Maximum 256 characters

### Rate Limits
- **Authenticated**: 5,000 requests/hour
- **GitHub Apps**: 15,000 requests/hour (for Enterprise Cloud)

### File Attachments
- **Not Supported**: GitHub API v3 doesn't support direct file uploads to issues
- **Workaround Required**: Must use external hosting or repository-based storage

## Implementation Strategy

### 1. Screenshot Handling

#### Option A: Cloudinary Integration (Recommended)
```typescript
// Upload to Cloudinary and get URL
const uploadScreenshot = async (screenshotBlob: Blob) => {
  const formData = new FormData();
  formData.append('file', screenshotBlob);
  formData.append('upload_preset', 'bug-reports');
  
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: 'POST', body: formData }
  );
  
  const data = await response.json();
  return data.secure_url;
};
```

#### Option B: Repository Storage
```typescript
// Create a dedicated repository for bug report attachments
// Use GitHub Contents API to upload images
const uploadToRepo = async (base64Image: string, filename: string) => {
  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${ATTACHMENTS_REPO}/contents/bug-reports/${filename}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Add bug report screenshot: ${filename}`,
        content: base64Image,
      })
    }
  );
  
  const data = await response.json();
  return data.content.download_url;
};
```

### 2. Console Log Capture

```typescript
interface LogEntry {
  timestamp: number;
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  message: string;
  stack?: string;
}

class ConsoleLogger {
  private logs: LogEntry[] = [];
  private maxLogs = 1000; // Prevent memory issues
  
  constructor() {
    this.interceptConsole();
  }
  
  private interceptConsole() {
    const originalMethods = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
      debug: console.debug,
    };
    
    Object.keys(originalMethods).forEach((method) => {
      console[method] = (...args) => {
        // Call original method
        originalMethods[method].apply(console, args);
        
        // Capture log
        this.logs.push({
          timestamp: Date.now(),
          level: method as any,
          message: args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
          ).join(' '),
          stack: method === 'error' && args[0]?.stack ? args[0].stack : undefined,
        });
        
        // Trim logs if too many
        if (this.logs.length > this.maxLogs) {
          this.logs = this.logs.slice(-this.maxLogs);
        }
      };
    });
  }
  
  getLogs(): string {
    return this.logs.map(log => 
      `[${new Date(log.timestamp).toISOString()}] ${log.level.toUpperCase()}: ${log.message}${
        log.stack ? '\n' + log.stack : ''
      }`
    ).join('\n');
  }
}
```

### 3. Network Log Capture

```typescript
class NetworkLogger {
  private requests: NetworkRequest[] = [];
  
  constructor() {
    this.interceptFetch();
    this.interceptXHR();
  }
  
  private interceptFetch() {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const [url, options] = args;
      const startTime = Date.now();
      
      try {
        const response = await originalFetch(...args);
        this.logRequest({
          url: url.toString(),
          method: options?.method || 'GET',
          status: response.status,
          duration: Date.now() - startTime,
          timestamp: startTime,
        });
        return response;
      } catch (error) {
        this.logRequest({
          url: url.toString(),
          method: options?.method || 'GET',
          status: 0,
          error: error.message,
          duration: Date.now() - startTime,
          timestamp: startTime,
        });
        throw error;
      }
    };
  }
  
  // Similar for XMLHttpRequest...
}
```

### 4. Log Batching Strategy

```typescript
class GitHubIssueBatcher {
  private readonly MAX_COMMENT_SIZE = 65536;
  private readonly RESERVED_CHARS = 1000; // For markdown formatting
  
  async createIssueWithLogs(
    title: string,
    body: string,
    logs: string,
    screenshotUrl?: string
  ) {
    // Main issue body
    const issueBody = this.formatIssueBody(body, screenshotUrl);
    
    // Create issue
    const issue = await this.createIssue(title, issueBody);
    
    // Batch logs into comments
    const logBatches = this.batchLogs(logs);
    
    // Create comments for each batch
    for (let i = 0; i < logBatches.length; i++) {
      await this.createComment(
        issue.number,
        `## Console Logs (Part ${i + 1}/${logBatches.length})\n\n\`\`\`\n${logBatches[i]}\n\`\`\``
      );
      
      // Rate limit consideration - add delay between comments
      if (i < logBatches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return issue;
  }
  
  private batchLogs(logs: string): string[] {
    const maxSize = this.MAX_COMMENT_SIZE - this.RESERVED_CHARS;
    const batches: string[] = [];
    
    // Split by lines to avoid breaking in middle of log entry
    const lines = logs.split('\n');
    let currentBatch = '';
    
    for (const line of lines) {
      if (currentBatch.length + line.length + 1 > maxSize) {
        batches.push(currentBatch);
        currentBatch = line;
      } else {
        currentBatch += (currentBatch ? '\n' : '') + line;
      }
    }
    
    if (currentBatch) {
      batches.push(currentBatch);
    }
    
    return batches;
  }
  
  private formatIssueBody(description: string, screenshotUrl?: string): string {
    let body = `## Bug Report\n\n${description}\n\n`;
    
    if (screenshotUrl) {
      body += `## Screenshot\n\n![Bug Screenshot](${screenshotUrl})\n\n`;
    }
    
    body += `## Environment\n\n`;
    body += `- URL: ${window.location.href}\n`;
    body += `- User Agent: ${navigator.userAgent}\n`;
    body += `- Timestamp: ${new Date().toISOString()}\n`;
    body += `- Screen Resolution: ${window.screen.width}x${window.screen.height}\n`;
    
    return body;
  }
}
```

### 5. Complete Bug Reporter Component

```typescript
interface BugReporterProps {
  githubToken: string;
  githubOwner: string;
  githubRepo: string;
  cloudinaryCloudName?: string;
  cloudinaryUploadPreset?: string;
}

export function BugReporter({
  githubToken,
  githubOwner,
  githubRepo,
  cloudinaryCloudName,
  cloudinaryUploadPreset,
}: BugReporterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [includeLogs, setIncludeLogs] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const consoleLogger = useRef(new ConsoleLogger());
  const networkLogger = useRef(new NetworkLogger());
  
  const handleSubmit = async () => {
    setIsSubmitting(true);
    
    try {
      let screenshotUrl: string | undefined;
      
      // Capture and upload screenshot if requested
      if (includeScreenshot) {
        const screenshot = await captureScreenshot();
        if (cloudinaryCloudName && cloudinaryUploadPreset) {
          screenshotUrl = await uploadToCloudinary(
            screenshot,
            cloudinaryCloudName,
            cloudinaryUploadPreset
          );
        } else {
          // Fallback: embed as base64 (not recommended for large images)
          screenshotUrl = `data:image/png;base64,${screenshot}`;
        }
      }
      
      // Get logs
      const consoleLogs = includeLogs ? consoleLogger.current.getLogs() : '';
      const networkLogs = includeLogs ? networkLogger.current.getLogs() : '';
      const combinedLogs = `=== CONSOLE LOGS ===\n${consoleLogs}\n\n=== NETWORK LOGS ===\n${networkLogs}`;
      
      // Create issue with batched logs
      const batcher = new GitHubIssueBatcher(githubToken, githubOwner, githubRepo);
      const issue = await batcher.createIssueWithLogs(
        title,
        description,
        combinedLogs,
        screenshotUrl
      );
      
      // Success feedback
      alert(`Bug report created successfully! Issue #${issue.number}`);
      setIsOpen(false);
      resetForm();
      
    } catch (error) {
      console.error('Failed to submit bug report:', error);
      alert('Failed to submit bug report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // ... rest of the component
}
```

## Security Considerations

1. **GitHub Token**: Should be a limited-scope token with only `repo:public_repo` or specific repository access
2. **CORS**: May need a proxy server for GitHub API calls from browser
3. **Rate Limiting**: Implement client-side rate limiting to prevent abuse
4. **Data Sanitization**: Sanitize all user input before sending to GitHub

## Implementation Steps

1. **Phase 1**: Basic bug reporter with text-only submission
2. **Phase 2**: Add console log capture and batching
3. **Phase 3**: Integrate screenshot functionality with Cloudinary
4. **Phase 4**: Add network log capture
5. **Phase 5**: Implement error boundary integration

## Testing Scenarios

1. **Small logs**: Ensure single comment is created
2. **Large logs**: Verify proper batching into multiple comments
3. **Screenshot upload**: Test with various image sizes
4. **Rate limiting**: Test with rapid submissions
5. **Error scenarios**: Network failures, API errors, etc.