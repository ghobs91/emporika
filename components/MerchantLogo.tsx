'use client';

import { useState } from 'react';
import Image from 'next/image';

interface MerchantLogoProps {
  /** Merchant storefront domain, e.g. "shop.myshopify.com". */
  domain?: string;
  alt: string;
  size?: number;
  className?: string;
}

/**
 * Merchant logo resolved from the storefront's favicon, falling back to the
 * Shopify mark when the domain is missing or the favicon fails to load.
 *
 * The favicon service is resolved server-side by the browser request (no API
 * key) and rendered with `unoptimized` so no `remotePatterns` entry is needed.
 */
export default function MerchantLogo({ domain, alt, size = 18, className }: MerchantLogoProps) {
  const [failed, setFailed] = useState(false);
  const cleanDomain = domain?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const src =
    !failed && cleanDomain
      ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(cleanDomain)}&sz=64`
      : '/shopify-logo.svg';

  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={className}
      unoptimized
      onError={() => setFailed(true)}
    />
  );
}
