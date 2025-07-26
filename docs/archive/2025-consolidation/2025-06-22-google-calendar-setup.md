# Google Calendar Integration Setup

This guide explains how to set up Google Calendar integration for automatic event synchronization with private bookings.

## Overview

The application supports two authentication methods for Google Calendar:
1. **Service Account** (recommended) - Server-to-server authentication
2. **OAuth2** - User-based authentication with refresh tokens

## Service Account Setup (Recommended)

### 1. Create a Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Calendar API:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Calendar API"
   - Click on it and press "Enable"
4. Create a Service Account:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "Service Account"
   - Fill in the service account details
   - Grant it the "Project > Editor" role
   - Click "Done"

### 2. Generate Service Account Key

1. In the credentials page, click on your service account
2. Go to the "Keys" tab
3. Click "Add Key" > "Create new key"
4. Choose "JSON" format
5. Download the key file

### 3. Format the Key for Environment Variable

The downloaded JSON key needs to be formatted for use in the `.env.local` file:

```bash
# Use the provided utility script
tsx scripts/format-google-service-account.ts path/to/downloaded-key.json
```

This will output a properly formatted `GOOGLE_SERVICE_ACCOUNT_KEY` line that you can copy to your `.env.local` file.

### 4. Grant Calendar Access

1. Share your Google Calendar with the service account:
   - Open Google Calendar
   - Click on the three dots next to your calendar name
   - Select "Settings and sharing"
   - Under "Share with specific people", add the service account email (found in the JSON key as `client_email`)
   - Grant "Make changes to events" permission

### 5. Configure Environment Variables

Add the following to your `.env.local`:

```env
# The formatted service account key from step 3
GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}'

# Your Google Calendar ID (usually your email or a calendar ID)
GOOGLE_CALENDAR_ID=your-email@gmail.com
# Or for a specific calendar:
# GOOGLE_CALENDAR_ID=abc123@group.calendar.google.com
```

## OAuth2 Setup (Alternative)

If you prefer using OAuth2 with user authentication:

### 1. Create OAuth2 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Go to "APIs & Services" > "Credentials"
3. Click "Create Credentials" > "OAuth client ID"
4. Choose "Web application"
5. Add authorized redirect URI: `http://localhost:3000/api/auth/google/callback`
6. Save the client ID and client secret

### 2. Get Refresh Token

You'll need to implement an OAuth2 flow to get a refresh token. This is more complex and requires user interaction.

### 3. Configure Environment Variables

```env
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URL=http://localhost:3000/api/auth/google/callback
GOOGLE_REFRESH_TOKEN=your_refresh_token
GOOGLE_CALENDAR_ID=your-email@gmail.com
```

## Troubleshooting

### Common JSON Parsing Errors

If you encounter "Bad control character in string literal" errors:

1. **Unescaped newlines**: The private key contains newline characters that must be escaped as `\n`
2. **Multi-line JSON**: The entire JSON must be on a single line in the environment variable
3. **Solution**: Use the `format-google-service-account.ts` script to properly format the key

### Authentication Errors

1. **"Permission denied"**: Ensure the service account has access to the calendar (see step 4 above)
2. **"Calendar not found"**: Check that `GOOGLE_CALENDAR_ID` is correct
3. **"Invalid grant"**: For OAuth2, the refresh token may have expired

### Testing the Integration

1. Create a private booking in the application
2. Check your Google Calendar for the event
3. Check the console logs for any error messages

## Security Notes

- Never commit the service account key or OAuth credentials to version control
- The service account key grants full access to the calendars it has permission for
- Consider using separate service accounts for different environments (dev, staging, prod)
- Regularly rotate service account keys for security