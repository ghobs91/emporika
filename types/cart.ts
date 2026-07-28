export interface CartItem {
  /** Unique ID for this cart entry */
  id: string;
  /** Emporika UnifiedProduct.id */
  productId: string;
  /** Shopify variant GID (gid://shopify/ProductVariant/{id}) */
  variantId: string;
  /** Merchant's myshopify.com domain */
  shopDomain: string;
  /** Display name of the merchant */
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
  /** Cart MCP continue_url for checkout */
  continueUrl: string;
  /** Cart MCP cart ID */
  cartId: string;
  /** Unix timestamp when item was added */
  addedAt: number;
}

export interface CartContextType {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'id' | 'addedAt'>) => void;
  removeItem: (id: string) => void;
  removeMerchantItems: (shopDomain: string) => void;
  clearCart: () => void;
  itemCount: number;
  /** Items grouped by merchant domain */
  itemsByMerchant: Record<string, CartItem[]>;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}
