// Common product categories across all retailers
export type ProductCategory = 
  | 'electronics' 
  | 'home' 
  | 'fashion' 
  | 'sports' 
  | 'toys'
  | 'all';

export interface CategoryConfig {
  id: ProductCategory;
  name: string;
  description: string;
  ebayId: string;
  bestBuyCategory?: string;
  targetQuery?: string;
}

export const PRODUCT_CATEGORIES: Record<ProductCategory, CategoryConfig> = {
  all: {
    id: 'all',
    name: 'All Categories',
    description: 'Popular items across all categories',
    ebayId: '',
    bestBuyCategory: '',
    targetQuery: '',
  },
  electronics: {
    id: 'electronics',
    name: '📱 Electronics',
    description: 'Trending tech, gadgets, and devices',
    ebayId: '293', // Electronics category on eBay
    bestBuyCategory: 'abcat0100000', // Electronics category on Best Buy
    targetQuery: 'tv',
  },
  home: {
    id: 'home',
    name: '🏠 Home & Kitchen',
    description: 'Popular home essentials and decor',
    ebayId: '11700', // Home & Garden category on eBay
    bestBuyCategory: 'pcmcat310200050004', // Home category on Best Buy
    targetQuery: 'kitchen',
  },
  fashion: {
    id: 'fashion',
    name: '👗 Fashion',
    description: 'Trending clothing and accessories',
    ebayId: '11450', // Clothing, Shoes & Accessories on eBay
    bestBuyCategory: '',
    targetQuery: 'shoes',
  },
  sports: {
    id: 'sports',
    name: '⚽ Sports & Outdoors',
    description: 'Popular sports and outdoor gear',
    ebayId: '888', // Sporting Goods on eBay
    bestBuyCategory: '',
    targetQuery: 'fitness',
  },
  toys: {
    id: 'toys',
    name: '🎮 Toys & Games',
    description: 'Trending toys and games',
    ebayId: '220', // Toys & Hobbies on eBay
    bestBuyCategory: 'abcat0400000', // Video Games category (Best Buy has limited toy selection)
    targetQuery: 'toys',
  },
};

export function getCategoryConfig(categoryId: ProductCategory): CategoryConfig {
  return PRODUCT_CATEGORIES[categoryId];
}

export function getAllCategories(): CategoryConfig[] {
  return Object.values(PRODUCT_CATEGORIES);
}
