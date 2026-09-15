import type { RetailerSource } from './unified';

export interface CartItem {
  /** Unique ID for this cart entry */
  id: string;
  /** Emporika UnifiedProduct.id */
  productId: string;
  /** Shopify variant GID (gid://shopify/ProductVariant/{id}); absent for non-Shopify local items. */
  variantId?: string;
  /**
   * Grouping key. For Shopify this is the merchant's myshopify.com domain
   * (used for Cart/Checkout MCP); for other retailers it is the retailer id.
   */
  shopDomain: string;
  /** Display name of the merchant/retailer */
  merchantName: string;
  /** Product title */
  title: string;
  /** Price in dollars */
  price: number;
  /** Product image URL */
  image: string;
  /** Quantity */
  quantity: number;
  /** ISO 4217 currency code */
  currency: string;
  /** Handoff URL: Cart MCP continue_url (Shopify) or the product page (others). */
  continueUrl: string;
  /** Cart MCP cart ID (Shopify only) */
  cartId?: string;
  /** Retailer source. Defaults to 'shopify' when absent (legacy items). */
  source: RetailerSource;
  /** Unix timestamp when item was added */
  addedAt: number;
}

export interface CartContextType {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'id' | 'addedAt'>) => void;
  updateItem: (id: string, patch: Partial<Omit<CartItem, 'id' | 'addedAt'>>) => void;
  removeItem: (id: string) => void;
  removeMerchantItems: (shopDomain: string) => void;
  clearCart: () => void;
  itemCount: number;
  /** Items grouped by merchant domain / retailer */
  itemsByMerchant: Record<string, CartItem[]>;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}
