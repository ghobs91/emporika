import { UnifiedProduct } from '@/types/unified';
import { ProductCategory } from '@/types/categories';

/**
 * Category keywords used to classify products based on their title and description
 */
const CATEGORY_KEYWORDS: Record<ProductCategory, string[]> = {
  electronics: [
    'tv', 'television', 'phone', 'smartphone', 'tablet', 'ipad', 'computer', 'laptop', 
    'monitor', 'keyboard', 'mouse', 'headphone', 'earbuds', 'speaker', 'soundbar', 'camera', 
    'smartwatch', 'gaming headset', 'gaming', 'console', 'playstation', 'xbox', 'switch',
    'bluetooth', 'wireless', 'charger', 'charging', 'cable', 'adapter', 'hdmi', 'usb', 'tech', 'electronic',
    'audio', 'video', 'display', 'screen', 'processor', 'gpu', 'cpu', 'ram', 'ssd',
    'hard drive', 'router', 'modem', 'wifi', 'alexa', 'google home', 'smart home',
    'drone', 'gopro', 'projector', 'printer', 'scanner', 'apple', 'samsung', 'jbl', 'sony',
    'case for', 'phone case', 'iphone', 'airpods', 'beats', 'bose'
  ],
  home: [
    'kitchen', 'cookware', 'pot', 'pan', 'knife', 'cutting board', 'blender', 
    'mixer', 'toaster', 'coffee maker', 'espresso', 'breville', 'microwave', 'oven', 'refrigerator', 'dishwasher',
    'furniture', 'chair', 'table', 'desk', 'bed', 'mattress', 'pillow', 'sheet',
    'blanket', 'comforter', 'towel', 'curtain', 'rug', 'carpet', 'lamp', 'light', 'lighting',
    'decor', 'vase', 'candle', 'frame', 'mirror', 'storage', 'shelf', 'organizer',
    'vacuum', 'cleaner', 'air purifier', 'humidifier', 'fan', 'heater', 'thermostat',
    'home', 'house', 'room', 'bathroom', 'bedroom', 'living room', 'dining', 'lawn mower'
  ],
  fashion: [
    'shirt', 'pants', 'jeans', 'dress', 'skirt', 'jacket', 'coat', 'sweater',
    'hoodie', 'shorts', 'shoes', 'sneakers', 'boots', 'sandals', 'heels',
    'bag', 'purse', 'backpack', 'wallet', 'belt', 'hat', 'cap', 'scarf',
    'gloves', 'socks', 'underwear', 'bra', 'jewelry', 'necklace', 'bracelet',
    'ring', 'earrings', 'sunglasses', 'glasses', 'fashion', 'clothing', 'apparel',
    'outfit', 'style', 'wear', 'mens', 'womens', 'kids', "men's", "women's"
  ],
  sports: [
    'fitness', 'exercise', 'workout', 'gym', 'yoga', 'mat', 'dumbbell', 'weights',
    'treadmill', 'bike', 'bicycle', 'running', 'jogging', 'tennis', 'basketball',
    'football', 'soccer', 'baseball', 'golf', 'swim', 'swimming', 'hiking',
    'camping', 'tent', 'sleeping bag', 'backpack', 'outdoor', 'sports', 'athletic',
    'training', 'equipment', 'gear', 'protein', 'supplement', 'nutrition',
    'sportswear', 'activewear', 'track', 'field', 'ball', 'racket', 'club'
  ],
  toys: [
    'toy', 'toys', 'board game', 'card game', 'lego', 'puzzle', 'doll', 'action figure',
    'pokemon', 'barbie', 'hot wheels', 'nerf', 'minecraft', 'fortnite',
    'stuffed animal', 'plush', 'kids toy', 'children', 'baby toy', 'toddler',
    'educational toy', 'learning toy', 'building blocks', 'blocks', 'craft', 'art set',
    'outdoor play', 'playground', 'ride-on'
  ],
  all: [] // 'all' category doesn't need keywords
};

/**
 * Categorize a product based on its title, description, and other metadata
 * @param product The unified product to categorize
 * @returns The best matching category for this product
 */
export function categorizeProduct(product: UnifiedProduct): ProductCategory {
  // Combine all searchable text from the product
  const searchText = [
    product.name,
    product.shortDescription,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  // Count keyword matches for each category
  const categoryScores: Record<ProductCategory, number> = {
    electronics: 0,
    home: 0,
    fashion: 0,
    sports: 0,
    toys: 0,
    all: 0,
  };

  // Score each category based on keyword matches
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === 'all') continue;
    
    for (const keyword of keywords) {
      // Use word boundaries to avoid partial matches
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(searchText)) {
        categoryScores[category as ProductCategory]++;
      }
    }
  }

  // Find the category with the highest score
  let bestCategory: ProductCategory = 'all';
  let highestScore = 0;

  for (const [category, score] of Object.entries(categoryScores)) {
    if (score > highestScore) {
      highestScore = score;
      bestCategory = category as ProductCategory;
    }
  }

  // Log categorization for debugging (only in development)
  if (process.env.NODE_ENV === 'development') {
    console.log(`Categorized "${product.name}" as ${bestCategory} (score: ${highestScore}, scores:`, categoryScores, ')');
  }

  // If no clear category match, return 'all'
  return highestScore > 0 ? bestCategory : 'all';
}

/**
 * Group products by category
 * @param products Array of unified products
 * @returns Object with products grouped by category
 */
export function groupProductsByCategory(
  products: UnifiedProduct[]
): Record<ProductCategory, UnifiedProduct[]> {
  const grouped: Record<ProductCategory, UnifiedProduct[]> = {
    electronics: [],
    home: [],
    fashion: [],
    sports: [],
    toys: [],
    all: [],
  };

  for (const product of products) {
    const category = categorizeProduct(product);
    grouped[category].push(product);
    // Also add to 'all' category
    if (category !== 'all') {
      grouped.all.push(product);
    }
  }

  return grouped;
}
