// Schema.org structured data helpers
import { format } from 'date-fns';

export interface SchemaEvent {
  '@type': 'Event';
  name: string;
  description?: string;
  startDate: string;
  endDate?: string;
  eventStatus: string;
  eventAttendanceMode: string;
  location: SchemaPlace;
  image?: string[];
  performer?: SchemaPerson | SchemaOrganization;
  offers?: SchemaOffer;
  organizer: SchemaOrganization;
  isAccessibleForFree?: boolean;
  maximumAttendeeCapacity?: number;
  remainingAttendeeCapacity?: number;
  // Enhanced SEO fields
  url?: string;
  identifier?: string;
  keywords?: string;
  about?: string;
  duration?: string;
  doorTime?: string;
  video?: string[];
  review?: SchemaReview[];
  aggregateRating?: SchemaAggregateRating;
  faq?: SchemaFAQ[];
}

export interface SchemaPlace {
  '@type': 'Place';
  name: string;
  address: SchemaPostalAddress;
}

export interface SchemaPostalAddress {
  '@type': 'PostalAddress';
  streetAddress: string;
  addressLocality: string;
  addressRegion: string;
  postalCode: string;
  addressCountry: string;
}

export interface SchemaPerson {
  '@type': 'Person';
  name: string;
}

export interface SchemaOrganization {
  '@type': 'Organization';
  name: string;
  url?: string;
}

export interface SchemaOffer {
  '@type': 'Offer';
  url?: string;
  price: string;
  priceCurrency: string;
  availability: string;
  validFrom?: string;
  inventoryLevel?: {
    '@type': 'QuantitativeValue';
    value: number;
  };
}

export interface SchemaMenu {
  '@type': 'Menu';
  name: string;
  hasMenuSection: SchemaMenuSection[];
  lastUpdated?: string;
}

export interface SchemaMenuSection {
  '@type': 'MenuSection';
  name: string;
  description?: string;
  hasMenuItem: SchemaMenuItem[];
}

export interface SchemaMenuItem {
  '@type': 'MenuItem';
  name: string;
  description?: string;
  offers: SchemaOffer;
  nutrition?: SchemaNutritionInfo;
  suitableForDiet?: string[];
}

export interface SchemaNutritionInfo {
  '@type': 'NutritionInformation';
  calories?: string;
  fatContent?: string;
  saturatedFatContent?: string;
  carbohydrateContent?: string;
  sugarContent?: string;
  proteinContent?: string;
  sodiumContent?: string;
}

export interface SchemaReview {
  '@type': 'Review';
  author: string;
  reviewRating: {
    '@type': 'Rating';
    ratingValue: number;
  };
  reviewBody?: string;
  datePublished?: string;
}

export interface SchemaAggregateRating {
  '@type': 'AggregateRating';
  ratingValue: number;
  reviewCount: number;
  bestRating?: number;
  worstRating?: number;
}

export interface SchemaFAQ {
  '@type': 'Question';
  name: string;
  acceptedAnswer: {
    '@type': 'Answer';
    text: string;
  };
}

// Constants for Schema.org URLs
export const SCHEMA_EVENT_STATUS = {
  SCHEDULED: 'https://schema.org/EventScheduled',
  RESCHEDULED: 'https://schema.org/EventRescheduled',
  CANCELLED: 'https://schema.org/EventCancelled',
  POSTPONED: 'https://schema.org/EventPostponed',
} as const;

export const SCHEMA_ATTENDANCE_MODE = {
  OFFLINE: 'https://schema.org/OfflineEventAttendanceMode',
  ONLINE: 'https://schema.org/OnlineEventAttendanceMode',
  MIXED: 'https://schema.org/MixedEventAttendanceMode',
} as const;

export const SCHEMA_AVAILABILITY = {
  IN_STOCK: 'https://schema.org/InStock',
  SOLD_OUT: 'https://schema.org/SoldOut',
  LIMITED: 'https://schema.org/LimitedAvailability',
} as const;

export const SCHEMA_DIET = {
  VEGETARIAN: 'https://schema.org/VegetarianDiet',
  VEGAN: 'https://schema.org/VeganDiet',
  GLUTEN_FREE: 'https://schema.org/GlutenFreeDiet',
  HALAL: 'https://schema.org/HalalDiet',
  KOSHER: 'https://schema.org/KosherDiet',
  LOW_CALORIE: 'https://schema.org/LowCalorieDiet',
  LOW_FAT: 'https://schema.org/LowFatDiet',
  LOW_LACTOSE: 'https://schema.org/LowLactoseDiet',
  LOW_SALT: 'https://schema.org/LowSaltDiet',
} as const;

// Helper to create venue location
export function createVenueLocation(): SchemaPlace {
  return {
    '@type': 'Place',
    name: 'The Anchor Pub',
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Horton Road',
      addressLocality: 'Stanwell Moor',
      addressRegion: 'Surrey',
      postalCode: 'TW19 6AQ',
      addressCountry: 'GB',
    },
  };
}

// Helper to create organizer
export function createOrganizer(): SchemaOrganization {
  return {
    '@type': 'Organization',
    name: 'The Anchor',
    url: process.env.NEXT_PUBLIC_APP_URL || 'https://the-anchor.pub',
  };
}

// Convert database event to Schema.org format
export function eventToSchema(event: any, bookingCount: number = 0, faqs?: any[]): SchemaEvent {
  const startDateTime = `${event.date}T${event.time}+00:00`;
  const endDateTime = event.end_time 
    ? `${event.date}T${event.end_time}+00:00`
    : undefined;
  
  const capacity: number | null = event.capacity === undefined ? null : event.capacity;
  const remainingSeats = capacity === null ? null : capacity - bookingCount;
  
  // Build image array from multiple image fields
  const images: string[] = []
  if (event.hero_image_url) images.push(event.hero_image_url)
  if (event.thumbnail_image_url) images.push(event.thumbnail_image_url)
  if (event.poster_image_url) images.push(event.poster_image_url)
  if (event.gallery_image_urls?.length > 0) images.push(...event.gallery_image_urls)
  
  // Build video array
  const videos: string[] = []
  if (event.promo_video_url) videos.push(event.promo_video_url)
  if (event.highlight_video_urls?.length > 0) videos.push(...event.highlight_video_urls)
  
  // Calculate duration if provided
  let duration: string | undefined
  if (event.duration_minutes) {
    const hours = Math.floor(event.duration_minutes / 60)
    const minutes = event.duration_minutes % 60
    duration = `PT${hours}H${minutes}M`
  }
  
  const schema: SchemaEvent = {
    '@type': 'Event',
    name: event.name,
    description: event.short_description,
    startDate: startDateTime,
    endDate: endDateTime,
    eventStatus: getEventStatus(event.event_status),
    eventAttendanceMode: SCHEMA_ATTENDANCE_MODE.OFFLINE,
    location: createVenueLocation(),
    image: images.length > 0 ? images : undefined,
    performer: event.performer_name ? {
      '@type': event.performer_type === 'Organization' ? 'Organization' : 'Person',
      name: event.performer_name,
    } : undefined,
    offers: {
      '@type': 'Offer',
      url: event.booking_url || `${process.env.NEXT_PUBLIC_APP_URL}/events/${event.slug || event.id}`,
      price: event.price?.toString() || '0',
      priceCurrency: 'GBP',
      availability: remainingSeats === null
        ? SCHEMA_AVAILABILITY.IN_STOCK
        : remainingSeats > 0 
          ? (remainingSeats < 10 ? SCHEMA_AVAILABILITY.LIMITED : SCHEMA_AVAILABILITY.IN_STOCK)
          : SCHEMA_AVAILABILITY.SOLD_OUT,
      validFrom: new Date().toISOString(),
      inventoryLevel: remainingSeats !== null ? {
        '@type': 'QuantitativeValue',
        value: remainingSeats,
      } : undefined,
    },
    organizer: createOrganizer(),
    isAccessibleForFree: event.is_free === true,
    maximumAttendeeCapacity: capacity === null ? undefined : capacity,
    remainingAttendeeCapacity: remainingSeats === null ? undefined : remainingSeats,
    // Enhanced SEO fields
    url: `${process.env.NEXT_PUBLIC_APP_URL}/events/${event.slug || event.id}`,
    identifier: event.id,
    keywords: event.keywords?.join(', '),
    about: event.long_description,
    duration,
    doorTime: event.doors_time ? `${event.date}T${event.doors_time}+00:00` : undefined,
    video: videos.length > 0 ? videos : undefined,
  };
  
  // Add FAQs if provided
  if (faqs && faqs.length > 0) {
    schema.faq = faqs.map(faq => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer
      }
    }))
  }
  
  return schema;
}

function getEventStatus(status: string): string {
  switch (status) {
    case 'cancelled':
      return SCHEMA_EVENT_STATUS.CANCELLED;
    case 'postponed':
      return SCHEMA_EVENT_STATUS.POSTPONED;
    case 'rescheduled':
      return SCHEMA_EVENT_STATUS.RESCHEDULED;
    default:
      return SCHEMA_EVENT_STATUS.SCHEDULED;
  }
}

// Convert menu data to Schema.org format
export function menuToSchema(sections: any[]): SchemaMenu {
  return {
    '@type': 'Menu',
    name: 'The Anchor Menu',
    hasMenuSection: sections.map(section => ({
      '@type': 'MenuSection',
      name: section.name,
      description: section.description,
      hasMenuItem: section.items?.map((item: any) => ({
        '@type': 'MenuItem',
        name: item.name,
        description: item.description,
        offers: {
          '@type': 'Offer',
          price: item.price.toString(),
          priceCurrency: 'GBP',
          availability: SCHEMA_AVAILABILITY.IN_STOCK,
        },
        nutrition: item.calories ? {
          '@type': 'NutritionInformation',
          calories: `${item.calories} calories`,
        } : undefined,
        suitableForDiet: mapDietaryInfo(item.dietary_info || []),
      })) || [],
    })),
    lastUpdated: new Date().toISOString(),
  };
}

function mapDietaryInfo(dietaryInfo: string[]): string[] {
  const mapped: string[] = [];
  
  dietaryInfo.forEach(diet => {
    const normalized = diet.toLowerCase().replace(/[^a-z]/g, '');
    switch (normalized) {
      case 'vegetarian':
      case 'v':
        mapped.push(SCHEMA_DIET.VEGETARIAN);
        break;
      case 'vegan':
      case 'vg':
      case 've':
        mapped.push(SCHEMA_DIET.VEGAN);
        break;
      case 'glutenfree':
      case 'gf':
        mapped.push(SCHEMA_DIET.GLUTEN_FREE);
        break;
      case 'halal':
        mapped.push(SCHEMA_DIET.HALAL);
        break;
      case 'kosher':
        mapped.push(SCHEMA_DIET.KOSHER);
        break;
    }
  });
  
  return mapped;
}
