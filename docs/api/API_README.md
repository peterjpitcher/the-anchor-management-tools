# API Documentation Index

This directory contains the API documentation for The Anchor Management Tools.

## Main Documentation

### 📖 [COMPLETE_API_DOCUMENTATION.md](./COMPLETE_API_DOCUMENTATION.md)
The comprehensive API documentation covering all endpoints, authentication, and integration patterns. This is the primary reference for API integration.

### 📑 [openapi.yaml](./openapi.yaml)
OpenAPI/Swagger specification file that can be imported into API testing tools like Postman or used for generating client SDKs.

## Specialized API Documentation

### 🍽️ [TABLE_BOOKING_API.md](./TABLE_BOOKING_API.md)
Detailed documentation for the Table Booking API, including:
- Restaurant table reservations
- Sunday lunch bookings
- Availability checking
- Payment integration

### 📱 [booking-initiation.md](./booking-initiation.md)
Documentation for the Booking Initiation API, which provides:
- Two-step booking confirmation process
- SMS-based booking verification
- Customer booking flow integration

## Quick Links

- **Base URL**: `https://management.orangejelly.co.uk/api`
- **Authentication**: API key-based (X-API-Key header)
- **Support**: Contact The Anchor management team

## Getting Started

1. **Obtain an API Key**: Contact The Anchor management team or generate one at `/settings/api-keys`
2. **Choose Your Documentation**: 
   - For general integration: Start with [COMPLETE_API_DOCUMENTATION.md](./COMPLETE_API_DOCUMENTATION.md)
   - For table bookings: Refer to [TABLE_BOOKING_API.md](./TABLE_BOOKING_API.md)
   - For event bookings: See [booking-initiation.md](./booking-initiation.md)
3. **Test Your Integration**: Use the provided examples and test endpoints

## Archive

Temporary documentation, fix summaries, and deployment notes have been moved to the `archive/` directory for historical reference.