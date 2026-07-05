/**
 * UI-chrome translations + the t() lookup that powers the page language toggle.
 *
 * English is the base and the guaranteed fallback. A starter set of major
 * languages (es/fr/de/pt/it/nl) is seeded for the high-visibility chrome; any
 * missing (key, language) pair falls back to English. The heaviest localization —
 * the AI bulletin and the news headlines themselves — is carried in-language by
 * the summary and news pipelines, so an un-seeded language still reads mostly
 * native with English chrome.
 *
 * Keys use {braces} for interpolation, filled from the params arg to t().
 */

type Dict = Record<string, string>;

// key → { lang → text }. 'en' is required on every key.
const STRINGS: Record<string, Dict> = {
  "cmd.locate": { en: "guest@tty:~$ locate", es: "guest@tty:~$ localizar", fr: "guest@tty:~$ localiser", de: "guest@tty:~$ orten", pt: "guest@tty:~$ localizar", it: "guest@tty:~$ localizza", nl: "guest@tty:~$ zoek" },
  "form.placeholder": { en: "postal code or city", es: "código postal o ciudad", fr: "code postal ou ville", de: "Postleitzahl oder Stadt", pt: "código postal ou cidade", it: "codice postale o città", nl: "postcode of stad" },
  "form.enter": { en: "Enter", es: "Ir", fr: "OK", de: "Los", pt: "Ir", it: "Vai", nl: "Ga" },
  "form.aria": { en: "Enter a postal code or a city and country", es: "Introduce un código postal o una ciudad y país", fr: "Saisissez un code postal ou une ville et un pays", de: "Postleitzahl oder Stadt und Land eingeben", pt: "Introduza um código postal ou cidade e país", it: "Inserisci un codice postale o città e paese", nl: "Voer een postcode of stad en land in" },

  "tagline.zip": { en: "What's happening around {place} right now", es: "Qué está pasando cerca de {place} ahora mismo", fr: "Ce qui se passe autour de {place} en ce moment", de: "Was gerade rund um {place} passiert", pt: "O que está a acontecer perto de {place} agora", it: "Cosa succede intorno a {place} in questo momento", nl: "Wat er nu rond {place} gebeurt" },
  "glance.localTime": { en: "LOCAL TIME", es: "HORA LOCAL", fr: "HEURE LOCALE", de: "ORTSZEIT", pt: "HORA LOCAL", it: "ORA LOCALE", nl: "LOKALE TIJD" },
  "glance.feels": { en: "FEELS", es: "SENS", fr: "RESSENTI", de: "GEFÜHLT", pt: "SENS", it: "PERCEP", nl: "VOELT" },
  "glance.wind": { en: "WIND", es: "VIENTO", fr: "VENT", de: "WIND", pt: "VENTO", it: "VENTO", nl: "WIND" },
  "glance.humid": { en: "HUMID", es: "HUMEDAD", fr: "HUMID", de: "FEUCHTE", pt: "HUMID", it: "UMID", nl: "VOCHT" },

  "panel.forecast10": { en: "10-DAY FORECAST", es: "PRONÓSTICO 10 DÍAS", fr: "PRÉVISIONS 10 JOURS", de: "10-TAGE-PROGNOSE", pt: "PREVISÃO 10 DIAS", it: "PREVISIONI 10 GIORNI", nl: "10-DAAGSE VERWACHTING" },
  "panel.forecast": { en: "FORECAST", es: "PRONÓSTICO", fr: "PRÉVISIONS", de: "PROGNOSE", pt: "PREVISÃO", it: "PREVISIONI", nl: "VERWACHTING" },
  "panel.stories": { en: "TOP STORIES", es: "TITULARES", fr: "À LA UNE", de: "SCHLAGZEILEN", pt: "MANCHETES", it: "IN PRIMO PIANO", nl: "HEADLINES" },
  "panel.bulletin": { en: "BULLETIN", es: "BOLETÍN", fr: "BULLETIN", de: "BULLETIN", pt: "BOLETIM", it: "BOLLETTINO", nl: "BULLETIN" },
  "panel.aqi": { en: "AIR QUALITY", es: "CALIDAD DEL AIRE", fr: "QUALITÉ DE L'AIR", de: "LUFTQUALITÄT", pt: "QUALIDADE DO AR", it: "QUALITÀ DELL'ARIA", nl: "LUCHTKWALITEIT" },
  "panel.pollen": { en: "POLLEN", es: "POLEN", fr: "POLLEN", de: "POLLEN", pt: "PÓLEN", it: "POLLINE", nl: "POLLEN" },
  "panel.places": { en: "FOOD & DRINK NEARBY", es: "COMER Y BEBER CERCA", fr: "MANGER & BOIRE À PROXIMITÉ", de: "ESSEN & TRINKEN IN DER NÄHE", pt: "COMER E BEBER PERTO", it: "MANGIARE E BERE NELLE VICINANZE", nl: "ETEN & DRINKEN IN DE BUURT" },
  "panel.parks": { en: "PARKS", es: "PARQUES", fr: "PARCS", de: "PARKS", pt: "PARQUES", it: "PARCHI", nl: "PARKEN" },
  "panel.camps": { en: "CAMPGROUNDS", es: "CAMPINGS", fr: "CAMPINGS", de: "CAMPINGPLÄTZE", pt: "PARQUES DE CAMPISMO", it: "CAMPEGGI", nl: "CAMPINGS" },
  "panel.events": { en: "UPCOMING EVENTS", es: "PRÓXIMOS EVENTOS", fr: "ÉVÉNEMENTS À VENIR", de: "KOMMENDE VERANSTALTUNGEN", pt: "PRÓXIMOS EVENTOS", it: "PROSSIMI EVENTI", nl: "AANKOMENDE EVENEMENTEN" },
  "panel.quakes": { en: "SEISMIC", es: "SÍSMICA", fr: "SISMIQUE", de: "SEISMIK", pt: "SÍSMICA", it: "SISMICA", nl: "SEISMISCH" },
  "panel.nearby": { en: "NEARBY", es: "CERCA", fr: "À PROXIMITÉ", de: "IN DER NÄHE", pt: "PERTO", it: "NELLE VICINANZE", nl: "IN DE BUURT" },
  "panel.scores": { en: "LOCAL SCORES", es: "RESULTADOS LOCALES", fr: "SCORES LOCAUX", de: "LOKALE ERGEBNISSE", pt: "RESULTADOS LOCAIS", it: "RISULTATI LOCALI", nl: "LOKALE UITSLAGEN" },
  "panel.election": { en: "ELECTION", es: "ELECCIONES", fr: "ÉLECTION", de: "WAHL", pt: "ELEIÇÃO", it: "ELEZIONI", nl: "VERKIEZING" },

  "news.note": { en: "ranked by local significance + cross-source pickup · freshness-weighted", es: "ordenadas por relevancia local + cobertura de varias fuentes · ponderadas por actualidad", fr: "classées par importance locale + reprise multi-sources · pondérées par fraîcheur", de: "nach lokaler Relevanz + Mehrquellen-Aufnahme sortiert · nach Aktualität gewichtet", pt: "ordenadas por relevância local + cobertura de várias fontes · ponderadas por atualidade", it: "ordinate per rilevanza locale + ripresa multi-fonte · pesate per freschezza", nl: "gerangschikt op lokaal belang + meerdere bronnen · gewogen op actualiteit" },
  "news.empty": { en: "0 STORIES FOUND", es: "0 NOTICIAS", fr: "0 ARTICLE", de: "0 MELDUNGEN", pt: "0 NOTÍCIAS", it: "0 NOTIZIE", nl: "0 ARTIKELEN" },
  "empty.noData": { en: "NO DATA - {msg}", es: "SIN DATOS - {msg}", fr: "AUCUNE DONNÉE - {msg}", de: "KEINE DATEN - {msg}", pt: "SEM DADOS - {msg}", it: "NESSUN DATO - {msg}", nl: "GEEN DATA - {msg}" },

  "footer.lastRefresh": { en: "LAST REFRESH", es: "ÚLTIMA ACTUALIZACIÓN", fr: "DERNIÈRE MAJ", de: "LETZTE AKTUALISIERUNG", pt: "ÚLTIMA ATUALIZAÇÃO", it: "ULTIMO AGGIORNAMENTO", nl: "LAATSTE UPDATE" },
  "footer.browse": { en: "BROWSE:", es: "EXPLORAR:", fr: "PARCOURIR :", de: "DURCHSUCHEN:", pt: "EXPLORAR:", it: "SFOGLIA:", nl: "BLADEREN:" },

  "election.upcoming": { en: "UPCOMING", es: "PRÓXIMA", fr: "À VENIR", de: "BEVORSTEHEND", pt: "PRÓXIMA", it: "IN ARRIVO", nl: "AANKOMEND" },
  "election.register": { en: "REGISTER", es: "REGISTRARSE", fr: "S'INSCRIRE", de: "REGISTRIEREN", pt: "REGISTAR", it: "REGISTRATI", nl: "REGISTREREN" },
  "election.polling": { en: "FIND POLLING", es: "COLEGIO ELECTORAL", fr: "BUREAU DE VOTE", de: "WAHLLOKAL", pt: "LOCAL DE VOTO", it: "SEGGIO", nl: "STEMLOKAAL" },
  "election.ballot": { en: "YOUR BALLOT", es: "TU PAPELETA", fr: "VOTRE BULLETIN", de: "IHR STIMMZETTEL", pt: "O SEU BOLETIM", it: "LA TUA SCHEDA", nl: "UW STEMBILJET" },

  "toggle.units": { en: "UNITS", es: "UNIDADES", fr: "UNITÉS", de: "EINHEITEN", pt: "UNIDADES", it: "UNITÀ", nl: "EENHEDEN" },
  "toggle.lang": { en: "LANG", es: "IDIOMA", fr: "LANGUE", de: "SPRACHE", pt: "IDIOMA", it: "LINGUA", nl: "TAAL" },

  "hero.msg": { en: "Live local news · weather · happenings — for any city on Earth", es: "Noticias locales · tiempo · eventos en directo — para cualquier ciudad del mundo", fr: "Actus locales · météo · événements en direct — pour n'importe quelle ville", de: "Lokale Nachrichten · Wetter · Ereignisse live — für jede Stadt der Welt", pt: "Notícias locais · tempo · eventos ao vivo — para qualquer cidade do mundo", it: "Notizie locali · meteo · eventi in diretta — per qualsiasi città del mondo", nl: "Lokaal nieuws · weer · gebeurtenissen live — voor elke stad ter wereld" },
  "hero.notFound": { en: '"{q}" NOT FOUND — TRY A POSTAL CODE OR "CITY, COUNTRY"', es: '"{q}" NO ENCONTRADO — PRUEBA UN CÓDIGO POSTAL O "CIUDAD, PAÍS"', fr: '"{q}" INTROUVABLE — ESSAYEZ UN CODE POSTAL OU "VILLE, PAYS"', de: '"{q}" NICHT GEFUNDEN — POSTLEITZAHL ODER "STADT, LAND" VERSUCHEN', pt: '"{q}" NÃO ENCONTRADO — TENTE UM CÓDIGO POSTAL OU "CIDADE, PAÍS"', it: '"{q}" NON TROVATO — PROVA UN CODICE POSTALE O "CITTÀ, PAESE"', nl: '"{q}" NIET GEVONDEN — PROBEER EEN POSTCODE OF "STAD, LAND"' },
  "hero.ready": { en: "READY.", es: "LISTO.", fr: "PRÊT.", de: "BEREIT.", pt: "PRONTO.", it: "PRONTO.", nl: "GEREED." },
};

// Native names for the language toggle (what a speaker of that language calls it).
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", es: "Español", fr: "Français", de: "Deutsch", pt: "Português", it: "Italiano",
  nl: "Nederlands", sv: "Svenska", no: "Norsk", da: "Dansk", fi: "Suomi", is: "Íslenska",
  pl: "Polski", cs: "Čeština", sk: "Slovenčina", hu: "Magyar", ro: "Română", bg: "Български",
  el: "Ελληνικά", hr: "Hrvatski", sr: "Српски", uk: "Українська", ru: "Русский", tr: "Türkçe",
  ar: "العربية", he: "עברית", ja: "日本語", zh: "中文", ko: "한국어", th: "ไทย", vi: "Tiếng Việt",
  id: "Bahasa Indonesia", ms: "Bahasa Melayu", hi: "हिन्दी", ur: "اردو", bn: "বাংলা", fa: "فارسی",
  ca: "Català", gl: "Galego", eu: "Euskara", ga: "Gaeilge", cy: "Cymraeg", af: "Afrikaans",
  sw: "Kiswahili", zu: "isiZulu", tl: "Filipino", lb: "Lëtzebuergesch", my: "မြန်မာ",
};

/** Right-to-left scripts — sets <html dir="rtl">. */
const RTL_LANGS = new Set(["ar", "he", "fa", "ur"]);
export function isRtl(lang: string): boolean {
  return RTL_LANGS.has(lang.split("-")[0]);
}

/** Native display name for a language code (falls back to the code). */
export function languageName(lang: string): string {
  return LANGUAGE_NAMES[lang.split("-")[0]] || lang.toUpperCase();
}

/**
 * Translate a key into `lang`, falling back to English then the raw key.
 * Fills {placeholders} from params.
 */
export function t(key: string, lang: string, params?: Record<string, string | number>): string {
  const entry = STRINGS[key];
  const base = lang.split("-")[0];
  let text = entry ? entry[base] ?? entry.en : key;
  if (params) {
    text = text.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
  }
  return text;
}

/** A bound translator for a fixed language — handy to pass into templates. */
export type Translator = (key: string, params?: Record<string, string | number>) => string;
export function translator(lang: string): Translator {
  return (key, params) => t(key, lang, params);
}
