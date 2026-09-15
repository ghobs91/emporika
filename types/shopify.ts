// Shopify Global Catalog MCP API Types
// Based on: https://shopify.dev/docs/agents/catalog/global-catalog

// ── Search / Lookup response ──────────────────────────────────────────

export interface ShopifySearchResponse {
  ucp: ShopifyUCPMetadata;
  products: ShopifyProduct[];
  pagination: ShopifyPagination;
}

export interface ShopifyLookupResponse {
  ucp: ShopifyUCPMetadata;
  products: ShopifyProduct[];
  messages?: ShopifyMessage[];
}

export interface ShopifyProductDetailResponse {
  ucp: ShopifyUCPMetadata;
  product: ShopifyProduct;
}

// ── UCP metadata ──────────────────────────────────────────────────────

export interface ShopifyUCPMetadata {
  version: string;
  capabilities: Record<string, Array<{ version: string }>>;
  /** Forwarded business rules for the next request (UCP Request Constraints). Opaque to us — passed through to callers. */
  request_constraints?: unknown;
  payment_handlers?: Record<string, unknown>;
}

export interface ShopifyPagination {
  cursor: string;
  has_next_page: boolean;
  total_count: number;
}

export interface ShopifyMessage {
  type: string;
  code: string;
  content: string;
  /** UCP error severity: recoverable | requires_buyer_input | requires_buyer_review (absent on older payloads). */
  severity?: string;
}

// ── Product ───────────────────────────────────────────────────────────

export interface ShopifyProduct {
  id: string; // gid://shopify/p/{UPID}
  title: string;
  description: {
    html?: string;
    plain?: string;
  };
  url?: string;
  categories?: ShopifyCategory[];
  price_range: {
    min: ShopifyMoney;
    max: ShopifyMoney;
  };
  media?: ShopifyMedia[];
  options?: ShopifyProductOption[];
  variants: ShopifyVariant[];
  rating?: ShopifyRating | null;
  selected?: ShopifySelectedOption[];
  // Extension fields
  inferred_fields?: string[];
  unique_selling_point?: string;
  top_features?: string[];
  tech_specs?: string[];
  shared_attributes?: ShopifyAttribute[];
}

export interface ShopifyCategory {
  value: string;
  taxonomy: string;
}

export interface ShopifyMoney {
  amount: number; // in minor units (cents)
  currency: string;
}

export interface ShopifyMedia {
  type: 'image' | string;
  url: string;
  alt_text?: string;
}

export interface ShopifyProductOption {
  name: string;
  values: ShopifyOptionValue[];
}

export interface ShopifyOptionValue {
  label: string;
  available?: boolean;
  exists?: boolean;
}

export interface ShopifySelectedOption {
  name: string;
  label: string;
}

// ── Variant ───────────────────────────────────────────────────────────

export interface ShopifyVariant {
  id: string; // gid://shopify/ProductVariant/{id}
  sku?: string;
  title: string;
  description?: {
    plain?: string;
  };
  url?: string; // product page URL
  price?: ShopifyMoney;
  checkout_url?: string;
  condition?: string[];
  eligible?: {
    native_checkout?: boolean;
  };
  availability?: {
    available: boolean;
    status: string;
    running_low?: boolean;
  };
  requires?: {
    shipping: boolean;
    selling_plan: boolean;
    components: boolean;
  };
  options: ShopifyVariantOption[];
  media?: ShopifyMedia[];
  rating?: ShopifyRating | null;
  tags?: string[];
  seller: ShopifySeller;
  inputs?: ShopifyInput[]; // present in lookup responses
}

export interface ShopifyVariantOption {
  name: string;
  label: string;
}

export interface ShopifyInput {
  id: string;
  match: string;
}

// ── Seller ────────────────────────────────────────────────────────────

export interface ShopifySeller {
  name: string;
  id: string; // gid://shopify/Shop/{id}
  domain?: string;
  url?: string;
  links?: ShopifySellerLink[];
}

export interface ShopifySellerLink {
  type: string;
  url: string;
}

// ── Rating ────────────────────────────────────────────────────────────

export interface ShopifyRating {
  value: number;
  scale_max: number;
  count: number;
}

// ── Attribute (for filters / shared attributes) ───────────────────────

export interface ShopifyAttribute {
  name: string;
  values: string[];
}

// ── Request parameter types ───────────────────────────────────────────

export interface ShopifySearchParams {
  query: string;
  context?: {
    address_country?: string;
    address_region?: string;
    postal_code?: string;
    language?: string;
    currency?: string;
    intent?: string;
  };
  filters?: ShopifySearchFilters;
  pagination?: {
    cursor?: string;
    limit?: number;
  };
  view?: string;
  saved_catalog_slug?: string;
}

export interface ShopifySearchFilters {
  available?: boolean;
  ships_to?: {
    country: string;
    region?: string;
    postal_code?: string;
  };
  ships_from?: Array<{ country: string }>;
  price?: {
    min?: number; // minor units (cents)
    max?: number;
  };
  condition?: string[];
  shops?: string[];
  attributes?: Array<{
    name: string;
    values: string[];
  }>;
  rating?: {
    variant?: {
      min?: number;
      min_count?: number;
    };
  };
  price_tier?: string[];
  categories?: Array<{
    id: string;
    taxonomy?: string;
  }>;
}

export interface ShopifyProductDetailsParams {
  id: string; // gid://shopify/p/{UPID} or gid://shopify/ProductVariant/{id}
  selected?: Array<{ name: string; label: string }>;
  preferences?: string[];
  filters?: {
    ships_to?: { country: string; region?: string; postal_code?: string };
    ships_from?: Array<{ country: string }>;
    available?: boolean;
    condition?: string[];
    shops?: string[];
  };
  context?: {
    address_country?: string;
    address_region?: string;
    postal_code?: string;
    language?: string;
    currency?: string;
    intent?: string;
  };
  view?: string;
}

export interface ShopifyLookupParams {
  ids: string[]; // 1–50 identifiers
  filters?: {
    ships_to?: { country: string; region?: string; postal_code?: string };
    ships_from?: Array<{ country: string }>;
    available?: boolean;
    condition?: string[];
    shops?: string[];
  };
  context?: {
    address_country?: string;
    address_region?: string;
    postal_code?: string;
    language?: string;
    currency?: string;
    intent?: string;
  };
  view?: string;
}

// ── Shared UCP cart/checkout context ───────────────────────────────────
// Localization/identity hints accepted by cart and checkout tools. `context`
// is a hint for pricing, availability, and currency — never authoritative
// for shipping (collect a shipping address through Checkout fulfillment).

export interface ShopifyContext {
  address_country?: string;
  address_region?: string;
  postal_code?: string;
  language?: string;
  currency?: string;
  intent?: string;
  eligibility?: string[];
}

/** Optional attribution metadata forwarded to the merchant with cart/checkout. */
export interface ShopifyAttribution {
  referring_domain?: string;
  click_id_tag?: string;
  click_id_value?: string;
  activity_id_tag?: string;
  activity_id_value?: string;
  utm_campaign?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_content?: string;
  utm_term?: string;
}

/** Optional buyer information for personalized estimates. */
export interface ShopifyBuyer {
  email?: string;
  phone_number?: string;
}

// ── Cart MCP ───────────────────────────────────────────────────────────
// Based on: https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp

export interface ShopifyCartLineItem {
  id?: string;
  item: {
    id: string; // gid://shopify/ProductVariant/{id}
    title?: string;
    price?: number;
    image_url?: string;
  };
  quantity: number;
  totals?: ShopifyCartTotal[];
}

export interface ShopifyCartTotal {
  type: 'subtotal' | 'total' | 'tax' | 'fulfillment' | 'items_discount' | string;
  amount: number; // minor units (cents)
  display_text: string;
}

export interface ShopifyCart {
  ucp: ShopifyUCPMetadata;
  id: string; // gid://shopify/Cart/{id}
  line_items: ShopifyCartLineItem[];
  currency?: string;
  totals: ShopifyCartTotal[];
  discounts?: { codes: string[]; applied: unknown[] };
  fulfillment?: { methods: unknown[] };
  attribution?: ShopifyAttribution;
  buyer?: ShopifyBuyer;
  messages: ShopifyMessage[];
  continue_url: string;
  expires_at?: string;
  links?: Array<{ type: string; title?: string; url: string }>;
}

export interface ShopifyCartResponse {
  cart: ShopifyCart;
}

export interface ShopifyCreateCartLineItem {
  variantId: string; // gid://shopify/ProductVariant/{id}
  quantity?: number;
}

export interface ShopifyCreateCartParams {
  /** Convenience: single variant ID (shortcut for lineItems with one entry) */
  variantId?: string;
  /** Single-item quantity (used with variantId) */
  quantity?: number;
  /** Multi-item cart: array of variant/quantity pairs */
  lineItems?: ShopifyCreateCartLineItem[];
  shopDomain: string; // e.g. "lulu-and-georgia.myshopify.com"
  context?: ShopifyContext;
  /** Optional attribution metadata (UTMs, click IDs) forwarded to the merchant. */
  attribution?: ShopifyAttribution;
  /** Optional buyer information for personalized estimates. */
  buyer?: ShopifyBuyer;
  /** Caller-provided idempotency key for safe retries (generated server-side if omitted). Sent as meta `idempotency-key`. */
  idempotencyKey?: string;
}

export interface ShopifyGetCartParams {
  shopDomain: string; // e.g. "lulu-and-georgia.myshopify.com"
  cartId: string; // gid://shopify/Cart/{id}
  idempotencyKey?: string;
}

export interface ShopifyUpdateCartParams {
  shopDomain: string;
  cartId: string; // gid://shopify/Cart/{id}
  /** Full replacement line items (PUT semantics — send the complete desired state, not a diff). */
  lineItems: ShopifyCreateCartLineItem[];
  context?: ShopifyContext;
  /** Resend attribution to preserve it — update_cart replaces the full cart state. */
  attribution?: ShopifyAttribution;
  buyer?: ShopifyBuyer;
  idempotencyKey?: string;
}

export interface ShopifyCancelCartParams {
  shopDomain: string;
  cartId: string; // gid://shopify/Cart/{id}
  idempotencyKey?: string;
}

// ── Checkout MCP ───────────────────────────────────────────────────────
// Based on: https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp
//
// Emporika uses Checkout MCP for the build + handoff flow: convert a Cart
// MCP cart into a checkout session (create_checkout with cart_id), optionally
// update it, and hand the buyer off via `continue_url`. `complete_checkout`
// requires a token permitted to complete purchases and is intentionally not
// part of this client.

export type ShopifyCheckoutStatus =
  | 'incomplete'
  | 'requires_escalation'
  | 'ready_for_complete'
  | 'complete_in_progress'
  | 'completed'
  | 'canceled'
  | string;

export interface ShopifyCheckoutLineItem extends ShopifyCartLineItem {
  available_quantity?: number;
}

export interface ShopifyCheckoutFulfillment {
  methods?: Array<{
    id?: string;
    type: string;
    line_item_ids?: string[];
    destinations?: ShopifyDestination[];
  }>;
}

export interface ShopifyDestination {
  first_name?: string;
  last_name?: string;
  street_address?: string;
  address_locality?: string;
  address_region?: string;
  postal_code?: string;
  address_country?: string;
}

/** Input checkout payload shared by create_checkout and update_checkout (PUT semantics). */
export interface ShopifyCheckoutInput {
  currency?: string;
  line_items?: ShopifyCreateCartLineItem[];
  buyer?: ShopifyBuyer;
  context?: ShopifyContext;
  attribution?: ShopifyAttribution;
  fulfillment?: ShopifyCheckoutFulfillment;
}

export interface ShopifyCheckout {
  ucp: ShopifyUCPMetadata;
  id: string; // gid://shopify/Checkout/{id}
  status: ShopifyCheckoutStatus;
  currency?: string;
  buyer?: ShopifyBuyer;
  line_items?: ShopifyCheckoutLineItem[];
  totals?: ShopifyCartTotal[];
  fulfillment?: ShopifyCheckoutFulfillment;
  links?: Array<{ type: string; title?: string; url: string }>;
  payment?: { instruments?: unknown[]; selected_instrument_id?: string };
  attribution?: ShopifyAttribution;
  messages?: ShopifyMessage[];
  continue_url?: string;
  expires_at?: string;
  order?: { id: string; permalink_url?: string };
}

export interface ShopifyCreateCheckoutParams {
  shopDomain: string;
  /** Optional Cart MCP cart id to convert into this checkout. When set, `checkout` is optional. */
  cartId?: string;
  /** Checkout payload. Required only when `cartId` is omitted. */
  checkout?: ShopifyCheckoutInput;
  idempotencyKey?: string;
}

export interface ShopifyGetCheckoutParams {
  shopDomain: string;
  checkoutId: string; // gid://shopify/Checkout/{id}
  idempotencyKey?: string;
}

export interface ShopifyUpdateCheckoutParams {
  shopDomain: string;
  checkoutId: string;
  /** Full replacement checkout state (PUT semantics — send the complete desired state). */
  checkout: ShopifyCheckoutInput;
  idempotencyKey?: string;
}

export interface ShopifyCancelCheckoutParams {
  shopDomain: string;
  checkoutId: string;
  idempotencyKey?: string;
}
