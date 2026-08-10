'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import SearchBar from '@/components/SearchBar';
import ProductGrid from '@/components/ProductGrid';
import ProductCard from '@/components/ProductCard';
import TrendingFeed from '@/components/TrendingFeed';
import ThemeToggle from '@/components/ThemeToggle';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import ShoeSizeFilter from '@/components/ShoeSizeFilter';
import ClothingSizeFilter from '@/components/ClothingSizeFilter';
import CartIcon from '@/components/CartIcon';
import CartDrawer from '@/components/CartDrawer';
import { CartProvider } from '@/context/CartContext';
import { UnifiedProduct, RetailerSource } from '@/types/unified';
import { ShoppingBag, SlidersHorizontal, X, Sparkles } from 'lucide-react';
import { useTargetStore } from '@/hooks/useTargetStore';
import SearchFilters, { ActiveFilters } from '@/components/SearchFilters';
import { ProductFilters, applyProductFilters } from '@/lib/filters';
import { useIntelligentSearch } from '@/hooks/useIntelligentSearch';
import WebLLMStatusIndicator, { SearchModeToggle } from '@/components/WebLLMStatus';
import SearchStatus from '@/components/SearchStatus';
import ProductResultCard from '@/components/ProductResultCard';
import ClarificationPrompt from '@/components/ClarificationPrompt';
import SearchPromptPills from '@/components/SearchPromptPills';

type SortOption = 'most-popular' | 'price-asc' | 'price-desc' | 'rating-desc';

const ALL_SOURCES: RetailerSource[] = ['walmart', 'bestbuy', 'target', 'ebay', 'costco', 'shopify'];

export default function Home() {
  const [products, setProducts] = useState<UnifiedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [totalResults, setTotalResults] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('most-popular');
  const [selectedShoeSize, setSelectedShoeSize] = useState<string | null>(null);
  const [selectedClothingSize, setSelectedClothingSize] = useState<string | null>(null);
  const [selectedSources, setSelectedSources] = useState<RetailerSource[]>(ALL_SOURCES);
  const [filters, setFilters] = useState<ProductFilters>({});
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const { storeInfo } = useTargetStore();
  const { state: aiState, search: aiSearch, toggleAiMode } = useIntelligentSearch();

  // Detect if search query is shoe-related
  const isShoeSearch = searchQuery.toLowerCase().match(/\b(shoe|shoes|sneaker|sneakers|boot|boots|sandal|sandals|slipper|slippers|heel|heels|loafer|loafers|oxford|oxfords|moccasin|moccasins|clog|clogs)\b/);
  
  // Detect if search query is clothing-related
  const topsKeywords = ['shirt', 'shirts', 't-shirt', 'tshirt', 'tee', 'blouse', 'top', 'tops', 'sweater', 'sweatshirt', 'hoodie', 'jacket', 'coat', 'dress', 'dresses'];
  const bottomsKeywords = ['pant', 'pants', 'jean', 'jeans', 'trouser', 'trousers', 'short', 'shorts', 'skirt', 'skirts', 'legging', 'leggings'];
  
  const searchLower = searchQuery.toLowerCase();
  const isTopsSearch = topsKeywords.some(keyword => searchLower.includes(keyword));
  const isBottomsSearch = bottomsKeywords.some(keyword => searchLower.includes(keyword));
  const isClothingSearch = isTopsSearch || isBottomsSearch;
  
  const clothingType: 'tops' | 'bottoms' | 'general' = isTopsSearch ? 'tops' : isBottomsSearch ? 'bottoms' : 'general';


  useEffect(() => {
    let ticking = false;
    const threshold = 50; // Pixel threshold before switching
    const hysteresis = 10; // Prevent rapid switching

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const scrollY = window.scrollY;
          
          // Add hysteresis to prevent flickering
          if (!isScrolled && scrollY > threshold + hysteresis) {
            setIsScrolled(true);
          } else if (isScrolled && scrollY < threshold - hysteresis) {
            setIsScrolled(false);
          }
          
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isScrolled]);

  // Re-search when retailer filters change (skip initial render)
  const sourcesInitialized = useRef(false);
  useEffect(() => {
    if (!sourcesInitialized.current) {
      sourcesInitialized.current = true;
      return;
    }
    if (searchQuery) {
      handleSearch(searchQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSources]);

  const handleSearch = async (query: string) => {
    setIsLoading(true);
    setSearchQuery(query);
    setSortBy('most-popular'); // Reset sort when searching
    setSelectedShoeSize(null); // Reset shoe size filter when searching
    setSelectedClothingSize(null); // Reset clothing size filter when searching
    setFilters({}); // Reset property filters when searching

    // ── Intelligent search (POST /api/search) ──
    if (aiState.aiEnabled) {
      console.log('[AI Search] Firing POST /api/search for:', query);
      aiSearch(query, undefined, selectedSources).catch((err) => {
        console.error('AI search failed:', err);
      });
    }

    
    try {
      // Build search URL with Target store info and selected sources
      const params = new URLSearchParams({
        query,
        numItems: '120',
        sources: selectedSources.join(','),
      });
      
      if (storeInfo) {
        params.append('targetStoreId', storeInfo.storeId);
        params.append('targetZip', storeInfo.zip);
      }
      
      const response = await fetch(`/api/search?${params.toString()}`);
      const data = await response.json();
      
      if (response.ok) {
        setProducts(data.items || []);
        setTotalResults(data.totalResults || 0);
      } else {
        console.error('Search error:', data.error);
        setProducts([]);
        setTotalResults(0);
      }
    } catch (error) {
      console.error('Search failed:', error);
      setProducts([]);
      setTotalResults(0);
    } finally {
      setIsLoading(false);
    }
  };

  // Apply property-based filters from the left sidebar
  let filteredProducts = applyProductFilters(products, filters);

  // Filter products by shoe size if a size is selected
  filteredProducts = selectedShoeSize
    ? filteredProducts.filter((product) => {
        const searchText = `${product.name} ${product.shortDescription || ''}`.toLowerCase();
        // Look for the size in various formats: "Size 10", "10.5", "size:10", etc.
        const sizePatterns = [
          new RegExp(`\\bsize\\s*:?\\s*${selectedShoeSize.replace('.', '\\.')}\\b`, 'i'),
          new RegExp(`\\b${selectedShoeSize.replace('.', '\\.')}\\s*(m|w|d|b|us)?\\b`, 'i'),
          new RegExp(`\\(${selectedShoeSize.replace('.', '\\.').replace(/\(/g, '\\(').replace(/\)/g, '\\)')}\\)`, 'i'),
        ];
        return sizePatterns.some(pattern => pattern.test(searchText));
      })
    : filteredProducts;

  // Filter products by clothing size if a size is selected
  filteredProducts = selectedClothingSize
    ? filteredProducts.filter((product) => {
        const searchText = `${product.name} ${product.shortDescription || ''}`.toLowerCase();
        // Look for the size in various formats: "Size M", "M", "Size: Medium", "32W", "Size 32", etc.
        const escapedSize = selectedClothingSize.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const sizePatterns = [
          new RegExp(`\\bsize\\s*:?\\s*${escapedSize}\\b`, 'i'),
          new RegExp(`\\b${escapedSize}\\s*(w|l|r)?\\b`, 'i'),
          new RegExp(`\\(${escapedSize}\\)`, 'i'),
          // For numeric sizes like "32", also match "32W", "32L", "32x34"
          ...(!/[a-z]/i.test(selectedClothingSize) ? [
            new RegExp(`\\b${escapedSize}(w|l|x\\d+)?\\b`, 'i')
          ] : []),
        ];
        return sizePatterns.some(pattern => pattern.test(searchText));
      })
    : filteredProducts;

  // Sort products based on selected option
  const sortedProducts = [...filteredProducts].sort((a, b) => {
    switch (sortBy) {
      case 'price-asc':
        return (a.price || Infinity) - (b.price || Infinity);
      case 'price-desc':
        return (b.price || 0) - (a.price || 0);
      case 'rating-desc': {
        // Products without ratings go to the end
        const aRating = a.customerRating ?? -1;
        const bRating = b.customerRating ?? -1;
        return bRating - aRating;
      }
      case 'most-popular':
      default: {
        // Products without review counts go to the end
        const aReviews = a.reviewCount ?? -1;
        const bReviews = b.reviewCount ?? -1;
        return bReviews - aReviews;
      }
    }
  });

  const activeFilterCount = [
    filters.minPrice !== undefined || filters.maxPrice !== undefined,
    filters.minRating !== undefined,
    filters.onSale,
    filters.freeShipping,
    filters.availableOnline,
    filters.hasReviews,
  ].filter(Boolean).length;

  return (
    <CartProvider>
    <div className="min-h-screen bg-white dark:bg-[#1a1a1a] transition-colors duration-300">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/95 dark:bg-[#1a1a1a]/95 backdrop-blur-xl border-b border-gray-200 dark:border-gray-800 transition-all duration-300">
        <div className={`container mx-auto px-6 transition-all duration-300 ${
          isScrolled ? 'py-3' : 'py-5'
        }`}>
          {/* Desktop layout: Single row with logo, search, and theme toggle */}
          <div className="hidden md:flex items-center gap-4">
            <Link href="/" className={`flex items-center transition-all duration-300 hover:opacity-75 cursor-pointer ${
              isScrolled ? 'gap-2' : 'gap-3'
            }`}>
              <ShoppingBag 
                size={isScrolled ? 20 : 24} 
                className="text-blue-500 dark:text-blue-400 transition-all duration-300" 
              />
              <h1 className={`font-semibold text-gray-900 dark:text-white transition-all duration-300 whitespace-nowrap ${
                isScrolled ? 'text-lg' : 'text-xl'
              }`}>
                Emporika
              </h1>
            </Link>
            
            <div className="flex-1">
              <SearchBar
                onSearch={handleSearch}
                isLoading={isLoading || aiState.isLoading}
              />
            </div>
            
            <div className="flex items-center gap-1">
              <CartIcon />
              <SearchModeToggle aiEnabled={aiState.aiEnabled} onToggle={toggleAiMode} />
              <ThemeToggle />
            </div>
          </div>

          {/* Mobile layout: Two rows - nav bar on top, search below */}
          <div className="md:hidden">
            {/* First row: Logo and theme toggle */}
            <div className="flex items-center justify-between mb-3">
              <Link href="/" className={`flex items-center transition-all duration-300 hover:opacity-75 cursor-pointer ${
                isScrolled ? 'gap-2' : 'gap-3'
              }`}>
                <ShoppingBag 
                  size={isScrolled ? 20 : 24} 
                  className="text-blue-500 dark:text-blue-400 transition-all duration-300" 
                />
                <h1 className={`font-semibold text-gray-900 dark:text-white transition-all duration-300 whitespace-nowrap ${
                  isScrolled ? 'text-lg' : 'text-xl'
                }`}>
                  Emporika
                </h1>
              </Link>
              
              <div className="flex items-center gap-1">
                <CartIcon />
              <SearchModeToggle aiEnabled={aiState.aiEnabled} onToggle={toggleAiMode} />
                <ThemeToggle />
              </div>
            </div>

            {/* Second row: Search bar on its own line */}
            <div className="w-full">
              <SearchBar
                onSearch={handleSearch}
                isLoading={isLoading || aiState.isLoading}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8 max-w-7xl">
        {/* Show trending items when no search has been performed */}
        {!searchQuery && !isLoading && !aiState.isLoading && (
          <>
            <div className="max-w-2xl mx-auto text-center mb-12">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
                What are you shopping for?
              </h2>
              <p className="text-gray-500 dark:text-gray-400 mb-6">
                Describe what you want in plain English — including style, budget, and priorities.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {[
                  'Waterproof trail running shoes under $150, wide sizes',
                  '4K portable projector for a bright living room, low input lag',
                  'White stone coffee table 50"-60" wide, under $2000',
                ].map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => handleSearch(example)}
                    className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
            <TrendingFeed />
          </>
        )}

        {/* Show search results when user has searched */}
        {searchQuery && (
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Desktop filters sidebar */}
            <aside className="hidden lg:block w-64 shrink-0">
              <div className="sticky top-28">
                <SearchFilters
                  products={products}
                  filters={filters}
                  onChange={setFilters}
                  selectedSources={selectedSources}
                  onSourcesChange={setSelectedSources}
                />
              </div>
            </aside>

            {/* Mobile filter drawer */}
            {isFiltersOpen && (
              <div className="fixed inset-0 z-50 lg:hidden">
                <div
                  className="absolute inset-0 bg-black/50"
                  onClick={() => setIsFiltersOpen(false)}
                />
                <div className="absolute left-0 top-0 h-full w-80 max-w-[85vw] bg-white dark:bg-[#1a1a1a] overflow-y-auto p-4 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                      Filters
                    </h2>
                    <button
                      type="button"
                      onClick={() => setIsFiltersOpen(false)}
                      className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-[#242424] text-gray-500 dark:text-gray-400"
                    >
                      <X size={20} />
                    </button>
                  </div>
                  <SearchFilters
                    products={products}
                    filters={filters}
                    onChange={setFilters}
                    selectedSources={selectedSources}
                    onSourcesChange={setSelectedSources}
                  />
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => setIsFiltersOpen(false)}
                      className="w-full py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
                    >
                      Show {filteredProducts.length.toLocaleString()} results
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Results area */}
            <div className="flex-1 min-w-0">
              {!isLoading && (
                <div className="mb-6">
                  {!aiState.aiEnabled && (
                    <div className="mb-4">
                      <SearchPromptPills query={searchQuery} onChange={(q) => handleSearch(q)} />
                      {totalResults > 0 && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {filteredProducts.length.toLocaleString()} items
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsFiltersOpen(true)}
                        className="lg:hidden flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#242424] text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-[#2a2a2a] transition-colors"
                      >
                        <SlidersHorizontal size={16} />
                        Filters
                        {activeFilterCount > 0 && (
                          <span className="ml-1 bg-blue-500 text-white text-xs rounded-full px-1.5 py-0.5">
                            {activeFilterCount}
                          </span>
                        )}
                      </button>
                      <label htmlFor="sort-select" className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        Sort by:
                      </label>
                      <select
                        id="sort-select"
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as SortOption)}
                        className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#242424] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer transition-all"
                      >
                        <option value="most-popular">Most Popular</option>
                        <option value="price-asc">Price: Low to High</option>
                        <option value="price-desc">Price: High to Low</option>
                        <option value="rating-desc">Rating: High to Low</option>
                      </select>
                    </div>
                  </div>

                  <ActiveFilters filters={filters} onChange={setFilters} />

                  {/* Show shoe size filter for shoe-related searches */}
                  {isShoeSearch && (
                    <ShoeSizeFilter
                      onSizeSelect={setSelectedShoeSize}
                      selectedSize={selectedShoeSize}
                    />
                  )}

                  {/* Show clothing size filter for clothing-related searches */}
                  {isClothingSearch && (
                    <ClothingSizeFilter
                      onSizeSelect={setSelectedClothingSize}
                      selectedSize={selectedClothingSize}
                      clothingType={clothingType}
                    />
                  )}
                </div>
              )}

              {/* AI mode: show ranked intelligent results; otherwise classic grid */}
              {aiState.aiEnabled && aiState.response?.results && aiState.response.results.length > 0 ? (
                <div className="space-y-3">
                  <div className="mb-4">
                    <SearchPromptPills query={aiState.query} onChange={(q) => handleSearch(q)} />
                    <div className="flex items-center gap-2">
                      <Sparkles size={14} className="text-purple-500" />
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                        AI-ranked · {aiState.response.metadata.timingMs.total}ms
                      </span>
                      {aiState.webllmStatus.status === 'ready' && (
                        <WebLLMStatusIndicator status="ready" />
                      )}
                      {aiState.webllmStatus.status === 'fast' && (
                        <WebLLMStatusIndicator status="fast" />
                      )}
                    </div>
                  </div>

                  <SearchStatus
                    status={aiState.response.status}
                    metadata={aiState.response.metadata}
                    isLoading={aiState.isLoading}
                    query={aiState.query}
                  />

                  {aiState.response.clarification && (
                    <ClarificationPrompt
                      field={aiState.response.clarification.field}
                      question={aiState.response.clarification.question}
                      reason={aiState.response.clarification.reason}
                      onDismiss={() => {}}
                    />
                  )}

                  {aiState.response.suggestionForNoResults && aiState.response.suggestionForNoResults.length > 0 && (
                    <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-4">
                      <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">Suggestions to find more results:</p>
                      <ul className="text-sm text-blue-700 dark:text-blue-300 list-disc pl-5 space-y-1">
                        {aiState.response.suggestionForNoResults.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {aiState.response.results.map((ranked) => {
                      const best = ranked.bestOffer?.offer;
                      const product: import('@/types/unified').UnifiedProduct = {
                        id: ranked.product.canonicalId,
                        name: ranked.product.title,
                        price: best?.price?.amount ?? 0,
                        originalPrice: best?.listPrice && best.listPrice.amount > (best.price?.amount ?? 0) ? best.listPrice.amount : undefined,
                        image: ranked.product.imageUrls?.[0] ?? best?.imageUrls?.[0] ?? '',
                        productUrl: best?.productUrl ?? '#',
                        source: (best?.providerId ?? 'shopify') as import('@/types/unified').RetailerSource,
                        shortDescription: ranked.reasonsToChoose.slice(0, 2).join(' · '),
                      };
                      return (
                        <div key={ranked.product.canonicalId} className="relative">
                          <div className="absolute -top-2 -left-2 z-10 w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-900/50 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 text-xs font-bold flex items-center justify-center shadow-sm">
                            {ranked.rank}
                          </div>
                          <ProductCard product={product} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <ProductGrid products={sortedProducts} isLoading={isLoading || aiState.isLoading} />
              )}
            </div>
          </div>
        )}

        {!searchQuery && (
          <ProductGrid products={sortedProducts} isLoading={isLoading || aiState.isLoading} />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-gray-100 dark:bg-[#0f0f0f] mt-20 py-12 border-t border-gray-200 dark:border-gray-800">
        <div className="container mx-auto px-6 text-center">
          <p className="text-gray-500 dark:text-gray-500 text-sm">
            © 2025 Emporika
          </p>
        </div>
      </footer>

      {/* PWA Install Prompt */}
      <PWAInstallPrompt />

      {/* Cart Drawer */}
      <CartDrawer />
    </div>
    </CartProvider>
  );
}
