# The Anchor API Documentation Index

Welcome to The Anchor's API documentation. This index provides quick access to all API-related documentation.

## 📚 Documentation Structure

### 1. **[Public API Documentation](./api-public-documentation.md)**
Complete reference for The Anchor's public API, including:
- Authentication setup
- All available endpoints
- Request/response formats
- Rate limiting details
- Webhook configuration
- SDK examples

### 2. **[Quick Reference Guide](./api-quick-reference.md)**
A concise cheat sheet for developers:
- Common endpoints at a glance
- Query parameters reference
- Error codes
- Quick code examples

### 3. **[Integration Guide](./api-integration-guide.md)**
Practical implementation examples:
- WordPress plugin development
- React/Next.js integration
- Mobile app development (React Native, Flutter)
- SEO best practices
- Performance optimization
- Error handling strategies

### 4. **[Initial Planning Document](./api-events-external.md)**
Original requirements and planning notes

## 🚀 Getting Started

1. **Get Your API Key**: Contact The Anchor management team
2. **Review Authentication**: See [Authentication section](./api-public-documentation.md#authentication)
3. **Test Your Setup**: 
   ```bash
   curl -H "X-API-Key: your-key" https://management.orangejelly.co.uk/api/events
   ```

## 🔑 Key Features

- **Schema.org Compliance**: All responses use structured data for optimal SEO
- **Comprehensive Event Data**: Full event details including performers, pricing, and images
- **Menu Integration**: Complete menu data with dietary information
- **Real-time Availability**: Check event capacity in real-time
- **Booking Creation**: Create bookings directly through the API
- **Webhook Support**: Get notified of changes in real-time

## 📊 API Endpoints Overview

### Events
- `GET /api/events` - List all events
- `GET /api/events/{id}` - Get single event
- `GET /api/events/today` - Today's events
- `GET /api/events/{id}/check-availability` - Check availability
- `GET /api/event-categories` - List categories

### Menu
- `GET /api/menu` - Full menu
- `GET /api/menu/specials` - Daily specials
- `GET /api/menu/dietary/{type}` - Dietary-specific items

### Business Information
- `GET /api/business/hours` - Opening hours
- `GET /api/business/amenities` - Venue amenities

### Bookings (Requires Permission)
- `POST /api/bookings` - Create booking

## 🛠️ Development Tools

### Generate API Key
```bash
npx tsx scripts/generate-api-key.ts
```

### API Key Management UI
Available at: `/settings/api-keys` (Super Admin only)

## 📈 Rate Limits

- Default: 100 requests/hour per API key
- Headers included in all responses:
  - `X-RateLimit-Limit`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset`

## 🔐 Security Notes

- Never expose API keys in client-side code
- Use server-side proxy for web applications
- Rotate keys periodically
- Monitor usage for anomalies

## 📞 Support

- Email: api-support@theanchor.co.uk
- API Status: https://status.orangejelly.co.uk
- Documentation Updates: Check this repository

## 🔄 Version History

### v1.0.0 (January 2024)
- Initial public API release
- Events, Menu, and Business endpoints
- Booking creation
- Webhook support
- Complete documentation

---

For detailed information, please refer to the specific documentation files linked above.