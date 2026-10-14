'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTheme } = require('../lib/eagle-theme');

test('Eagle Auto on a dark system uses gray, matching the host', () => {
  assert.equal(resolveTheme('Auto', { systemDark: true }), 'gray');
  assert.equal(resolveTheme('Auto', { systemDark: false }), 'light');
});
test('the actual inspector URL theme wins over startup API preferences', () => {
  assert.equal(resolveTheme('Auto', { initialTheme: 'gray', systemDark: true }), 'gray');
  assert.equal(resolveTheme('Auto', { initialTheme: 'gray', systemDark: false }), 'gray');
  assert.equal(resolveTheme('Auto', { initialTheme: 'lightgray', systemDark: true }), 'lightgray');
  assert.equal(resolveTheme('DARK', { initialTheme: 'light', systemDark: true }), 'light');
});
test('explicit themes remain authoritative during OS appearance changes', () => {
  for (const theme of ['LIGHT', 'lightgray', 'dark', 'GRAY', 'blue', 'purple']) {
    assert.equal(resolveTheme(theme, { systemDark: true }), theme.toLowerCase());
    assert.equal(resolveTheme(theme, { systemDark: false }), theme.toLowerCase());
  }
});
test('host theme objects resolve the effective css theme before preference name', () => {
  assert.equal(resolveTheme({ name: 'Auto', css: 'gray' }, { systemDark: false }), 'gray');
  assert.equal(resolveTheme({ name: 'Auto', css: 'auto' }, { systemDark: true }), 'gray');
  assert.equal(resolveTheme({ name: 'Light Gray' }), 'lightgray');
});
test('missing or unrecognized events preserve the last known host theme', () => {
  for (const value of [null, undefined, '', 'undefined', 'unknown']) assert.equal(resolveTheme(value, { previousTheme: 'purple', systemDark: false }), 'purple');
});
