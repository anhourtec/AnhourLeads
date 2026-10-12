/**
 * Hosts the discovery crawler never fetches: social networks, walled gardens and other data
 * vendors. A company's link to its own public profile on one of these is stored as a plain URL
 * (linkedinUrl, twitterUrl…) and never followed. Pure, so it can be unit tested.
 *
 * Matching is by registrable suffix: "linkedin.com" also covers "www.linkedin.com" and
 * "uk.linkedin.com". Job boards that publish an official public API (Greenhouse, Lever, Ashby,
 * Workable) are not on this list; only their documented JSON APIs are read, never their pages.
 */
export const DENIED_HOSTS: readonly string[] = [
  // Social networks and walled gardens (content behind logins or terms that forbid crawling).
  "linkedin.com",
  "lnkd.in",
  "facebook.com",
  "fb.com",
  "fb.me",
  "instagram.com",
  "x.com",
  "twitter.com",
  "t.co",
  "tiktok.com",
  "threads.net",
  "snapchat.com",
  "pinterest.com",
  "reddit.com",
  "youtube.com",
  "youtu.be",
  "vk.com",
  "weibo.com",
  "xing.com",
  "medium.com",
  "quora.com",
  "discord.com",
  "discord.gg",
  "telegram.org",
  "t.me",
  "whatsapp.com",
  // Job sites and review sites (terms forbid automated collection).
  "glassdoor.com",
  "glassdoor.co.uk",
  "indeed.com",
  "monster.com",
  "ziprecruiter.com",
  "wellfound.com",
  "angel.co",
  "builtin.com",
  "g2.com",
  "capterra.com",
  "trustpilot.com",
  "yelp.com",
  // Data vendors and sales-intelligence platforms.
  "zoominfo.com",
  "apollo.io",
  "rocketreach.co",
  "crunchbase.com",
  "pitchbook.com",
  "lusha.com",
  "seamless.ai",
  "clearbit.com",
  "hunter.io",
  "dnb.com",
  "owler.com",
  "cbinsights.com",
  "signalhire.com",
  "contactout.com",
  "leadiq.com",
  "uplead.com",
  "snov.io",
  "kaspr.io",
];

const DENIED = new Set(DENIED_HOSTS);

/** True when the hostname (any case, optional port and trailing dot) is a denied host or a subdomain of one. */
export function isDeniedHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    if (DENIED.has(labels.slice(i).join("."))) return true;
  }
  return false;
}

/** True when the URL's host is denied. Unparseable URLs count as denied. */
export function isDeniedUrl(url: string | URL): boolean {
  try {
    return isDeniedHost(typeof url === "string" ? new URL(url).hostname : url.hostname);
  } catch {
    return true;
  }
}
