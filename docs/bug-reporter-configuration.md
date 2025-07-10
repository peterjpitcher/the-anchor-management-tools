# Bug Reporter Configuration Guide

## Issue: "Bug reporting is not configured" Error

The bug reporter feature requires a GitHub Personal Access Token to be configured in the production environment. Without this token, users will see a 500 error when trying to submit bug reports.

## Solution: Configure GitHub Token

### Step 1: Generate a GitHub Personal Access Token

1. Go to GitHub Settings: https://github.com/settings/tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Give your token a descriptive name (e.g., "Anchor Management Bug Reporter")
4. Set an expiration (recommend 90 days for security)
5. Select the following scopes:
   - `repo` (Full control of private repositories) OR
   - `public_repo` (Access public repositories only - if your bug reports repo is public)
6. Click "Generate token"
7. **IMPORTANT**: Copy the token immediately - you won't be able to see it again!

### Step 2: Add Token to Production Environment

For Vercel deployment:

1. Go to your Vercel project dashboard
2. Navigate to Settings → Environment Variables
3. Add the following environment variables:
   ```
   GITHUB_BUG_REPORTER_TOKEN=ghp_your_token_here
   GITHUB_OWNER=peterjpitcher
   GITHUB_REPO=the-anchor-management-tools
   ```
4. Make sure these are added for the "Production" environment
5. Redeploy your application for the changes to take effect

### Step 3: Verify Configuration

After deployment, test the bug reporter:
1. Go to any page in the application
2. Look for the bug report icon/button (usually in the corner)
3. Submit a test bug report
4. Check your GitHub repository's Issues tab to confirm it was created

## Security Best Practices

1. **Token Permissions**: Only grant the minimum required permissions
   - If your bug reports repo is public, use `public_repo` scope only
   - If private, you'll need the full `repo` scope

2. **Token Rotation**: Set a reminder to rotate the token before it expires
   - GitHub will send email reminders before expiration
   - Generate a new token and update Vercel before the old one expires

3. **Token Storage**: Never commit tokens to your repository
   - Always use environment variables
   - Add `GITHUB_BUG_REPORTER_TOKEN` to `.gitignore` if storing locally

## Alternative: Disable Bug Reporter (Temporary)

If you need to temporarily disable the bug reporter:

1. Remove or comment out the BugReporter component from your layout
2. Or set a feature flag environment variable to conditionally render it

## Troubleshooting

### Still getting "not configured" error after adding token:
1. Verify the token is in the Production environment (not just Development)
2. Check for typos in the environment variable name
3. Ensure the deployment has completed successfully
4. Check Vercel function logs for any errors

### GitHub API errors:
1. Verify the token has the correct permissions
2. Check if the repository exists and is accessible
3. Ensure the GITHUB_OWNER and GITHUB_REPO values are correct
4. Check GitHub API rate limits (5,000 requests/hour for authenticated requests)

### Token expired:
1. Generate a new token following Step 1
2. Update the environment variable in Vercel
3. Redeploy the application

## Environment Variables Reference

```bash
# Required for bug reporter
GITHUB_BUG_REPORTER_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx  # Your GitHub PAT
GITHUB_OWNER=peterjpitcher                          # GitHub username or org
GITHUB_REPO=the-anchor-management-tools             # Repository name

# Optional - for screenshot uploads (not currently implemented)
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_UPLOAD_PRESET=bug-reports
```