# API Troubleshooting Guide

## Authentication Issues

### Problem: 401 Unauthorized Error

The API now supports two authentication methods:

1. **X-API-Key Header** (Recommended)
```javascript
fetch('https://management.orangejelly.co.uk/api/events', {
  headers: {
    'X-API-Key': 'anch_your_api_key_here'
  }
})
```

2. **Authorization Bearer Header**
```javascript
fetch('https://management.orangejelly.co.uk/api/events', {
  headers: {
    'Authorization': 'Bearer anch_your_api_key_here'
  }
})
```

### Verifying Your API Key

Run the verification script on the server:
```bash
npx tsx scripts/verify-api-key.ts anch_wzjjWLuMd5osCBUZA7YTAyIKagxI_oboVSXRyYiIHmg
```

This will check:
- If the key exists in the database
- If the key is active
- Current usage vs rate limit
- Test authentication

### CORS Configuration

The API now allows all origins (`Access-Control-Allow-Origin: *`) for public access. The following headers are allowed:
- `Content-Type`
- `Authorization`
- `X-API-Key`

### Common Issues and Solutions

#### 1. API Key Not Found
**Symptom**: 401 error with "Invalid or missing API key"

**Solutions**:
- Verify the API key exists in the database
- Check if the key is active (`is_active: true`)
- Ensure you're using the correct header format
- Make sure there are no extra spaces or characters

#### 2. CORS Errors
**Symptom**: Browser console shows CORS policy errors

**Solutions**:
- The API now sends `Access-Control-Allow-Origin: *`
- Ensure you're not sending custom headers beyond those allowed
- Check that OPTIONS preflight requests are working

#### 3. Rate Limiting
**Symptom**: 429 Too Many Requests error

**Solutions**:
- Default limit is 100 requests per hour per API key
- Check current usage with the verify script
- Request a higher rate limit if needed

## Testing the API

### Basic Test
```bash
# Test with curl
curl -H "X-API-Key: anch_wzjjWLuMd5osCBUZA7YTAyIKagxI_oboVSXRyYiIHmg" \
  https://management.orangejelly.co.uk/api/events

# Test with httpie
http https://management.orangejelly.co.uk/api/events \
  X-API-Key:anch_wzjjWLuMd5osCBUZA7YTAyIKagxI_oboVSXRyYiIHmg
```

### Browser Test
```javascript
// Open browser console and run:
fetch('https://management.orangejelly.co.uk/api/events', {
  headers: {
    'X-API-Key': 'anch_wzjjWLuMd5osCBUZA7YTAyIKagxI_oboVSXRyYiIHmg'
  }
})
.then(r => r.json())
.then(console.log)
.catch(console.error)
```

### Testing from the Anchor Website
```javascript
// Add to your website code:
class AnchorAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://management.orangejelly.co.uk/api';
  }

  async getEvents() {
    try {
      const response = await fetch(`${this.baseUrl}/events`, {
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }
}

// Usage
const api = new AnchorAPI('anch_wzjjWLuMd5osCBUZA7YTAyIKagxI_oboVSXRyYiIHmg');
api.getEvents().then(data => {
  console.log('Events:', data);
});
```

## API Key Management

### Creating a New API Key
```bash
# Generate a new key
npx tsx scripts/generate-api-key.ts

# Or use the UI at:
https://management.orangejelly.co.uk/settings/api-keys
```

### Activating an API Key
If your key is inactive, you need to activate it in the database:
1. Go to Supabase dashboard
2. Navigate to the `api_keys` table
3. Find your key by name
4. Set `is_active` to `true`

### Setting Permissions
Default permissions for new keys:
- `read:events`
- `read:menu`
- `read:business`

For booking creation, add:
- `create:bookings`

## Response Format

### Successful Response
```json
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "itemListElement": [
    {
      "@type": "Event",
      "id": "...",
      "name": "...",
      // ... event data
    }
  ],
  "meta": {
    "total": 10,
    "page": 1,
    "per_page": 20
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing API key"
  }
}
```

## Contact Support

If you continue to experience issues:
1. Check the server logs for detailed error messages
2. Run the verification script with your API key
3. Contact: api-support@theanchor.co.uk

Include in your support request:
- Your API key (first 10 characters only)
- The exact error message
- The request headers you're sending
- The endpoint you're trying to access