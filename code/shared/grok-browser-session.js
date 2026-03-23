import fs from 'fs';
import os from 'os';
import path from 'path';

export function parseCookieFile(rawJson) {
  const data = JSON.parse(rawJson);

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data.cookies)) {
    return data.cookies;
  }

  throw new Error('Unsupported cookies JSON format');
}

function normalizeSameSite(value) {
  if (!value) {
    return 'Lax';
  }

  const normalized = String(value).toLowerCase();
  if (normalized === 'strict') return 'Strict';
  if (normalized === 'none' || normalized === 'no_restriction') return 'None';
  return 'Lax';
}

function normalizeCookie(cookie) {
  const normalized = {
    name: cookie.name,
    value: String(cookie.value ?? ''),
    path: cookie.path || '/',
    httpOnly: Boolean(cookie.httpOnly),
    secure: Boolean(cookie.secure),
    sameSite: normalizeSameSite(cookie.sameSite)
  };

  if (cookie.url) {
    normalized.url = cookie.url;
  } else if (cookie.domain) {
    normalized.domain = cookie.domain;
  } else {
    normalized.domain = '.grok.com';
  }

  if (cookie.expires && Number(cookie.expires) > 0) {
    normalized.expires = Number(cookie.expires);
  }

  return normalized;
}

function shouldMirrorCookieToGrok(cookie) {
  const name = String(cookie.name || '');
  const mirroredNames = new Set([
    'auth_token',
    'ct0',
    'kdt',
    'twid',
    'gt',
    'guest_id',
    'guest_id_marketing',
    'guest_id_ads',
    'personalization_id',
    '__cf_bm'
  ]);

  return mirroredNames.has(name);
}

export function buildGrokCookieVariants(cookie) {
  const variants = [];
  const base = normalizeCookie(cookie);
  variants.push(base);

  const domain = String(cookie.domain || cookie.url || '').toLowerCase();
  const isXCookie = domain.includes('x.com') || domain.includes('twitter.com');

  if (isXCookie && shouldMirrorCookieToGrok(cookie)) {
    variants.push({
      ...base,
      domain: '.grok.com'
    });
    const urlVariant = {
      ...base,
      url: 'https://grok.com'
    };
    delete urlVariant.domain;
    delete urlVariant.path;
    variants.push(urlVariant);
  }

  return variants.map((item) => {
    const next = { ...item };
    if (!next.url && !next.domain) {
      next.domain = '.grok.com';
    }
    return next;
  });
}

export function loadStorageStateFile(statePath) {
  const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return {
    cookies: Array.isArray(parsed.cookies) ? parsed.cookies : [],
    origins: Array.isArray(parsed.origins) ? parsed.origins : []
  };
}

export async function applyStorageStateToContext(context, statePath) {
  if (!statePath || !fs.existsSync(statePath)) {
    return;
  }

  const state = loadStorageStateFile(statePath);

  if (state.cookies.length > 0) {
    await context.addCookies(state.cookies.flatMap(buildGrokCookieVariants));
  }

  if (state.origins.length > 0) {
    await context.addInitScript((origins) => {
      const match = origins.find((entry) => entry.origin === window.location.origin);
      if (!match) {
        return;
      }

      for (const item of match.localStorage || []) {
        try {
          window.localStorage.setItem(item.name, item.value);
        } catch {
          // Ignore localStorage quota/security issues.
        }
      }
    }, state.origins);
  }
}

export async function applyCookiesFileToContext(context, cookiesPath) {
  if (!cookiesPath || !fs.existsSync(cookiesPath)) {
    return;
  }

  const cookieObjects = parseCookieFile(fs.readFileSync(cookiesPath, 'utf8'));
  const cookies = cookieObjects.flatMap(buildGrokCookieVariants);
  await context.addCookies(cookies);
}

export function makeTempChromeProfileDir(prefix = 'grok-browser-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function isChromeProfileLockError(error) {
  const message = String(error?.message || error || '');
  return message.includes('ProcessSingleton') || message.includes('SingletonLock');
}
