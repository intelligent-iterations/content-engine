import fs from 'fs';
import path from 'path';
import { OUTPUT_DIR } from '../core/paths.js';

const TRACKING_DIR = path.join(OUTPUT_DIR, 'tracking');
const EVENTS_PATH = path.join(TRACKING_DIR, 'api-spend-events.jsonl');
const SUMMARY_PATH = path.join(TRACKING_DIR, 'api-spend-summary.json');
const USD_NANOS = 1_000_000_000;

// Pricing snapshot verified against the embedded pricing payload on
// https://docs.x.ai/developers/models on 2026-03-30.
const XAI_PRICING = {
  verifiedAt: '2026-03-30',
  sourceUrl: 'https://docs.x.ai/developers/models',
  textModels: {
    'grok-4-1-fast-non-reasoning': {
      inputUsdPerMillionTokens: 2,
      outputUsdPerMillionTokens: 5,
      cachedInputUsdPerMillionTokens: 0.5,
    },
  },
  imageModels: {
    'grok-imagine-image': {
      outputUsdPerImage: 0.2,
      inputUsdPerImage: 0.02,
    },
    'grok-imagine-image-pro': {
      outputUsdPerImage: 0.7,
      inputUsdPerImage: 0.02,
    },
  },
  videoModels: {
    'grok-imagine-video': {
      outputUsdPerSecond720p: 0.5,
      outputUsdPerSecond1080p: 0.7,
      inputUsdPerImage: 0.02,
      inputUsdPerVideoSecond: 0.1,
    },
  },
};

function roundUsd(value) {
  const numeric = Number(value || 0);
  return Number(numeric.toFixed(6));
}

function formatUsd(value) {
  return `$${roundUsd(value).toFixed(4)}`;
}

function parseUsdEnv(name) {
  const raw = process.env[name];
  if (raw == null || raw === '') {
    return null;
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`Invalid USD amount in ${name}: "${raw}"`);
  }

  return roundUsd(numeric);
}

function normalizeResolutionLabel(resolution) {
  const value = String(resolution || '').trim().toLowerCase();
  if (value.includes('1080') || value.includes('2k')) {
    return '1080p';
  }
  return '720p';
}

function ensureTrackingDir() {
  fs.mkdirSync(TRACKING_DIR, { recursive: true });
}

function todayKeys(now = new Date()) {
  const iso = now.toISOString();
  return {
    day: iso.slice(0, 10),
    month: iso.slice(0, 7),
  };
}

function makeEmptyProviderSummary() {
  return {
    lifetime_usd: 0,
    request_count: 0,
    billable_request_count: 0,
    by_day: {},
    by_month: {},
    by_operation: {},
    by_model: {},
  };
}

function makeEmptySummary() {
  return {
    version: 1,
    currency: 'USD',
    updated_at: null,
    tracker_paths: {
      events: EVENTS_PATH,
      summary: SUMMARY_PATH,
    },
    pricing: {
      xai: {
        verified_at: XAI_PRICING.verifiedAt,
        source_url: XAI_PRICING.sourceUrl,
      },
    },
    totals: {
      lifetime_usd: 0,
      request_count: 0,
      billable_request_count: 0,
    },
    providers: {
      xai: makeEmptyProviderSummary(),
    },
  };
}

function loadSummary() {
  ensureTrackingDir();
  if (!fs.existsSync(SUMMARY_PATH)) {
    return makeEmptySummary();
  }

  try {
    return JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'));
  } catch {
    return makeEmptySummary();
  }
}

function writeSummary(summary) {
  ensureTrackingDir();
  summary.updated_at = new Date().toISOString();
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
}

function appendEvent(event) {
  ensureTrackingDir();
  fs.appendFileSync(EVENTS_PATH, `${JSON.stringify(event)}\n`);
}

function incrementBucket(map, key, costUsd) {
  if (!map[key]) {
    map[key] = {
      usd: 0,
      request_count: 0,
      billable_request_count: 0,
    };
  }

  map[key].usd = roundUsd(map[key].usd + costUsd);
  map[key].request_count += 1;
  if (costUsd > 0) {
    map[key].billable_request_count += 1;
  }
}

function applyEventToSummary(summary, event) {
  const provider = event.provider;
  if (!summary.providers[provider]) {
    summary.providers[provider] = makeEmptyProviderSummary();
  }

  const providerSummary = summary.providers[provider];
  const costUsd = roundUsd(event.cost_usd || 0);

  summary.totals.lifetime_usd = roundUsd(summary.totals.lifetime_usd + costUsd);
  summary.totals.request_count += 1;
  providerSummary.lifetime_usd = roundUsd(providerSummary.lifetime_usd + costUsd);
  providerSummary.request_count += 1;

  if (costUsd > 0) {
    summary.totals.billable_request_count += 1;
    providerSummary.billable_request_count += 1;
  }

  incrementBucket(providerSummary.by_day, event.day_key, costUsd);
  incrementBucket(providerSummary.by_month, event.month_key, costUsd);
  incrementBucket(providerSummary.by_operation, event.operation, costUsd);
  incrementBucket(providerSummary.by_model, event.model || 'unknown', costUsd);
}

function getConfigForProvider(provider) {
  const upper = provider.toUpperCase();
  return {
    scope: String(process.env[`${upper}_SPEND_SCOPE`] || process.env.API_SPEND_SCOPE || 'monthly')
      .trim()
      .toLowerCase() === 'lifetime' ? 'lifetime' : 'monthly',
    budgetUsd: parseUsdEnv(`${upper}_SPEND_BUDGET_USD`) ?? parseUsdEnv('API_SPEND_BUDGET_USD'),
    capUsd: parseUsdEnv(`${upper}_SPEND_CAP_USD`) ?? parseUsdEnv('API_SPEND_CAP_USD'),
  };
}

function getScopedTotal(summary, provider, scope, keys) {
  const providerSummary = summary.providers[provider] || makeEmptyProviderSummary();
  if (scope === 'lifetime') {
    return roundUsd(providerSummary.lifetime_usd || 0);
  }

  return roundUsd(providerSummary.by_month?.[keys.month]?.usd || 0);
}

function printSpendLine(provider, scope, currentUsd, budgetUsd, capUsd) {
  const scopeLabel = scope === 'lifetime' ? 'lifetime' : 'month';
  const budgetPart = budgetUsd == null ? 'budget unset' : `budget ${formatUsd(budgetUsd)}`;
  const capPart = capUsd == null ? 'cap unset' : `cap ${formatUsd(capUsd)}`;
  console.log(`  [spend] ${provider} ${scopeLabel} total ${formatUsd(currentUsd)} | ${budgetPart} | ${capPart}`);
}

function resolveTextPricing(model) {
  return XAI_PRICING.textModels[model] || null;
}

function resolveImagePricing(model) {
  return XAI_PRICING.imageModels[model] || null;
}

function resolveVideoPricing(model) {
  return XAI_PRICING.videoModels[model] || null;
}

function estimateMessageTokens(messages = []) {
  const text = messages
    .map((message) => {
      const content = Array.isArray(message?.content)
        ? JSON.stringify(message.content)
        : String(message?.content || '');
      return `${message?.role || 'user'}:${content}`;
    })
    .join('\n');

  return Math.max(1, Math.ceil(text.length / 4) + (messages.length * 6));
}

function usageCachedPromptTokens(usage = {}) {
  return Number(
    usage?.prompt_tokens_details?.cached_tokens
    || usage?.input_tokens_details?.cached_tokens
    || 0
  ) || 0;
}

export function getApiSpendPaths() {
  return {
    trackingDir: TRACKING_DIR,
    eventsPath: EVENTS_PATH,
    summaryPath: SUMMARY_PATH,
  };
}

export function readApiSpendSummary() {
  const summary = loadSummary();
  const xaiConfig = getConfigForProvider('xai');
  return {
    ...summary,
    config: {
      xai: xaiConfig,
    },
  };
}

export function assertSpendWithinLimit({ provider = 'xai', projectedCostUsd = 0, operation = 'unknown', model = null } = {}) {
  const summary = loadSummary();
  const config = getConfigForProvider(provider);
  const keys = todayKeys();
  const currentScopedUsd = getScopedTotal(summary, provider, config.scope, keys);
  const projectedScopedUsd = roundUsd(currentScopedUsd + projectedCostUsd);

  if (config.budgetUsd != null && projectedCostUsd > 0 && projectedScopedUsd > config.budgetUsd) {
    console.warn(
      `  [spend] ${provider} ${operation}${model ? ` (${model})` : ''} would cross the ${config.scope} budget `
      + `(${formatUsd(projectedScopedUsd)} > ${formatUsd(config.budgetUsd)}).`
    );
  }

  if (config.capUsd != null && projectedCostUsd > 0 && projectedScopedUsd > config.capUsd) {
    throw new Error(
      `Projected ${provider} spend for ${operation}${model ? ` (${model})` : ''} would exceed the ${config.scope} cap `
      + `(${formatUsd(projectedScopedUsd)} > ${formatUsd(config.capUsd)}).`
    );
  }

  return {
    scope: config.scope,
    currentScopedUsd,
    projectedScopedUsd,
    budgetUsd: config.budgetUsd,
    capUsd: config.capUsd,
  };
}

export function recordApiSpend({
  provider = 'xai',
  operation,
  model,
  costUsd = 0,
  estimatedCostUsd = null,
  metadata = {},
} = {}) {
  const now = new Date();
  const keys = todayKeys(now);
  const event = {
    timestamp: now.toISOString(),
    day_key: keys.day,
    month_key: keys.month,
    provider,
    operation,
    model: model || 'unknown',
    cost_usd: roundUsd(costUsd),
    estimated_cost_usd: roundUsd(estimatedCostUsd ?? costUsd ?? 0),
    metadata,
  };

  appendEvent(event);
  const summary = loadSummary();
  applyEventToSummary(summary, event);
  writeSummary(summary);

  const config = getConfigForProvider(provider);
  const currentScopedUsd = getScopedTotal(summary, provider, config.scope, keys);
  printSpendLine(provider, config.scope, currentScopedUsd, config.budgetUsd, config.capUsd);

  return event;
}

export function estimateXaiImageCost({
  model = 'grok-imagine-image',
  imageCount = 1,
  inputImageCount = 0,
} = {}) {
  const pricing = resolveImagePricing(model);
  if (!pricing) {
    return null;
  }

  return roundUsd(
    (Number(imageCount) || 1) * pricing.outputUsdPerImage
    + (Number(inputImageCount) || 0) * pricing.inputUsdPerImage
  );
}

export function estimateXaiVideoCost({
  model = 'grok-imagine-video',
  durationSeconds = 6,
  resolution = '720p',
  inputImageCount = 0,
  inputVideoSeconds = 0,
} = {}) {
  const pricing = resolveVideoPricing(model);
  if (!pricing) {
    return null;
  }

  const normalizedDuration = Number(durationSeconds) || 0;
  const perSecondUsd = normalizeResolutionLabel(resolution) === '1080p'
    ? pricing.outputUsdPerSecond1080p
    : pricing.outputUsdPerSecond720p;

  return roundUsd(
    (normalizedDuration * perSecondUsd)
    + ((Number(inputImageCount) || 0) * pricing.inputUsdPerImage)
    + ((Number(inputVideoSeconds) || 0) * pricing.inputUsdPerVideoSecond)
  );
}

export function estimateXaiChatCompletionCost({
  model,
  usage = {},
  fallbackPromptTokens = 0,
  fallbackCompletionTokens = 0,
} = {}) {
  const pricing = resolveTextPricing(model);
  if (!pricing) {
    return null;
  }

  const promptTokens = Number(usage?.prompt_tokens) || Number(fallbackPromptTokens) || 0;
  const completionTokens = Number(usage?.completion_tokens) || Number(fallbackCompletionTokens) || 0;
  const cachedPromptTokens = usageCachedPromptTokens(usage);
  const uncachedPromptTokens = Math.max(0, promptTokens - cachedPromptTokens);

  return roundUsd(
    (uncachedPromptTokens / 1_000_000) * pricing.inputUsdPerMillionTokens
    + (cachedPromptTokens / 1_000_000) * pricing.cachedInputUsdPerMillionTokens
    + (completionTokens / 1_000_000) * pricing.outputUsdPerMillionTokens
  );
}

export function estimateXaiChatCompletionMaxCost({
  model,
  messages = [],
  maxTokens = 0,
} = {}) {
  const pricing = resolveTextPricing(model);
  if (!pricing) {
    return null;
  }

  const promptTokens = estimateMessageTokens(messages);
  return roundUsd(
    (promptTokens / 1_000_000) * pricing.inputUsdPerMillionTokens
    + ((Number(maxTokens) || 0) / 1_000_000) * pricing.outputUsdPerMillionTokens
  );
}

export function extractXaiChatUsageMetadata(responseData = {}) {
  const usage = responseData?.usage || {};
  return {
    prompt_tokens: Number(usage?.prompt_tokens) || 0,
    completion_tokens: Number(usage?.completion_tokens) || 0,
    total_tokens: Number(usage?.total_tokens) || 0,
    cached_prompt_tokens: usageCachedPromptTokens(usage),
  };
}

export function getXaiPricingSnapshot() {
  return {
    ...XAI_PRICING,
  };
}

export function nanosToUsd(nanos) {
  return roundUsd(Number(nanos || 0) / USD_NANOS);
}
