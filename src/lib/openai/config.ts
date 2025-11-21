'use server';

import { createAdminClient } from '@/lib/supabase/admin';

type OpenAIConfig = {
  apiKey: string | null;
  baseUrl: string;
  receiptsModel: string;
  eventsModel: string;
};

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_RECEIPTS_MODEL = process.env.OPENAI_RECEIPTS_MODEL ?? 'gpt-4o-mini';
const DEFAULT_EVENTS_MODEL =
  process.env.OPENAI_EVENT_CONTENT_MODEL ?? process.env.OPENAI_EVENTS_MODEL ?? 'gpt-4o-mini';

const SETTINGS_CANDIDATES = [
  'openai_settings',
  'openai_api_key',
  'openai',
  'ai_openai',
  'openai_api',
  'ai_settings',
];
const KEY_PROPS = ['api_key', 'apiKey', 'key', 'value', 'token', 'secret'];
const BASE_URL_PROPS = ['base_url', 'baseUrl', 'endpoint', 'url'];
const RECEIPTS_MODEL_PROPS = ['receipts_model', 'receipt_model', 'classification_model'];
const EVENTS_MODEL_PROPS = ['events_model', 'event_model', 'promotion_model', 'content_model'];

let cachedConfig: OpenAIConfig | null = null;
let cacheExpiresAt = 0;

function pickString(value: unknown, candidates: string[]): string | null {
  if (!value) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;

    for (const key of candidates) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim().length) {
        return candidate.trim();
      }
    }

    // Support nested value objects (e.g. { value: { api_key: '...' } })
    if ('value' in record && record.value && typeof record.value === 'object') {
      return pickString(record.value, candidates);
    }
  }

  return null;
}

async function loadConfigFromSettings(): Promise<Partial<OpenAIConfig>> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('system_settings')
      .select('key, value')
      .in('key', SETTINGS_CANDIDATES);

    if (error) {
      console.error('Failed to load OpenAI settings from system_settings:', error);
      return {};
    }

    if (!data || data.length === 0) {
      return {};
    }

    // Prefer the first candidate that contains a valid api key
    for (const candidateKey of SETTINGS_CANDIDATES) {
      const row = data.find((entry) => entry?.key === candidateKey && entry?.value != null);
      if (!row) continue;

      const value = row.value as Record<string, unknown>;

      const enabledFlag =
        typeof value?.['enabled'] === 'boolean' ? (value['enabled'] as boolean) : undefined;
      const disabledFlag =
        typeof value?.['disabled'] === 'boolean' ? (value['disabled'] as boolean) : undefined;

      if (enabledFlag === false || disabledFlag === true) {
        continue;
      }

      const apiKey = pickString(value, KEY_PROPS);
      const baseUrl = pickString(value, BASE_URL_PROPS);
      const receiptsModel = pickString(value, RECEIPTS_MODEL_PROPS);
      const eventsModel = pickString(value, EVENTS_MODEL_PROPS);

      if (apiKey) {
        return {
          apiKey,
          baseUrl: baseUrl ?? undefined,
          receiptsModel: receiptsModel ?? undefined,
          eventsModel: eventsModel ?? undefined,
        };
      }
    }

    // Fall back to the first row with any data even if api key missing (for base/model overrides)
    const fallbackRow = data[0];
    if (fallbackRow?.value) {
      const fallbackValue = fallbackRow.value as Record<string, unknown>;

      const enabledFlag =
        typeof fallbackValue?.['enabled'] === 'boolean'
          ? (fallbackValue['enabled'] as boolean)
          : undefined;
      const disabledFlag =
        typeof fallbackValue?.['disabled'] === 'boolean'
          ? (fallbackValue['disabled'] as boolean)
          : undefined;

      if (enabledFlag === false || disabledFlag === true) {
        return {};
      }

      return {
        apiKey: pickString(fallbackValue, KEY_PROPS) ?? undefined,
        baseUrl: pickString(fallbackValue, BASE_URL_PROPS) ?? undefined,
        receiptsModel: pickString(fallbackValue, RECEIPTS_MODEL_PROPS) ?? undefined,
        eventsModel: pickString(fallbackValue, EVENTS_MODEL_PROPS) ?? undefined,
      };
    }

    return {};
  } catch (error) {
    console.error('Unexpected error loading OpenAI settings:', error);
    return {};
  }
}

export async function getOpenAIConfig(options: { forceRefresh?: boolean } = {}): Promise<OpenAIConfig> {
  const now = Date.now();
  if (!options.forceRefresh && cachedConfig && cacheExpiresAt > now) {
    return cachedConfig;
  }

  const envApiKey = process.env.OPENAI_API_KEY?.trim() || null;
  const envBaseUrl = process.env.OPENAI_BASE_URL?.trim();

  const settingsOverrides = await loadConfigFromSettings();

  const apiKey = envApiKey ?? settingsOverrides.apiKey ?? null;
  const baseUrl = envBaseUrl ?? settingsOverrides.baseUrl ?? DEFAULT_BASE_URL;
  const receiptsModel = settingsOverrides.receiptsModel ?? DEFAULT_RECEIPTS_MODEL;
  const eventsModel = settingsOverrides.eventsModel ?? DEFAULT_EVENTS_MODEL;

  cachedConfig = { apiKey, baseUrl, receiptsModel, eventsModel };
  cacheExpiresAt = now + 5 * 60 * 1000; // 5 minutes

  return cachedConfig;
}

export async function clearOpenAIConfigCache() {
  cachedConfig = null;
  cacheExpiresAt = 0;
}
