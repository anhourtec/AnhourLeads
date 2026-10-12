import type { FoundTechnology } from "./types";

/**
 * Technology fingerprints from public page markup and response headers. Each rule names the
 * technology, a category and the evidence that matched, so the finding is checkable.
 */
interface Fingerprint {
  name: string;
  category: string;
  /** Matched against script src, link href and inline markup. */
  html?: RegExp;
  /** Matched against `<meta name="generator">`. */
  generator?: RegExp;
  /** Header name → value pattern. */
  header?: [string, RegExp];
}

const FINGERPRINTS: Fingerprint[] = [
  {
    name: "Google Analytics",
    category: "Analytics",
    html: /googletagmanager\.com\/gtag\/js|google-analytics\.com\/(?:analytics|ga)\.js/i,
  },
  { name: "Google Tag Manager", category: "Tag manager", html: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/ },
  {
    name: "HubSpot",
    category: "Marketing automation",
    html: /js\.hs-scripts\.com|js\.hsforms\.net|js\.hs-analytics\.net|hs-banner\.com/i,
  },
  { name: "Segment", category: "Customer data", html: /cdn\.segment\.(?:com|io)\/analytics\.js/i },
  { name: "Intercom", category: "Live chat", html: /widget\.intercom\.io|js\.intercomcdn\.com/i },
  { name: "Drift", category: "Live chat", html: /js\.driftt\.com/i },
  { name: "Zendesk", category: "Support", html: /static\.zdassets\.com|zopim/i },
  { name: "Crisp", category: "Live chat", html: /client\.crisp\.chat/i },
  { name: "Stripe", category: "Payments", html: /js\.stripe\.com/i },
  {
    name: "Shopify",
    category: "E-commerce",
    html: /cdn\.shopify\.com|Shopify\.theme/,
    header: ["x-shopify-stage", /./],
  },
  { name: "WordPress", category: "CMS", html: /\/wp-content\/|\/wp-includes\//i, generator: /wordpress/i },
  {
    name: "Webflow",
    category: "CMS",
    html: /assets\.website-files\.com|webflow\.js|data-wf-site/i,
    generator: /webflow/i,
  },
  { name: "Wix", category: "CMS", html: /static\.wixstatic\.com/i, generator: /wix\.com/i },
  { name: "Squarespace", category: "CMS", html: /static1\.squarespace\.com/i, generator: /squarespace/i },
  { name: "Ghost", category: "CMS", generator: /ghost/i },
  { name: "Drupal", category: "CMS", html: /\/sites\/default\/files\//i, generator: /drupal/i },
  { name: "Hugo", category: "Static site generator", generator: /hugo/i },
  { name: "Gatsby", category: "JavaScript framework", html: /id=["']___gatsby["']/i, generator: /gatsby/i },
  {
    name: "Next.js",
    category: "JavaScript framework",
    html: /\/_next\/static\/|id=["']__next["']|__NEXT_DATA__/,
    header: ["x-powered-by", /next\.js/i],
  },
  { name: "Nuxt", category: "JavaScript framework", html: /\/_nuxt\/|window\.__NUXT__/ },
  {
    name: "React",
    category: "JavaScript library",
    html: /\/_next\/static\/|data-reactroot|react(?:\.production)?(?:\.min)?\.js|react-dom/i,
  },
  {
    name: "Vue.js",
    category: "JavaScript library",
    html: /vue(?:\.runtime)?(?:\.global)?(?:\.prod)?(?:\.min)?\.js|data-v-[0-9a-f]{8}/i,
  },
  { name: "Angular", category: "JavaScript framework", html: /ng-version=/i },
  { name: "jQuery", category: "JavaScript library", html: /jquery(?:-\d[\d.]*)?(?:\.min)?\.js/i },
  { name: "Bootstrap", category: "UI framework", html: /bootstrap(?:\.bundle)?(?:\.min)?\.(?:css|js)/i },
  { name: "Cloudflare", category: "CDN", html: /\/cdn-cgi\//i, header: ["server", /cloudflare/i] },
  { name: "Vercel", category: "Hosting", header: ["x-vercel-id", /./] },
  { name: "Netlify", category: "Hosting", header: ["server", /netlify/i] },
  { name: "Amazon CloudFront", category: "CDN", header: ["via", /cloudfront/i] },
  { name: "Fastly", category: "CDN", header: ["x-served-by", /cache-/i] },
  { name: "Nginx", category: "Web server", header: ["server", /nginx/i] },
  { name: "Hotjar", category: "Analytics", html: /static\.hotjar\.com/i },
  { name: "Mixpanel", category: "Analytics", html: /cdn\.mxpnl\.com|mixpanel\.init\(/i },
  { name: "Plausible", category: "Analytics", html: /plausible\.io\/js/i },
  { name: "Meta Pixel", category: "Advertising", html: /connect\.facebook\.net\/[^"']*\/fbevents\.js/i },
  { name: "LinkedIn Insight", category: "Advertising", html: /snap\.licdn\.com/i },
  { name: "Google reCAPTCHA", category: "Security", html: /google\.com\/recaptcha|recaptcha\/api\.js/i },
  { name: "Sentry", category: "Monitoring", html: /browser\.sentry-cdn\.com|sentry\.io\/api/i },
  { name: "Calendly", category: "Scheduling", html: /assets\.calendly\.com/i },
  { name: "Marketo", category: "Marketing automation", html: /munchkin\.marketo\.net/i },
  { name: "Salesforce Pardot", category: "Marketing automation", html: /pi\.pardot\.com/i },
  { name: "Mailchimp", category: "Email marketing", html: /chimpstatic\.com|list-manage\.com/i },
  { name: "Tailwind CSS", category: "UI framework", html: /cdn\.tailwindcss\.com|tailwind(?:\.min)?\.css/i },
];

function evidenceFor(re: RegExp, haystack: string): string | null {
  const m = haystack.match(re);
  return m ? m[0].slice(0, 80) : null;
}

/** Fingerprint scripts, stylesheets, inline markers, generator meta and headers. */
export function technologiesFrom(
  html: string,
  headers: Partial<Record<string, string>>,
  sourceUrl: string,
): FoundTechnology[] {
  const generator = html.match(/<meta\b[^>]*name=["']generator["'][^>]*content=["']([^"']+)["']/i)?.[1] ?? "";
  const found: FoundTechnology[] = [];
  for (const fp of FINGERPRINTS) {
    let evidence: string | null = null;
    if (fp.generator && generator && fp.generator.test(generator)) evidence = `generator: ${generator.slice(0, 60)}`;
    if (!evidence && fp.html) evidence = evidenceFor(fp.html, html);
    if (!evidence && fp.header) {
      const value = headers[fp.header[0]];
      if (value && fp.header[1].test(value)) evidence = `${fp.header[0]}: ${value.slice(0, 60)}`;
    }
    if (evidence) found.push({ name: fp.name, category: fp.category, evidence, sourceUrl });
  }
  return found;
}
