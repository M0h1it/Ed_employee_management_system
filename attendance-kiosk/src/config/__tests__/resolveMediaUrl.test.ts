/**
 * resolveMediaUrl exists because the backend returns photoUrl as a path
 * relative to its own origin (see employee.photo_url in
 * app/api/v1/photos.py) — that only resolves automatically in a browser,
 * never in React Native's <Image>, which was the actual bug this fixes
 * (a photo that silently never appeared, no error, on the kiosk's greeting
 * screen). These cases were chosen directly from what real backend
 * responses and config values look like, not invented edge cases.
 */

import { config, resolveMediaUrl } from '../index';

describe('resolveMediaUrl', () => {
  const originalBaseUrl = config.apiBaseUrl;

  afterEach(() => {
    // config is a `const` object but its properties are not readonly at
    // the JS runtime level (only TypeScript's `as const` enforces that) —
    // tests mutate apiBaseUrl to exercise different origins, so it must be
    // restored after each one to avoid bleeding into the next test.
    (config as any).apiBaseUrl = originalBaseUrl;
  });

  it('returns null for a null path', () => {
    expect(resolveMediaUrl(null)).toBeNull();
  });

  it('prefixes a relative path with the server origin, stripping /api/v1', () => {
    (config as any).apiBaseUrl = 'https://kiosk.example.com/api/v1';
    expect(resolveMediaUrl('/uploads/photos/abc.jpg')).toBe(
      'https://kiosk.example.com/uploads/photos/abc.jpg',
    );
  });

  it('works with the real dev config shape (http://127.0.0.1:8000/api/v1)', () => {
    (config as any).apiBaseUrl = 'http://127.0.0.1:8000/api/v1';
    expect(resolveMediaUrl('/uploads/punch_photos/xyz.jpg')).toBe(
      'http://127.0.0.1:8000/uploads/punch_photos/xyz.jpg',
    );
  });

  it('handles apiBaseUrl with a trailing slash before /api/v1 is stripped', () => {
    (config as any).apiBaseUrl = 'https://kiosk.example.com/api/v1/';
    expect(resolveMediaUrl('/uploads/photos/abc.jpg')).toBe(
      'https://kiosk.example.com/uploads/photos/abc.jpg',
    );
  });

  it('adds a separating slash if the path is missing its leading one', () => {
    (config as any).apiBaseUrl = 'https://kiosk.example.com/api/v1';
    expect(resolveMediaUrl('uploads/photos/abc.jpg')).toBe(
      'https://kiosk.example.com/uploads/photos/abc.jpg',
    );
  });

  it('passes an already-absolute URL through unchanged', () => {
    expect(resolveMediaUrl('https://cdn.example.com/photo.jpg')).toBe(
      'https://cdn.example.com/photo.jpg',
    );
    expect(resolveMediaUrl('http://cdn.example.com/photo.jpg')).toBe(
      'http://cdn.example.com/photo.jpg',
    );
  });
});