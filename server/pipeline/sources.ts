/**
 * Publications and institutions whose reporting may be published without a
 * human reading it first. Matching is by registered domain (and its
 * subdomains), so news.mongabay.com counts as mongabay.com.
 *
 * Be strict: a source that is not on this list is simply not eligible for
 * automatic publishing (a person can still publish it by hand). Add your own
 * with the EXTRA_TRUSTED_DOMAINS setting, comma separated.
 */
export const TRUSTED_DOMAINS: string[] = [
  // Constructive and general news
  'reasonstobecheerful.world', 'theguardian.com', 'goodnewsnetwork.org', 'positive.news', 'yesmagazine.org',
  'bbc.co.uk', 'bbc.com', 'npr.org', 'reuters.com', 'apnews.com', 'theconversation.com', 'smithsonianmag.com', 'nationalgeographic.com',
  // Science, health and environment reporting
  'nature.com', 'science.org', 'sciencedaily.com', 'scientificamerican.com', 'newscientist.com', 'thelancet.com', 'nejm.org', 'bmj.com',
  'mongabay.com', 'yale.edu', 'carbonbrief.org', 'ourworldindata.org',
  // Primary institutions
  'who.int', 'un.org', 'unicef.org', 'undp.org', 'worldbank.org', 'nih.gov', 'cdc.gov', 'nasa.gov', 'noaa.gov', 'esa.int',
]

export function trustedDomains(extra = ''): string[] {
  return [...TRUSTED_DOMAINS, ...extra.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)]
}

/** The host of a URL, lower-cased, without a leading www. Null if it is not a normal web address. */
export function hostOf(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    if (!host.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host === 'localhost') return null
    return host
  } catch {
    return null
  }
}

export const isTrusted = (url: string, domains: string[] = TRUSTED_DOMAINS): boolean => {
  const host = hostOf(url)
  return Boolean(host && domains.some((d) => host === d || host.endsWith(`.${d}`)))
}
