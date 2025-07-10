interface CreateIssueParams {
  title: string;
  body: string;
  labels?: string[];
}

interface CreateCommentParams {
  issueNumber: number;
  body: string;
}

export class GitHubClient {
  private readonly MAX_COMMENT_SIZE = 65536;
  private readonly RESERVED_CHARS = 1000;
  
  constructor(
    private owner: string,
    private repo: string,
    private token: string
  ) {}
  
  async createIssue(params: CreateIssueParams) {
    const response = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${this.token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        title: params.title,
        body: params.body,
        labels: params.labels || ['bug', 'auto-reported']
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create issue: ${error.message || response.statusText}`);
    }
    
    return response.json();
  }
  
  async createComment(params: CreateCommentParams) {
    const response = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/issues/${params.issueNumber}/comments`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${this.token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify({
          body: params.body
        })
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create comment: ${error.message || response.statusText}`);
    }
    
    return response.json();
  }
  
  batchLogs(logs: string): string[] {
    const maxSize = this.MAX_COMMENT_SIZE - this.RESERVED_CHARS;
    const batches: string[] = [];
    
    // Split by lines to avoid breaking in middle of log entry
    const lines = logs.split('\n');
    let currentBatch = '';
    
    for (const line of lines) {
      // Check if adding this line would exceed the limit
      if (currentBatch.length + line.length + 1 > maxSize) {
        if (currentBatch) {
          batches.push(currentBatch);
        }
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
  
  async createIssueWithLogs(
    title: string,
    body: string,
    consoleLogs: string,
    networkLogs: string,
    screenshotDataUrl?: string
  ) {
    // Format the main issue body
    let issueBody = `## Bug Report\n\n${body}\n\n`;
    
    // Add screenshot if provided (as base64 in markdown)
    if (screenshotDataUrl) {
      issueBody += `## Screenshot\n\n![Bug Screenshot](${screenshotDataUrl})\n\n`;
    }
    
    // Add environment info
    issueBody += `## Environment\n\n`;
    issueBody += `- **URL**: ${window.location.href}\n`;
    issueBody += `- **User Agent**: ${navigator.userAgent}\n`;
    issueBody += `- **Timestamp**: ${new Date().toISOString()}\n`;
    issueBody += `- **Screen Resolution**: ${window.screen.width}x${window.screen.height}\n`;
    issueBody += `- **Window Size**: ${window.innerWidth}x${window.innerHeight}\n\n`;
    
    // Create the issue
    const issue = await this.createIssue({
      title,
      body: issueBody,
      labels: ['bug', 'auto-reported']
    });
    
    // Batch and create comments for console logs
    if (consoleLogs.trim()) {
      const consoleBatches = this.batchLogs(consoleLogs);
      for (let i = 0; i < consoleBatches.length; i++) {
        await this.createComment({
          issueNumber: issue.number,
          body: `## Console Logs (Part ${i + 1}/${consoleBatches.length})\n\n\`\`\`\n${consoleBatches[i]}\n\`\`\``
        });
        
        // Add delay to avoid rate limiting
        if (i < consoleBatches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    // Batch and create comments for network logs
    if (networkLogs.trim()) {
      const networkBatches = this.batchLogs(networkLogs);
      for (let i = 0; i < networkBatches.length; i++) {
        await this.createComment({
          issueNumber: issue.number,
          body: `## Network Logs (Part ${i + 1}/${networkBatches.length})\n\n\`\`\`\n${networkBatches[i]}\n\`\`\``
        });
        
        // Add delay to avoid rate limiting
        if (i < networkBatches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    return issue;
  }
}