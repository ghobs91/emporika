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
import CartDrawer from '@/components/CartDrawer';
import Sidebar from '@/components/Sidebar';
import CategoryPillRail from '@/components/CategoryPillRail';
import DealsCarousel from '@/components/DealsCarousel';
import CartSummarySection from '@/components/CartSummarySection';
import { CartProvider } from '@/context/CartContext';
import { UnifiedProduct, RetailerSource } from '@/types/unified';
import { ShoppingBag, SlidersHorizontal, X } from 'lucide-react';
import { useTargetStore } from '@/hooks/useTargetStore';
import SearchFilters, { ActiveFilters } from '@/components/SearchFilters';
import { ProductFilters, applyProductFilters } from '@/lib/filters';
import { useIntelligentSearch } from '@/hooks/useIntelligentSearch';
import { SearchModeToggle } from '@/components/WebLLMStatus';
import SortSelect, { SortOption } from '@/components/SortSelect';
import ProductResultCard from '@/components/ProductResultCard';
import Pagination from '@/components/Pagination';
import ClarificationPrompt from '@/components/ClarificationPrompt';
import SearchPromptPills from '@/components/SearchPromptPills';

const ALL_SOURCES: RetailerSource[] = ['walmart', 'bestbuy', 'target', 'ebay', 'costco', 'shopify'];

// Results are fetched once per search (server caps at 120) and paginated
// locally so turning pages never re-hits retailer APIs.
const RESULTS_PER_PAGE = 24;

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
  const [currentPage, setCurrentPage] = useState(1);
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
    setCurrentPage(1); // Reset pagination when searching

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

  // Any filter/sort/size change re-paginates from the first page
  const handleFiltersChange = (next: ProductFilters) => {
    setFilters(next);
    setCurrentPage(1);
  };

  const handleSortChange = (next: SortOption) => {
    setSortBy(next);
    setCurrentPage(1);
  };

  // ── Pagination ──────────────────────────────────────────────────────
  // AI results are ranked server-side; preserve that order for "most-popular"
  // but honor the user's sort choice for the other options.
  const aiResults = aiState.response?.results ?? [];
  const sortedAiResults =
    sortBy === 'most-popular'
      ? aiResults
      : [...aiResults].sort((a, b) => {
          const priceA = a.bestOffer?.offer.price?.amount;
          const priceB = b.bestOffer?.offer.price?.amount;
          switch (sortBy) {
            case 'price-asc':
              return (priceA ?? Infinity) - (priceB ?? Infinity);
            case 'price-desc':
              return (priceB ?? -Infinity) - (priceA ?? -Infinity);
            case 'rating-desc': {
              // Offers without a seller rating go to the end
              const ratingA = a.bestOffer?.offer.seller?.rating ?? -1;
              const ratingB = b.bestOffer?.offer.seller?.rating ?? -1;
              return ratingB - ratingA;
            }
            default:
              return 0;
          }
        });

  const aiTotalPages = Math.max(1, Math.ceil(sortedAiResults.length / RESULTS_PER_PAGE));
  const aiPage = Math.min(currentPage, aiTotalPages);
  const aiPageItems = sortedAiResults.slice(
    (aiPage - 1) * RESULTS_PER_PAGE,
    aiPage * RESULTS_PER_PAGE
  );

  const classicTotalPages = Math.max(1, Math.ceil(sortedProducts.length / RESULTS_PER_PAGE));
  const classicPage = Math.min(currentPage, classicTotalPages);
  const classicPageItems = sortedProducts.slice(
    (classicPage - 1) * RESULTS_PER_PAGE,
    classicPage * RESULTS_PER_PAGE
  );

  return (
    <CartProvider>
    <div className="min-h-screen flex bg-white dark:bg-[#1a1a1a] transition-colors duration-300">
      {/* Left icon sidebar (desktop lg+ only) */}
      <Sidebar />

      <div className="flex-1 min-w-0 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-gradient-to-b from-white/90 to-white/60 dark:from-[#1a1a1a]/80 dark:to-[#1a1a1a]/50 backdrop-blur-xl backdrop-saturate-150 border-b border-white/50 dark:border-white/10 shadow-sm shadow-black/5 dark:shadow-black/20 transition-all duration-300">
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
            
            {/* Search appears in the header once the user scrolls (the hero
                bar "merges" up) or has started searching. */}
            <div className="flex-1">
              {(isScrolled || !!searchQuery) && (
                <SearchBar
                  onSearch={handleSearch}
                  isLoading={isLoading || aiState.isLoading}
                />
              )}
            </div>
            
            <div className="flex items-center gap-1">
              <SearchModeToggle aiEnabled={aiState.aiEnabled} onToggle={toggleAiMode} />
              <ThemeToggle />
            </div>
          </div>

          {/* Mobile layout: single clean row — logo, search, actions */}
          <div className="md:hidden flex items-center gap-3">
            <Link href="/" className="flex items-center shrink-0 transition-all duration-300 hover:opacity-75 cursor-pointer">
              <ShoppingBag
                size={24}
                className="text-blue-500 dark:text-blue-400 transition-all duration-300"
              />
              <h1 className="hidden sm:block ml-2 font-semibold text-lg text-gray-900 dark:text-white whitespace-nowrap">
                Emporika
              </h1>
            </Link>

            <div className="flex-1 min-w-0">
              {(isScrolled || !!searchQuery) && (
                <SearchBar
                  onSearch={handleSearch}
                  isLoading={isLoading || aiState.isLoading}
                />
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <SearchModeToggle aiEnabled={aiState.aiEnabled} onToggle={toggleAiMode} />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content — extra bottom padding on mobile clears the floating dock */}
      <main className="container mx-auto px-4 sm:px-6 pt-8 pb-28 lg:pb-8 max-w-7xl">
        {/* Empty state: centered hero search, category rail, deals, cart, trending */}
        {!searchQuery && !isLoading && !aiState.isLoading && (
          <>
            <section className="flex flex-col items-center justify-center text-center pt-8 pb-12 md:pt-16 md:pb-16 min-h-[50vh]">
              <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-gray-900 dark:text-white">
                What are you shopping for today?
              </h2>
              <p className="mt-3 text-gray-500 dark:text-gray-400 md:text-lg">
                Describe what you want in plain English — including style, budget, and priorities.
              </p>
              {/* Hero search bar — hidden once it has "merged" into the
                  sticky header on scroll. */}
              {!isScrolled && (
                <div className="mt-8 w-full max-w-2xl">
                  <SearchBar
                    size="large"
                    onSearch={handleSearch}
                    isLoading={isLoading || aiState.isLoading}
                  />
                </div>
              )}
              <div className="mt-6 flex flex-wrap justify-center gap-2 max-w-3xl">
                {[
                  'Waterproof trail running shoes under $150, wide sizes',
                  '4K portable projector for a bright living room, low input lag',
                  'White stone coffee table 50"-60" wide, under $2000',
                ].map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => handleSearch(example)}
                    className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-[#242424] border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 rounded-full transition-colors"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </section>

            <CategoryPillRail onSelect={(name) => handleSearch(name)} />

            <DealsCarousel />

            <CartSummarySection />

            <div id="trending-feed">
              <TrendingFeed />
            </div>
          </>
        )}

        {/* Show search results when user has searched */}
        {searchQuery && (
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Desktop filters sidebar */}
            <aside className="hidden lg:block w-64 shrink-0">
              <div className="sticky top-28">
                <SortSelect value={sortBy} onChange={handleSortChange} />
                <SearchFilters
                  products={products}
                  filters={filters}
                  onChange={handleFiltersChange}
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
                  <SortSelect value={sortBy} onChange={handleSortChange} />
                  <SearchFilters
                    products={products}
                    filters={filters}
                    onChange={handleFiltersChange}
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
                    </div>
                  </div>

                  <ActiveFilters filters={filters} onChange={handleFiltersChange} />

                  {/* Show shoe size filter for shoe-related searches */}
                  {isShoeSearch && (
                    <ShoeSizeFilter
                      onSizeSelect={(size) => {
                        setSelectedShoeSize(size);
                        setCurrentPage(1);
                      }}
                      selectedSize={selectedShoeSize}
                    />
                  )}

                  {/* Show clothing size filter for clothing-related searches */}
                  {isClothingSearch && (
                    <ClothingSizeFilter
                      onSizeSelect={(size) => {
                        setSelectedClothingSize(size);
                        setCurrentPage(1);
                      }}
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
                  </div>

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
                    {aiPageItems.map((ranked) => {
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

                  <Pagination
                    currentPage={aiPage}
                    totalPages={aiTotalPages}
                    totalItems={sortedAiResults.length}
                    pageSize={RESULTS_PER_PAGE}
                    onPageChange={setCurrentPage}
                  />
                </div>
              ) : (
                <>
                  <ProductGrid products={classicPageItems} isLoading={isLoading || aiState.isLoading} />
                  <Pagination
                    currentPage={classicPage}
                    totalPages={classicTotalPages}
                    totalItems={sortedProducts.length}
                    pageSize={RESULTS_PER_PAGE}
                    onPageChange={setCurrentPage}
                  />
                </>
              )}
            </div>
          </div>
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
    </div>
    </CartProvider>
  );
}
