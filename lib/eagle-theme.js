(() => {
'use strict';

const THEMES = ['light', 'lightgray', 'dark', 'gray', 'blue', 'purple'];
function nameOf(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]/g, '');
}
function explicitTheme(value) {
  const candidates = value && typeof value === 'object' ? [value.css, value.name] : [value];
  return candidates.map(nameOf).find(name => THEMES.includes(name));
}
function resolveTheme(value, { initialTheme, previousTheme, systemDark = false } = {}) {
  // The inspector URL carries the actual rendered theme. app.theme can be "Auto".
  const initial = explicitTheme(initialTheme);
  if (initial) return initial;
  const explicit = explicitTheme(value);
  if (explicit) return explicit;
  const name = nameOf(value && typeof value === 'object' ? value.name || value.css : value);
  // Eagle's own Auto mode selects GRAY (not DARK) on a dark system.
  if (['auto', 'system', 'automatic'].includes(name)) return systemDark ? 'gray' : 'light';
  return explicitTheme(previousTheme) || (systemDark ? 'gray' : 'light');
}
const api = { explicitTheme, resolveTheme };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.eagleTheme = api;
})();
