/**
 * Build the static trend manifest from free publication feeds.
 *
 * Zero API keys, zero runtime cost: this runs once a week in GitHub Actions and
 * commits `public/data/trends.json`, which the browser fetches like any other
 * static asset. Nothing about a shopper is involved.
 *
 *   npx tsx scripts/fetch-trends.ts
 *   npx tsx scripts/fetch-trends.ts --limit 2 --verbose
 *
 * Every feed failure is recorded in the manifest (`sources`) rather than
 * thrown, because publishers rate-limit and block CI runners intermittently and
 * a partial manifest beats a broken build.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  TREND_SCHEMA_VERSION,
  aggregateTrends,
  type Headline,
} from './trend-extract';

interface FeedConfig {
  id: string;
  url: string;
  label: string;
  /** Cohort families this publication serves by default. */
  cohorts: string[];
  /** Cap per feed, to keep the run predictable. */
  maxItems?: number;
}

/**
 * Cohorts are gender × decade plus `teens`, `kids` and `unisex`.
 * `unisex` is the fallback the client reads when a recipient has no exact
 * cohort bucket.
 */
const FEEDS: FeedConfig[] = [
  {
    id: 'vogue',
    url: 'https://www.vogue.com/feed/rss',
    label: 'Vogue',
    // A style feed serves women, but does not tell us their age. Explicit
    // "in their 30s" language in a headline is what creates a decade bucket.
    cohorts: ['women'],
  },
  {
    id: 'gq',
    url: 'https://www.gq.com/feed/rss',
    label: 'GQ',
    cohorts: ['men'],
  },
  {
    id: 'allure',
    url: 'https://www.allure.com/feed/rss',
    label: 'Allure',
    cohorts: ['women'],
  },
  {
    id: 'bon-appetit',
    url: 'https://www.bonappetit.com/feed/rss',
    label: 'Bon Appétit',
    cohorts: ['unisex'],
  },
  {
    id: 'apartment-therapy',
    url: 'https://www.apartmenttherapy.com/main.rss',
    label: 'Apartment Therapy',
    cohorts: ['unisex'],
  },
  {
    id: 'the-verge',
    url: 'https://www.theverge.com/rss/index.xml',
    label: 'The Verge',
    cohorts: ['unisex'],
  },
  {
    id: 'engadget',
    url: 'https://www.engadget.com/rss.xml',
    label: 'Engadget',
    cohorts: ['unisex'],
  },
  {
    id: 'wired',
    url: 'https://www.wired.com/feed/rss',
    label: 'Wired',
    cohorts: ['unisex'],
    maxItems: 40,
  },
  {
    id: 'gizmodo',
    url: 'https://gizmodo.com/rss',
    label: 'Gizmodo',
    cohorts: ['unisex'],
  },
  {
    id: 'outside',
    url: 'https://www.outsideonline.com/feed/',
    label: 'Outside',
    cohorts: ['unisex'],
  },
  {
    id: 'lifehacker',
    url: 'https://lifehacker.com/rss',
    label: 'Lifehacker',
    cohorts: ['unisex'],
    maxItems: 40,
  },
  {
    id: 'teen-vogue',
    url: 'https://www.teenvogue.com/feed/rss',
    label: 'Teen Vogue',
    cohorts: ['teens'],
  },
  {
    id: 'popular-mechanics',
    url: 'https://www.popularmechanics.com/rss/',
    label: 'Popular Mechanics',
    cohorts: ['men', 'unisex'],
    maxItems: 40,
  },
];

const USER_AGENT = 'EmporikaTrendBot/1.0 (+https://github.com/ghobs91/emporika)';

interface Args {
  limit: number;
  verbose: boolean;
  out: string;
  maxAgeDays: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { limit: 0, verbose: false, out: 'public/data/trends.json', maxAgeDays: 45 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--limit') args.limit = Number.parseInt(argv[++i] ?? '0', 10);
    else if (arg === '--verbose') args.verbose = true;
    else if (arg === '--out') args.out = argv[++i] ?? args.out;
    else if (arg === '--max-age-days') args.maxAgeDays = Number.parseInt(argv[++i] ?? '45', 10);
  }
  return args;
}

// ── RSS / Atom parsing (regex, no dependencies) ────────────────────────

function decodeEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;/g, "'")
    .replace(/&#8211;|&ndash;/g, '-')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function unwrapCdata(value: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(value);
  return cdata ? cdata[1] : value;
}

function tagText(block: string, tags: string[]): string | undefined {
  for (const tag of tags) {
    const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
    if (match?.[1]) {
      const value = cleanTagValue(unwrapCdata(match[1]));
      if (value) return value;
    }
  }
  return undefined;
}

function cleanTagValue(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

interface ParsedItem {
  title: string;
  summary?: string;
  publishedAt?: string;
  link?: string;
}

export function parseFeed(xml: string, maxItems = 60): ParsedItem[] {
  const blocks = [
    ...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi),
  ].map((match) => match[1]);

  const items: ParsedItem[] = [];
  for (const block of blocks.slice(0, maxItems)) {
    const title = tagText(block, ['title']);
    if (!title) continue;
    items.push({
      title,
      summary: tagText(block, ['description', 'summary', 'content:encoded']),
      publishedAt: tagText(block, ['pubDate', 'published', 'updated', 'dc:date']),
      link: tagText(block, ['link', 'guid']),
    });
  }
  return items;
}

// ── Fetch ──────────────────────────────────────────────────────────────

interface SourceReport {
  id: string;
  label: string;
  url: string;
  status: 'ok' | 'failed';
  items: number;
  headlinesUsed: number;
  httpStatus?: number;
  durationMs: number;
  error?: string;
}

async function fetchFeed(feed: FeedConfig, timeoutMs: number): Promise<{ xml: string; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(feed.url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    return { xml, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

function isFresh(publishedAt: string | undefined, maxAgeDays: number, now: number): boolean {
  if (!publishedAt) return true; // undated items are kept; many feeds omit dates
  const timestamp = Date.parse(publishedAt);
  if (!Number.isFinite(timestamp)) return true;
  return now - timestamp <= maxAgeDays * 86_400_000;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = Date.now();
  const feeds = args.limit > 0 ? FEEDS.slice(0, args.limit) : FEEDS;

  console.log(`Fetching ${feeds.length} publication feed(s)…`);

  const headlines: Headline[] = [];
  const sources: SourceReport[] = [];

  for (const feed of feeds) {
    const started = Date.now();
    try {
      const { xml, status } = await fetchFeed(feed, 20_000);
      const items = parseFeed(xml, feed.maxItems ?? 60);
      const fresh = items.filter((item) => isFresh(item.publishedAt, args.maxAgeDays, now));

      for (const item of fresh) {
        headlines.push({
          title: item.title,
          summary: item.summary,
          publishedAt: item.publishedAt,
          feedCohorts: feed.cohorts,
        });
      }

      sources.push({
        id: feed.id,
        label: feed.label,
        url: feed.url,
        status: 'ok',
        items: items.length,
        headlinesUsed: fresh.length,
        httpStatus: status,
        durationMs: Date.now() - started,
      });
      console.log(`  ✓ ${feed.label}: ${fresh.length}/${items.length} headlines`);
    } catch (error) {
      sources.push({
        id: feed.id,
        label: feed.label,
        url: feed.url,
        status: 'failed',
        items: 0,
        headlinesUsed: 0,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      console.log(`  ✗ ${feed.label}: ${error instanceof Error ? error.message : 'failed'}`);
    }
  }

  const { cohorts, attribution } = aggregateTrends(headlines, {
    maxTermsPerBucket: 14,
    minScore: 1,
  });

  const manifest = {
    version: TREND_SCHEMA_VERSION,
    updatedAt: new Date(now).toISOString(),
    // Provenance, so the client (and a reader) can tell measured from assumed.
    methodology: {
      sources: 'public RSS/Atom feeds from lifestyle, style, tech and food publications',
      extraction: 'noun-phrase frequency over headlines, restricted to a product-noun lexicon',
      attribution:
        'explicit demographic language when present, otherwise the publication’s default cohorts (a feed prior, not a measurement)',
      cohortsWithExplicitAttribution: attribution.explicit,
      cohortsWithFeedPrior: attribution.feedPrior,
      minScore: 1,
      maxTermsPerBucket: 14,
    },
    sources,
    cohorts,
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(manifest, null, 2)}\n`);

  const cohortCount = Object.keys(cohorts).length;
  const termCount = Object.values(cohorts).reduce(
    (sum, categories) =>
      sum + Object.values(categories).reduce((inner, terms) => inner + terms.length, 0),
    0
  );

  console.log(
    `\nWrote ${args.out}: ${cohortCount} cohorts, ${termCount} terms from ${headlines.length} headlines`
  );

  if (args.verbose) {
    for (const [cohort, categories] of Object.entries(cohorts)) {
      console.log(`\n${cohort}`);
      for (const [category, terms] of Object.entries(categories)) {
        console.log(`  ${category}: ${terms.slice(0, 6).join(', ')}`);
      }
    }
  }

  const failed = sources.filter((source) => source.status === 'failed');
  if (failed.length === sources.length) {
    console.error('Every feed failed — not writing an empty manifest.');
    process.exit(1);
  }
  if (failed.length > 0) {
    console.warn(`\n${failed.length} feed(s) failed and were recorded in the manifest.`);
  }
}

if (process.argv[1]?.endsWith('fetch-trends.ts') || process.argv[1]?.endsWith('fetch-trends.js')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
