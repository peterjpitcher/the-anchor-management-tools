import { NextRequest, NextResponse } from 'next/server';
import { GitHubClient } from '@/lib/bug-reporter/github-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, consoleLogs, networkLogs, screenshotDataUrl } = body;
    
    // Validate required fields
    if (!title || !description) {
      return NextResponse.json(
        { error: 'Title and description are required' },
        { status: 400 }
      );
    }
    
    // Get GitHub configuration from environment
    const githubToken = process.env.GITHUB_BUG_REPORTER_TOKEN;
    const githubOwner = process.env.GITHUB_OWNER || 'peterjpitcher';
    const githubRepo = process.env.GITHUB_REPO || 'the-anchor-management-tools';
    
    if (!githubToken) {
      console.error('GITHUB_BUG_REPORTER_TOKEN not configured');
      return NextResponse.json(
        { 
          error: 'Bug reporting is not configured',
          message: 'The GitHub token for bug reporting has not been set up. Please contact your administrator.',
          details: 'Missing environment variable: GITHUB_BUG_REPORTER_TOKEN'
        },
        { status: 500 }
      );
    }
    
    // Create GitHub client
    const github = new GitHubClient(githubOwner, githubRepo, githubToken);
    
    // Create issue with logs
    const issue = await github.createIssueWithLogs(
      title,
      description,
      consoleLogs || '',
      networkLogs || '',
      screenshotDataUrl
    );
    
    return NextResponse.json({
      success: true,
      issueNumber: issue.number,
      issueUrl: issue.html_url
    });
    
  } catch (error) {
    console.error('Failed to create bug report:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to create bug report',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}