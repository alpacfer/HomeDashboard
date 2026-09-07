import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeHour, reviveWeatherHours, validWeatherHours } from '../lib/weather.ts';
import { validPrecipitationGrid, DEFAULT_GRID } from '../lib/precipitation-grid.ts';
import {
  restorableWeek, resumeFactIndex, validStoredFactCursor, validStoredForecast, validStoredWeek, WEEK_RESTORE_MS,
} from '../lib/stored-shapes.ts';

// Device storage is an input like a provider: an older build may have left a
// different shape behind, and a reload must fetch afresh rather than crash.

const hour = { timestamp: 1, temperature: 10, cloud: 0.5, visibility: null, rain: 0, snow: 0, precipitation: 0 };

test('stored hours must be a non-empty list of finite fields; Infinity is allowed to have become null', () => {
  assert.equal(validWeatherHours([hour]), true);
  assert.equal(validWeatherHours([{ ...hour, visibility: 2000 }]), true);
  assert.equal(validWeatherHours([]), false);
  assert.equal(validWeatherHours(null), false);
  assert.equal(validWeatherHours([{ ...hour, temperature: 'warm' }]), false);
  assert.equal(validWeatherHours([{ ...hour, precipitation: undefined }]), false);
  assert.equal(validWeatherHours([hour, 7]), false);
});

test('a stored grid must match its own spec exactly', () => {
  const cells = DEFAULT_GRID.columns * DEFAULT_GRID.rows;
  const grid = { ...DEFAULT_GRID, frames: [{ timestamp: 1, cells: new Array(cells).fill(0) }], run: null, fetchedAt: 1 };
  assert.equal(validPrecipitationGrid(grid), true);
  assert.equal(validPrecipitationGrid({ ...grid, run: 1700000000000 }), true);
  assert.equal(validPrecipitationGrid({ ...grid, frames: [] }), false);
  assert.equal(validPrecipitationGrid({ ...grid, frames: [{ timestamp: 1, cells: new Array(cells - 1).fill(0) }] }), false);
  assert.equal(validPrecipitationGrid({ ...grid, frames: [{ timestamp: 1, cells: new Array(cells).fill('x') }] }), false);
  assert.equal(validPrecipitationGrid({ ...grid, run: 'latest' }), false);
  assert.equal(validPrecipitationGrid({ ...grid, bounds: { south: 1 } }), false);
  assert.equal(validPrecipitationGrid(null), false);
});

test('a stored forecast needs valid hours, a known provider and a time, or the reload fetches afresh', () => {
  const stored = { hours: [hour], source: 'DMI', updatedAt: 1_700_000_000_000 };
  assert.equal(validStoredForecast(stored), true);
  assert.equal(validStoredForecast({ ...stored, source: 'Yr' }), false);
  assert.equal(validStoredForecast({ ...stored, updatedAt: undefined }), false);
  assert.equal(validStoredForecast({ ...stored, hours: [] }), false);
  assert.equal(validStoredForecast('{}'), false);
  assert.equal(validStoredForecast(null), false);
});

test('a stored week names its provider and its time, and is not restored after a day', () => {
  const stored = { source: 'Open-Meteo', payload: { daily: {} }, updatedAt: 1_000 };
  assert.equal(validStoredWeek(stored), true);
  // The shape an earlier build wrote, without the time: fetch afresh.
  assert.equal(validStoredWeek({ source: 'Open-Meteo', payload: {} }), false);
  assert.equal(validStoredWeek({ ...stored, source: 'DMI' }), false);
  assert.equal(validStoredWeek({ ...stored, payload: undefined }), false);
  assert.equal(restorableWeek(stored, 1_000 + WEEK_RESTORE_MS), stored);
  assert.equal(restorableWeek(stored, 1_000 + WEEK_RESTORE_MS + 1), null);
  assert.equal(restorableWeek(null, 0), null);
});

test('the daily-fact cursor resumes only on the day it names, and only in range', () => {
  assert.equal(validStoredFactCursor({ date: '01-09', index: 3 }), true);
  assert.equal(validStoredFactCursor({ date: '1-9', index: 3 }), false);
  assert.equal(validStoredFactCursor({ date: '01-09', index: -1 }), false);
  assert.equal(validStoredFactCursor({ date: '01-09', index: 1.5 }), false);
  assert.equal(validStoredFactCursor('01-09:3'), false);
  assert.equal(resumeFactIndex({ date: '01-09', index: 3 }, '01-09', 5), 3);
  assert.equal(resumeFactIndex({ date: '01-08', index: 3 }, '01-09', 5), 0);
  assert.equal(resumeFactIndex({ date: '01-09', index: 5 }, '01-09', 5), 0);
  assert.equal(resumeFactIndex(null, '01-09', 5), 0);
});

test('a stored hour with no visibility limit is revived as clear, not read as fog', () => {
  // JSON turns Infinity into null, and null < 1000 is true in JavaScript.
  const [revived] = reviveWeatherHours(JSON.parse(JSON.stringify([{ ...hour, visibility: Infinity, cloud: 0.1 }])));
  assert.equal(revived.visibility, Infinity);
  assert.equal(describeHour(revived).kind, 'clear');
  assert.equal(reviveWeatherHours([{ ...hour, visibility: 400 }])[0].visibility, 400);
});
