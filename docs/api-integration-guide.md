# The Anchor API Integration Guide

This guide provides practical examples and best practices for integrating The Anchor's API into your website or application.

## Table of Contents
1. [Getting Started](#getting-started)
2. [Common Integration Scenarios](#common-integration-scenarios)
3. [WordPress Integration](#wordpress-integration)
4. [React/Next.js Integration](#reactnextjs-integration)
5. [Mobile App Integration](#mobile-app-integration)
6. [SEO Best Practices](#seo-best-practices)
7. [Performance Optimization](#performance-optimization)
8. [Error Handling](#error-handling)
9. [Testing Your Integration](#testing-your-integration)

## Getting Started

### 1. Obtain Your API Key

Contact The Anchor management team to receive your API key. Store it securely and never expose it in client-side code.

### 2. Set Up Your Development Environment

```bash
# Test your API key
curl -H "X-API-Key: your-api-key" https://management.orangejelly.co.uk/api/events
```

### 3. Choose Your Integration Method

- **Server-side**: Recommended for security and performance
- **Client-side**: Only for public data, implement proper CORS handling

## Common Integration Scenarios

### Displaying Upcoming Events

```javascript
// Server-side Node.js example
const express = require('express');
const app = express();

app.get('/events', async (req, res) => {
  try {
    const response = await fetch('https://management.orangejelly.co.uk/api/events?status=scheduled', {
      headers: {
        'X-API-Key': process.env.ANCHOR_API_KEY
      }
    });
    
    const data = await response.json();
    
    // Cache for 1 hour
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});
```

### Creating an Event Calendar

```javascript
class AnchorEventCalendar {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://management.orangejelly.co.uk/api';
    this.cache = new Map();
  }

  async getEventsForMonth(year, month) {
    const cacheKey = `${year}-${month}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (cached.expires > Date.now()) {
        return cached.data;
      }
    }

    const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0];
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];

    const response = await fetch(
      `${this.baseUrl}/events?from_date=${startDate}&to_date=${endDate}&status=scheduled`,
      {
        headers: { 'X-API-Key': this.apiKey }
      }
    );

    const data = await response.json();
    
    // Cache for 1 hour
    this.cache.set(cacheKey, {
      data: data.itemListElement,
      expires: Date.now() + 3600000
    });

    return data.itemListElement;
  }

  renderCalendar(containerId, year, month) {
    const container = document.getElementById(containerId);
    
    this.getEventsForMonth(year, month).then(events => {
      // Group events by date
      const eventsByDate = {};
      events.forEach(event => {
        const date = event.startDate.split('T')[0];
        if (!eventsByDate[date]) eventsByDate[date] = [];
        eventsByDate[date].push(event);
      });

      // Render calendar UI
      const daysInMonth = new Date(year, month, 0).getDate();
      let html = '<div class="calendar-grid">';
      
      for (let day = 1; day <= daysInMonth; day++) {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayEvents = eventsByDate[date] || [];
        
        html += `
          <div class="calendar-day">
            <div class="day-number">${day}</div>
            ${dayEvents.map(event => `
              <div class="event-item">
                <a href="/events/${event.id}">${event.name}</a>
                <span class="event-time">${new Date(event.startDate).toLocaleTimeString()}</span>
              </div>
            `).join('')}
          </div>
        `;
      }
      
      html += '</div>';
      container.innerHTML = html;
    });
  }
}
```

### Dynamic Menu Display

```javascript
class AnchorMenuWidget {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://management.orangejelly.co.uk/api';
  }

  async renderMenu(containerId, options = {}) {
    const container = document.getElementById(containerId);
    
    try {
      // Fetch menu data
      const menuResponse = await fetch(`${this.baseUrl}/menu`, {
        headers: { 'X-API-Key': this.apiKey }
      });
      const menuData = await menuResponse.json();

      // Fetch specials if requested
      let specials = null;
      if (options.showSpecials) {
        const specialsResponse = await fetch(`${this.baseUrl}/menu/specials`, {
          headers: { 'X-API-Key': this.apiKey }
        });
        specials = await specialsResponse.json();
      }

      // Render menu
      let html = '<div class="menu-container">';
      
      if (specials && specials.specials.length > 0) {
        html += '<div class="menu-specials">';
        html += '<h2>Today\'s Specials</h2>';
        specials.specials.forEach(special => {
          html += `
            <div class="special-item">
              <h3>${special.name}</h3>
              <p>${special.description}</p>
              <span class="price">£${special.offers.price}</span>
            </div>
          `;
        });
        html += '</div>';
      }

      menuData.hasMenuSection.forEach(section => {
        html += `<div class="menu-section">`;
        html += `<h2>${section.name}</h2>`;
        
        section.hasMenuItem.forEach(item => {
          html += `
            <div class="menu-item">
              <div class="item-header">
                <h3>${item.name}</h3>
                <span class="price">£${item.offers.price}</span>
              </div>
              <p class="description">${item.description}</p>
              ${item.suitableForDiet ? `
                <div class="dietary-info">
                  ${item.suitableForDiet.map(diet => 
                    `<span class="diet-badge">${this.formatDiet(diet)}</span>`
                  ).join('')}
                </div>
              ` : ''}
            </div>
          `;
        });
        
        html += '</div>';
      });
      
      html += '</div>';
      container.innerHTML = html;
    } catch (error) {
      container.innerHTML = '<p>Menu temporarily unavailable</p>';
    }
  }

  formatDiet(schemaUrl) {
    const diets = {
      'https://schema.org/VegetarianDiet': '🌱 Vegetarian',
      'https://schema.org/VeganDiet': '🌿 Vegan',
      'https://schema.org/GlutenFreeDiet': '🌾 Gluten Free',
      'https://schema.org/LowLactoseDiet': '🥛 Dairy Free'
    };
    return diets[schemaUrl] || 'Special Diet';
  }
}
```

## WordPress Integration

### Plugin Example

```php
<?php
/**
 * Plugin Name: The Anchor Events
 * Description: Display events from The Anchor
 */

class TheAnchorEvents {
    private $api_key;
    private $api_url = 'https://management.orangejelly.co.uk/api';
    
    public function __construct() {
        $this->api_key = get_option('anchor_api_key');
        add_shortcode('anchor_events', array($this, 'render_events'));
        add_action('wp_enqueue_scripts', array($this, 'enqueue_styles'));
    }
    
    public function render_events($atts) {
        $atts = shortcode_atts(array(
            'limit' => 5,
            'category' => '',
            'show_past' => false
        ), $atts);
        
        $events = $this->get_events($atts);
        
        if (empty($events)) {
            return '<p>No upcoming events</p>';
        }
        
        $output = '<div class="anchor-events">';
        foreach ($events as $event) {
            $output .= $this->render_event_card($event);
        }
        $output .= '</div>';
        
        return $output;
    }
    
    private function get_events($options) {
        $cache_key = 'anchor_events_' . md5(serialize($options));
        $cached = get_transient($cache_key);
        
        if ($cached !== false) {
            return $cached;
        }
        
        $params = array(
            'per_page' => $options['limit'],
            'status' => 'scheduled'
        );
        
        if ($options['category']) {
            $params['category'] = $options['category'];
        }
        
        $response = wp_remote_get(
            $this->api_url . '/events?' . http_build_query($params),
            array(
                'headers' => array(
                    'X-API-Key' => $this->api_key
                )
            )
        );
        
        if (is_wp_error($response)) {
            return array();
        }
        
        $data = json_decode(wp_remote_retrieve_body($response), true);
        $events = $data['itemListElement'] ?? array();
        
        // Cache for 1 hour
        set_transient($cache_key, $events, HOUR_IN_SECONDS);
        
        return $events;
    }
    
    private function render_event_card($event) {
        $date = new DateTime($event['startDate']);
        
        return sprintf(
            '<div class="event-card" itemscope itemtype="https://schema.org/Event">
                <h3 itemprop="name">%s</h3>
                <time itemprop="startDate" datetime="%s">%s at %s</time>
                %s
                %s
                <a href="%s" class="event-link">Learn More</a>
            </div>',
            esc_html($event['name']),
            esc_attr($event['startDate']),
            $date->format('l, F j, Y'),
            $date->format('g:i A'),
            $event['description'] ? '<p itemprop="description">' . esc_html($event['description']) . '</p>' : '',
            $event['performer'] ? '<p class="performer">Featuring: ' . esc_html($event['performer']['name']) . '</p>' : '',
            esc_url(home_url('/events/' . $event['id']))
        );
    }
    
    public function enqueue_styles() {
        wp_enqueue_style(
            'anchor-events',
            plugin_dir_url(__FILE__) . 'assets/events.css'
        );
    }
}

new TheAnchorEvents();
```

### Gutenberg Block

```javascript
// blocks/upcoming-events/index.js
import { registerBlockType } from '@wordpress/blocks';
import { InspectorControls } from '@wordpress/block-editor';
import { PanelBody, RangeControl, SelectControl } from '@wordpress/components';
import { useState, useEffect } from '@wordpress/element';

registerBlockType('anchor/upcoming-events', {
    title: 'Anchor Upcoming Events',
    icon: 'calendar-alt',
    category: 'widgets',
    attributes: {
        numberOfEvents: {
            type: 'number',
            default: 3
        },
        category: {
            type: 'string',
            default: ''
        }
    },
    
    edit: ({ attributes, setAttributes }) => {
        const [events, setEvents] = useState([]);
        const [categories, setCategories] = useState([]);
        
        useEffect(() => {
            // Fetch categories
            fetch('/wp-json/anchor/v1/categories')
                .then(res => res.json())
                .then(data => setCategories(data));
            
            // Fetch events
            const params = new URLSearchParams({
                limit: attributes.numberOfEvents,
                category: attributes.category
            });
            
            fetch(`/wp-json/anchor/v1/events?${params}`)
                .then(res => res.json())
                .then(data => setEvents(data));
        }, [attributes]);
        
        return (
            <>
                <InspectorControls>
                    <PanelBody title="Event Settings">
                        <RangeControl
                            label="Number of Events"
                            value={attributes.numberOfEvents}
                            onChange={(value) => setAttributes({ numberOfEvents: value })}
                            min={1}
                            max={10}
                        />
                        <SelectControl
                            label="Category"
                            value={attributes.category}
                            options={[
                                { label: 'All Categories', value: '' },
                                ...categories.map(cat => ({
                                    label: cat.name,
                                    value: cat.id
                                }))
                            ]}
                            onChange={(value) => setAttributes({ category: value })}
                        />
                    </PanelBody>
                </InspectorControls>
                
                <div className="anchor-events-block">
                    {events.length === 0 ? (
                        <p>Loading events...</p>
                    ) : (
                        events.map(event => (
                            <div key={event.id} className="event-preview">
                                <h3>{event.name}</h3>
                                <p>{new Date(event.startDate).toLocaleDateString()}</p>
                            </div>
                        ))
                    )}
                </div>
            </>
        );
    },
    
    save: () => null // Dynamic block rendered server-side
});
```

## React/Next.js Integration

### Custom Hook for Events

```typescript
// hooks/useAnchorEvents.ts
import { useState, useEffect } from 'react';
import { Event } from '@/types/anchor';

interface UseAnchorEventsOptions {
  category?: string;
  status?: 'scheduled' | 'cancelled' | 'postponed';
  limit?: number;
  fromDate?: string;
  toDate?: string;
}

export function useAnchorEvents(options: UseAnchorEventsOptions = {}) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        
        if (options.category) params.append('category', options.category);
        if (options.status) params.append('status', options.status);
        if (options.limit) params.append('per_page', options.limit.toString());
        if (options.fromDate) params.append('from_date', options.fromDate);
        if (options.toDate) params.append('to_date', options.toDate);

        const response = await fetch(`/api/anchor/events?${params}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch events');
        }

        const data = await response.json();
        setEvents(data.itemListElement || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, [options.category, options.status, options.limit, options.fromDate, options.toDate]);

  return { events, loading, error };
}
```

### Event List Component

```typescript
// components/AnchorEvents.tsx
import { useAnchorEvents } from '@/hooks/useAnchorEvents';
import { formatDate } from '@/utils/date';
import Image from 'next/image';
import Link from 'next/link';

interface AnchorEventsProps {
  category?: string;
  limit?: number;
}

export function AnchorEvents({ category, limit = 6 }: AnchorEventsProps) {
  const { events, loading, error } = useAnchorEvents({ category, limit, status: 'scheduled' });

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...Array(limit)].map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="bg-gray-300 h-48 rounded-lg mb-4"></div>
            <div className="h-4 bg-gray-300 rounded w-3/4 mb-2"></div>
            <div className="h-4 bg-gray-300 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="text-red-600">Error loading events: {error}</div>;
  }

  if (events.length === 0) {
    return <p className="text-gray-500">No upcoming events</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {events.map((event) => (
        <article
          key={event.id}
          className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
          itemScope
          itemType="https://schema.org/Event"
        >
          {event.image && event.image[0] && (
            <div className="relative h-48">
              <Image
                src={event.image[0]}
                alt={event.name}
                fill
                className="object-cover"
                itemProp="image"
              />
            </div>
          )}
          
          <div className="p-6">
            <h3 className="text-xl font-semibold mb-2" itemProp="name">
              {event.name}
            </h3>
            
            <time
              className="text-gray-600 text-sm"
              itemProp="startDate"
              dateTime={event.startDate}
            >
              {formatDate(event.startDate)}
            </time>
            
            {event.performer && (
              <p className="text-gray-700 mt-2" itemProp="performer" itemScope itemType={`https://schema.org/${event.performer['@type']}`}>
                Featuring: <span itemProp="name">{event.performer.name}</span>
              </p>
            )}
            
            {event.offers && (
              <div className="mt-4" itemProp="offers" itemScope itemType="https://schema.org/Offer">
                <span className="text-2xl font-bold text-green-600">
                  {event.offers.price === '0' ? 'Free' : `£${event.offers.price}`}
                </span>
                <meta itemProp="priceCurrency" content={event.offers.priceCurrency} />
              </div>
            )}
            
            <Link
              href={`/events/${event.id}`}
              className="inline-block mt-4 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
            >
              View Details
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
```

### API Route Proxy

```typescript
// app/api/anchor/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';

const ANCHOR_API_URL = 'https://management.orangejelly.co.uk/api';
const ANCHOR_API_KEY = process.env.ANCHOR_API_KEY!;

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const path = params.path.join('/');
  const url = new URL(request.url);
  const queryString = url.searchParams.toString();
  
  try {
    const response = await fetch(
      `${ANCHOR_API_URL}/${path}${queryString ? `?${queryString}` : ''}`,
      {
        headers: {
          'X-API-Key': ANCHOR_API_KEY,
        },
        // Cache for 5 minutes
        next: { revalidate: 300 }
      }
    );

    const data = await response.json();
    
    return NextResponse.json(data, {
      status: response.status,
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch data' },
      { status: 500 }
    );
  }
}
```

## Mobile App Integration

### React Native Example

```typescript
// services/AnchorAPI.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

class AnchorAPIService {
  private baseURL = 'https://management.orangejelly.co.uk/api';
  private apiKey = process.env.EXPO_PUBLIC_ANCHOR_API_KEY;
  private cache = new Map();

  async fetchWithCache(endpoint: string, cacheTime: number = 300000) {
    const cacheKey = `anchor_${endpoint}`;
    
    // Check memory cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (cached.expires > Date.now()) {
        return cached.data;
      }
    }

    // Check persistent cache
    try {
      const stored = await AsyncStorage.getItem(cacheKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.expires > Date.now()) {
          this.cache.set(cacheKey, parsed);
          return parsed.data;
        }
      }
    } catch (error) {
      console.error('Cache read error:', error);
    }

    // Fetch fresh data
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      headers: {
        'X-API-Key': this.apiKey!,
      }
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }

    const data = await response.json();
    
    // Cache the response
    const cacheData = {
      data,
      expires: Date.now() + cacheTime
    };
    
    this.cache.set(cacheKey, cacheData);
    
    // Store in persistent cache
    try {
      await AsyncStorage.setItem(cacheKey, JSON.stringify(cacheData));
    } catch (error) {
      console.error('Cache write error:', error);
    }

    return data;
  }

  async getEvents(options: EventQueryOptions = {}) {
    const params = new URLSearchParams();
    Object.entries(options).forEach(([key, value]) => {
      if (value) params.append(key, value.toString());
    });
    
    const endpoint = `/events${params.toString() ? `?${params}` : ''}`;
    return this.fetchWithCache(endpoint);
  }

  async getEvent(id: string) {
    return this.fetchWithCache(`/events/${id}`, 3600000); // Cache for 1 hour
  }

  async checkAvailability(eventId: string) {
    // Don't cache availability checks
    const response = await fetch(
      `${this.baseURL}/events/${eventId}/check-availability`,
      {
        headers: { 'X-API-Key': this.apiKey! }
      }
    );
    
    return response.json();
  }
}

export const anchorAPI = new AnchorAPIService();
```

### Flutter Example

```dart
// lib/services/anchor_api.dart
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';

class AnchorAPI {
  static const String baseUrl = 'https://management.orangejelly.co.uk/api';
  static const String apiKey = String.fromEnvironment('ANCHOR_API_KEY');
  
  final _cache = <String, CachedData>{};
  
  Future<dynamic> _fetchWithCache(String endpoint, {Duration cacheDuration = const Duration(minutes: 5)}) async {
    final cacheKey = 'anchor_$endpoint';
    
    // Check memory cache
    if (_cache.containsKey(cacheKey)) {
      final cached = _cache[cacheKey]!;
      if (cached.expiresAt.isAfter(DateTime.now())) {
        return cached.data;
      }
    }
    
    // Check persistent cache
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString(cacheKey);
    if (stored != null) {
      final decoded = jsonDecode(stored);
      final expiresAt = DateTime.parse(decoded['expiresAt']);
      if (expiresAt.isAfter(DateTime.now())) {
        final data = decoded['data'];
        _cache[cacheKey] = CachedData(data, expiresAt);
        return data;
      }
    }
    
    // Fetch fresh data
    final response = await http.get(
      Uri.parse('$baseUrl$endpoint'),
      headers: {'X-API-Key': apiKey},
    );
    
    if (response.statusCode != 200) {
      throw Exception('API Error: ${response.statusCode}');
    }
    
    final data = jsonDecode(response.body);
    final expiresAt = DateTime.now().add(cacheDuration);
    
    // Cache the response
    _cache[cacheKey] = CachedData(data, expiresAt);
    await prefs.setString(cacheKey, jsonEncode({
      'data': data,
      'expiresAt': expiresAt.toIso8601String(),
    }));
    
    return data;
  }
  
  Future<List<Event>> getEvents({String? category, String? status}) async {
    final params = <String, String>{};
    if (category != null) params['category'] = category;
    if (status != null) params['status'] = status;
    
    final queryString = Uri(queryParameters: params).query;
    final endpoint = '/events${queryString.isNotEmpty ? '?$queryString' : ''}';
    
    final data = await _fetchWithCache(endpoint);
    return (data['itemListElement'] as List)
        .map((e) => Event.fromJson(e))
        .toList();
  }
  
  Future<Event> getEvent(String id) async {
    final data = await _fetchWithCache('/events/$id', cacheDuration: Duration(hours: 1));
    return Event.fromJson(data);
  }
}

class CachedData {
  final dynamic data;
  final DateTime expiresAt;
  
  CachedData(this.data, this.expiresAt);
}
```

## SEO Best Practices

### Structured Data Implementation

```html
<!-- Event List Page -->
<div itemscope itemtype="https://schema.org/ItemList">
  <h1 itemprop="name">Upcoming Events at The Anchor</h1>
  
  <div itemprop="itemListElement" itemscope itemtype="https://schema.org/Event">
    <meta itemprop="position" content="1" />
    <h2 itemprop="name">Live Jazz Night</h2>
    <time itemprop="startDate" datetime="2024-02-15T19:30:00Z">
      February 15, 2024 at 7:30 PM
    </time>
    <div itemprop="location" itemscope itemtype="https://schema.org/Place">
      <span itemprop="name">The Anchor</span>
      <div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress">
        <span itemprop="streetAddress">123 High Street</span>
        <span itemprop="addressLocality">London</span>
      </div>
    </div>
  </div>
</div>
```

### JSON-LD Alternative

```javascript
function generateEventJsonLd(event) {
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    "name": event.name,
    "description": event.description,
    "startDate": event.startDate,
    "endDate": event.endDate,
    "eventStatus": event.eventStatus,
    "location": {
      "@type": "Place",
      "name": "The Anchor",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "123 High Street",
        "addressLocality": "London",
        "postalCode": "SW1A 1AA",
        "addressCountry": "GB"
      }
    },
    "image": event.image,
    "offers": {
      "@type": "Offer",
      "url": `https://example.com/events/${event.id}`,
      "price": event.offers.price,
      "priceCurrency": event.offers.priceCurrency,
      "availability": "https://schema.org/InStock",
      "validFrom": event.offers.validFrom
    },
    "performer": event.performer,
    "organizer": {
      "@type": "Organization",
      "name": "The Anchor",
      "url": "https://theanchor.co.uk"
    }
  };
}

// In your page component
export default function EventPage({ event }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(generateEventJsonLd(event))
        }}
      />
      {/* Your event content */}
    </>
  );
}
```

## Performance Optimization

### Implementing a Cache Layer

```javascript
// utils/apiCache.js
class APICache {
  constructor() {
    this.cache = new Map();
    this.pending = new Map();
  }

  async get(key, fetcher, options = {}) {
    const { ttl = 300000, staleWhileRevalidate = true } = options;
    
    // Check if we have a pending request
    if (this.pending.has(key)) {
      return this.pending.get(key);
    }

    // Check cache
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached) {
      const age = now - cached.timestamp;
      
      // Return cached data if still fresh
      if (age < ttl) {
        return cached.data;
      }

      // Return stale data and revalidate in background
      if (staleWhileRevalidate) {
        this.revalidate(key, fetcher, ttl);
        return cached.data;
      }
    }

    // Fetch fresh data
    const promise = fetcher();
    this.pending.set(key, promise);

    try {
      const data = await promise;
      this.cache.set(key, { data, timestamp: now });
      return data;
    } finally {
      this.pending.delete(key);
    }
  }

  async revalidate(key, fetcher, ttl) {
    try {
      const data = await fetcher();
      this.cache.set(key, { data, timestamp: Date.now() });
    } catch (error) {
      console.error(`Failed to revalidate cache for ${key}:`, error);
    }
  }

  invalidate(pattern) {
    if (pattern instanceof RegExp) {
      for (const key of this.cache.keys()) {
        if (pattern.test(key)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.delete(pattern);
    }
  }
}

export const apiCache = new APICache();
```

### Optimizing Image Loading

```javascript
// components/OptimizedEventImage.js
import { useState, useEffect } from 'react';

export function OptimizedEventImage({ src, alt, className }) {
  const [imageSrc, setImageSrc] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Use Intersection Observer for lazy loading
    const img = new Image();
    
    img.onload = () => {
      setImageSrc(src);
      setLoading(false);
    };
    
    img.onerror = () => {
      setImageSrc('/images/event-placeholder.jpg');
      setLoading(false);
    };
    
    // Load a smaller version first if available
    const thumbnailSrc = src.replace(/\.(jpg|png)$/, '-thumb.$1');
    
    fetch(thumbnailSrc, { method: 'HEAD' })
      .then(response => {
        if (response.ok) {
          setImageSrc(thumbnailSrc);
          img.src = src; // Load full size in background
        } else {
          img.src = src;
        }
      })
      .catch(() => {
        img.src = src;
      });
  }, [src]);

  if (loading) {
    return (
      <div className={`${className} animate-pulse bg-gray-300`} />
    );
  }

  return (
    <img
      src={imageSrc}
      alt={alt}
      className={className}
      loading="lazy"
    />
  );
}
```

## Error Handling

### Comprehensive Error Handler

```typescript
// utils/errorHandler.ts
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export async function handleAPIResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      errorData = { error: 'Unknown error occurred' };
    }

    throw new APIError(
      errorData.error || `HTTP ${response.status}`,
      response.status,
      errorData.code,
      errorData
    );
  }

  try {
    return await response.json();
  } catch {
    throw new APIError('Invalid JSON response', 500, 'PARSE_ERROR');
  }
}

export function createErrorBoundary(fallback: React.ComponentType<{ error: Error }>) {
  return class ErrorBoundary extends React.Component<
    { children: React.ReactNode },
    { hasError: boolean; error: Error | null }
  > {
    constructor(props: { children: React.ReactNode }) {
      super(props);
      this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error) {
      return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
      console.error('Error caught by boundary:', error, errorInfo);
      
      // Send to error tracking service
      if (typeof window !== 'undefined' && window.Sentry) {
        window.Sentry.captureException(error, {
          contexts: { react: { componentStack: errorInfo.componentStack } }
        });
      }
    }

    render() {
      if (this.state.hasError && this.state.error) {
        const FallbackComponent = fallback;
        return <FallbackComponent error={this.state.error} />;
      }

      return this.props.children;
    }
  };
}
```

### User-Friendly Error Messages

```javascript
// utils/errorMessages.js
export function getErrorMessage(error) {
  if (error instanceof APIError) {
    switch (error.status) {
      case 401:
        return 'Authentication required. Please check your API key.';
      case 403:
        return 'Access denied. Your API key may not have the required permissions.';
      case 404:
        return 'The requested resource was not found.';
      case 429:
        return 'Too many requests. Please try again later.';
      case 500:
        return 'Server error. Please try again later or contact support.';
      default:
        return error.message || 'An unexpected error occurred.';
    }
  }

  if (error.message.includes('fetch')) {
    return 'Network error. Please check your internet connection.';
  }

  return 'An unexpected error occurred. Please try again.';
}

// Component usage
export function EventList() {
  const [error, setError] = useState(null);
  
  if (error) {
    return (
      <div className="error-container">
        <p className="error-message">{getErrorMessage(error)}</p>
        <button onClick={() => window.location.reload()}>
          Try Again
        </button>
      </div>
    );
  }
  
  // ... rest of component
}
```

## Testing Your Integration

### API Response Mocking

```javascript
// __tests__/api.test.js
import { rest } from 'msw';
import { setupServer } from 'msw/node';
import { render, screen, waitFor } from '@testing-library/react';
import { EventList } from '../components/EventList';

const server = setupServer(
  rest.get('https://management.orangejelly.co.uk/api/events', (req, res, ctx) => {
    return res(
      ctx.json({
        "@context": "https://schema.org",
        "@type": "ItemList",
        "itemListElement": [
          {
            "@type": "Event",
            "id": "test-event-1",
            "name": "Test Event",
            "startDate": "2024-03-01T19:00:00Z",
            "offers": {
              "@type": "Offer",
              "price": "10.00",
              "priceCurrency": "GBP"
            }
          }
        ]
      })
    );
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('displays events from API', async () => {
  render(<EventList />);
  
  await waitFor(() => {
    expect(screen.getByText('Test Event')).toBeInTheDocument();
    expect(screen.getByText('£10.00')).toBeInTheDocument();
  });
});

test('handles API errors gracefully', async () => {
  server.use(
    rest.get('https://management.orangejelly.co.uk/api/events', (req, res, ctx) => {
      return res(ctx.status(500), ctx.json({ error: 'Server error' }));
    })
  );
  
  render(<EventList />);
  
  await waitFor(() => {
    expect(screen.getByText(/server error/i)).toBeInTheDocument();
  });
});
```

### Integration Testing

```javascript
// cypress/integration/events.spec.js
describe('Events Integration', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/api/events*', { fixture: 'events.json' }).as('getEvents');
    cy.visit('/events');
  });

  it('displays upcoming events', () => {
    cy.wait('@getEvents');
    
    cy.get('[data-testid="event-card"]').should('have.length.greaterThan', 0);
    cy.get('[data-testid="event-card"]').first().within(() => {
      cy.get('h3').should('be.visible');
      cy.get('time').should('be.visible');
      cy.get('.price').should('be.visible');
    });
  });

  it('filters events by category', () => {
    cy.get('[data-testid="category-filter"]').select('Live Music');
    cy.wait('@getEvents');
    
    cy.get('[data-testid="event-card"]').each(($el) => {
      cy.wrap($el).should('contain', 'Live Music');
    });
  });

  it('handles pagination', () => {
    cy.get('[data-testid="load-more"]').click();
    cy.wait('@getEvents');
    
    cy.get('[data-testid="event-card"]').should('have.length.greaterThan', 10);
  });
});
```

## Monitoring and Analytics

```javascript
// utils/apiAnalytics.js
class APIAnalytics {
  trackAPICall(endpoint, params, response, duration) {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'api_call', {
        event_category: 'API',
        event_label: endpoint,
        value: duration,
        custom_parameters: {
          params: JSON.stringify(params),
          status: response.status,
          cached: response.headers.get('X-From-Cache') === 'true'
        }
      });
    }
  }

  trackError(endpoint, error) {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'exception', {
        description: `API Error: ${endpoint} - ${error.message}`,
        fatal: false
      });
    }
  }
}

export const apiAnalytics = new APIAnalytics();
```

## Conclusion

This integration guide provides comprehensive examples for implementing The Anchor's API across various platforms and frameworks. Remember to:

1. Always handle errors gracefully
2. Implement proper caching strategies
3. Use structured data for SEO benefits
4. Monitor API usage and performance
5. Keep your API key secure

For additional support or questions, contact api-support@theanchor.co.uk.