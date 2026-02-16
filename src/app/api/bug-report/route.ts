import { NextRequest, NextResponse } from 'next/server';
import { GitHubClient } from '@/lib/bug-reporter/github-client';
import { createClient } from '@/lib/supabase/server';

const MAX_TEXT_FIELD_LENGTH = 50_000;
const MAX_SCREENSHOT_DATA_URL_LENGTH = 5_000_000;

function normalizeOptionalText(input: unknown): string {
  return typeof input === 'string' ? input : '';
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const title = normalizeOptionalText(body?.title).trim();
    const description = normalizeOptionalText(body?.description).trim();
    const consoleLogs = normalizeOptionalText(body?.consoleLogs);
    const networkLogs = normalizeOptionalText(body?.networkLogs);
    const screenshotDataUrl = normalizeOptionalText(body?.screenshotDataUrl);
    
    // Validate required fields
    if (!title || !description) {
      return NextResponse.json(
        { error: 'Title and description are required' },
        { status: 400 }
      );
    }

    if (title.length > 200 || description.length > MAX_TEXT_FIELD_LENGTH) {
      return NextResponse.json(
        { error: 'Bug report content exceeds allowed size' },
        { status: 400 }
      );
    }

    if (
      consoleLogs.length > MAX_TEXT_FIELD_LENGTH ||
      networkLogs.length > MAX_TEXT_FIELD_LENGTH ||
      screenshotDataUrl.length > MAX_SCREENSHOT_DATA_URL_LENGTH
    ) {
      return NextResponse.json(
        { error: 'Attached logs or screenshot are too large' },
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
      consoleLogs,
      networkLogs,
      screenshotDataUrl || undefined
    );
    
    return NextResponse.json({
      success: true,
      issueNumber: issue.number,
      issueUrl: issue.html_url
    });
    
  } catch (error) {
    console.error('Failed to create bug report:', error);
    
    return NextResponse.json(
      { error: 'Failed to create bug report' },
      { status: 500 }
    );
  }
}
