// All translations ship with the game; selecting a language never needs a network.
import en from './locales/en.js';
import de from './locales/de.js';
import fr from './locales/fr.js';
import es from './locales/es.js';
import it from './locales/it.js';
import pt from './locales/pt.js';
import nl from './locales/nl.js';
import pl from './locales/pl.js';
import tr from './locales/tr.js';
import ru from './locales/ru.js';
import uk from './locales/uk.js';
import ar from './locales/ar.js';
import hi from './locales/hi.js';
import id from './locales/id.js';
import ja from './locales/ja.js';
import ko from './locales/ko.js';
import zhHans from './locales/zh-Hans.js';
import zhHant from './locales/zh-Hant.js';

export const LANGUAGES = {
  en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español',
  it: 'Italiano', pt: 'Português', nl: 'Nederlands', pl: 'Polski',
  tr: 'Türkçe', ru: 'Русский', uk: 'Українська', ar: 'العربية',
  hi: 'हिन्दी', id: 'Bahasa Indonesia', ja: '日本語', ko: '한국어',
  'zh-Hans': '简体中文', 'zh-Hant': '繁體中文',
};

const catalogs = { en, de, fr, es, it, pt, nl, pl, tr, ru, uk, ar, hi, id, ja, ko, 'zh-Hans': zhHans, 'zh-Hant': zhHant };
let language = 'en';
export let T = en;

/** Match device preferences in order, including regional and Chinese script tags. */
export function resolveLanguage(preferences) {
  for (const preference of preferences) {
    const parts = preference.toLowerCase().split('-');
    if (parts[0] === 'zh') {
      if (parts.includes('hant')) return 'zh-Hant';
      if (parts.includes('hans')) return 'zh-Hans';
      return parts.some((p) => ['tw', 'hk', 'mo'].includes(p)) ? 'zh-Hant' : 'zh-Hans';
    }
    if (Object.hasOwn(catalogs, parts[0])) return parts[0];
  }
  return 'en';
}

export function setLanguage(override, preferences = globalThis.navigator?.languages || [globalThis.navigator?.language || 'en']) {
  language = resolveLanguage(override ? [override] : preferences);
  T = { ...en, ...catalogs[language] };
  return language;
}

export function formatTime(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatNumber(n) {
  return new Intl.NumberFormat(language).format(n);
}
