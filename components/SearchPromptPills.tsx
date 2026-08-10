'use client';

// ── Search prompt pills ─────────────────────────────────────────────────
//
// Breaks a natural-language search query into color-coded pills.
// Each pill can be removed to update the query and re-run search.

import { Tag, X } from 'lucide-react';

interface SearchPromptPillsProps {
  query: string;
  onChange?: (newQuery: string) => void;
}

interface ParsedPill {
  type: 'product' | 'quality' | 'price';
  label: string;
  term: string; // the raw term to remove from query
}

/** Simple heuristic extraction of product, qualities, and price from a query. */
function parseQuery(query: string): { product: string; qualities: string[]; price: string | null; pills: ParsedPill[] } {
  const lower = query.toLowerCase();

  // ── Extract price ────────────────────────────────────────────────────
  let price: string | null = null;
  let priceTerm = '';
  const underMatch = lower.match(/(?:under|below|less than|max|up to)\s*\$?(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  if (underMatch) {
    price = `Under $${underMatch[1]}`;
    priceTerm = underMatch[0];
  }

  const rangeMatch = lower.match(/\$(\d+(?:,\d{3})*)\s*[-–—to]+\s*\$?(\d+(?:,\d{3})*)/);
  if (rangeMatch) {
    price = `$${rangeMatch[1]} – $${rangeMatch[2]}`;
    priceTerm = rangeMatch[0];
  }

  // ── Quality / feature keywords ───────────────────────────────────────
  const qualityKeywords = [
    '4k', '1080p', 'hdr', 'oled', 'qled', 'hd', 'ultra hd',
    'bluetooth', 'wireless', 'wifi', 'wi-fi',
    'portable', 'compact', 'lightweight', 'foldable', 'collapsible',
    'rechargeable', 'waterproof', 'stainless steel', 'durable',
    'wide', 'narrow', 'extra wide',
    'trail', 'running', 'hiking', 'gaming', 'office', 'home',
    'low input lag', 'high refresh', 'noise cancel', 'noise cancelling',
    'streaming', 'smart', 'voice control',
    'easy returns', 'free returns', 'fast shipping', 'free shipping',
    'bright', 'living room', 'bedroom', 'outdoor', 'indoor',
    'ergonomic', 'adjustable',
    'organic', 'vegan', 'gluten-free',
    'granite', 'marble', 'travertine', 'stone', 'wood', 'metal', 'glass',
    'black', 'white', 'gray', 'blue', 'red', 'green',
    'large', 'small', 'medium',
  ];

  const foundQualities: { label: string; term: string }[] = [];
  const seen = new Set<string>();
  for (const kw of qualityKeywords) {
    if (lower.includes(kw) && !seen.has(kw)) {
      seen.add(kw);
      foundQualities.push({ label: kw.charAt(0).toUpperCase() + kw.slice(1), term: kw });
    }
  }

  // ── Extract product noun phrase ──────────────────────────────────────
  const fillerPattern = /\b(find|me|a|an|the|for|that|is|can|with|and|or|but|in|on|at|to|of|don't|do not|sacrifice|prioritize|prioritizing|looking for|searching for|i want|i need|show me|give me|please|thanks|thank you|best|top|good|great|excellent|recommend|suggest|should|would|could|will|without|losing)\b/gi;

  const withoutPrice = query
    .replace(new RegExp(priceTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
    .replace(/\$\d+(?:,\d{3})*\s*[-–—to]+\s*\$?\d+(?:,\d{3})*/gi, '');

  const cleaned = withoutPrice
    .replace(fillerPattern, '')
    .replace(/[,;:!?.]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const stopWords = new Set([
    ...qualityKeywords,
    'thats', 'that', 'which', 'with', 'under', 'over', 'between', 'around',
    'about', 'made', 'from', 'using', 'use', 'inch', 'inches',
    'feet', 'ft', '"', "'",
  ]);

  const words = cleaned.split(/\s+/).filter(w => w.length > 0);
  const productWords: string[] = [];
  for (const word of words) {
    const w = word.toLowerCase();
    if (stopWords.has(w)) break;
    if (/^\d+["']?$/.test(w)) break;
    if (productWords.length >= 4) break;
    productWords.push(word);
  }

  let product = productWords.join(' ');
  if (!product || product.length < 3) {
    const fallback = cleaned.split(/\s+/).filter(w => !stopWords.has(w.toLowerCase())).slice(0, 3).join(' ');
    product = fallback || cleaned.split(/\s+/).slice(0, 3).join(' ');
  }
  product = product.charAt(0).toUpperCase() + product.slice(1);

  // Build pills list
  const pills: ParsedPill[] = [];
  if (product) {
    pills.push({ type: 'product', label: product, term: productWords.join(' ') });
  }
  for (const q of foundQualities) {
    pills.push({ type: 'quality', label: q.label, term: q.term });
  }
  if (price) {
    pills.push({ type: 'price', label: price, term: priceTerm });
  }

  return { product, qualities: foundQualities.map(q => q.label), price, pills };
}

export default function SearchPromptPills({ query, onChange }: SearchPromptPillsProps) {
  if (!query) return null;

  const { pills } = parseQuery(query);
  if (pills.length === 0) return null;

  const handleRemove = (pill: ParsedPill) => {
    if (!onChange) return;

    // Remove the pill's term from the query
    let newQuery = query;

    if (pill.type === 'price') {
      // Remove price clause and surrounding words
      newQuery = query
        .replace(new RegExp(`\\b(?:under|below|less than|max|up to)\\s*\\$?${pill.term.replace(/[^0-9.]/g, '[^0-9.]*')}\\s*`, 'gi'), '')
        .replace(new RegExp(`\\s*\\$\\d+(?:,\\d{3})*\\s*[-–—to]+\\s*\\$?\\d+(?:,\\d{3})*\\s*`, 'gi'), ' ')
        .trim();
    } else {
      const escaped = pill.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      newQuery = query.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '').trim();
    }

    // Clean up extra punctuation/spaces
    newQuery = newQuery
      .replace(/\s*,\s*/g, ', ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.])/g, '$1')
      .replace(/[,;:!?.]+/g, match => match[0])
      .trim();

    // Avoid empty query
    onChange(newQuery || query);
  };

  const colors = {
    product: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800',
    quality: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800',
    price: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tag size={14} className="text-gray-400 dark:text-gray-500 shrink-0" />
      {pills.map((pill, i) => (
        <span
          key={`${pill.type}-${i}`}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-medium border ${colors[pill.type]} ${onChange ? 'group' : ''}`}
        >
          {pill.label}
          {onChange && (
            <button
              type="button"
              onClick={() => handleRemove(pill)}
              className="ml-0.5 p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              aria-label={`Remove ${pill.label}`}
            >
              <X size={12} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
