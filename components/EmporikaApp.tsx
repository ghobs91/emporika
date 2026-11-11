'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import SearchBar from '@/components/SearchBar';
import ProductGrid, { RESULTS_GRID_CLASS } from '@/components/ProductGrid';
import ProductCard from '@/components/ProductCard';
import ProductModal from '@/components/ProductModal';
import ProviderStatusBar from '@/components/ProviderStatusBar';
import TrendingFeed from '@/components/TrendingFeed';
import ThemeToggle from '@/components/ThemeToggle';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import ShoeSizeFilter from '@/components/ShoeSizeFilter';
import ClothingSizeFilter from '@/components/ClothingSizeFilter';
import CartDrawer from '@/components/CartDrawer';
import EmbeddedCheckoutModal from '@/components/EmbeddedCheckoutModal';
import Sidebar from '@/components/Sidebar';
import CategoryPillRail from '@/components/CategoryPillRail';
import DealsCarousel from '@/components/DealsCarousel';
import CartSummarySection from '@/components/CartSummarySection';
import { CartProvider } from '@/context/CartContext';
import { EmbeddedCheckoutProvider } from '@/context/EmbeddedCheckoutContext';
import { UnifiedProduct, RetailerSource, ProviderStatus } from '@/types/unified';
import { ShoppingBag, SlidersHorizontal } from 'lucide-react';
import { useTargetStore } from '@/hooks/useTargetStore';
import SearchFilters, { ActiveFilters } from '@/components/SearchFilters';
import { ProductFilters, applyProductFilters, matchesProductFilters, countActiveFilters } from '@/lib/filters';
import {
  SEARCH_RESULTS_PATH,
  buildSearchUrl,
  parseSearchParams,
  type SearchUrlState,
} from '@/lib/search-url';
import { rankedProductToUnified } from '@/lib/ranked-products';
import { useIntelligentSearch } from '@/hooks/useIntelligentSearch';
import { SearchModeToggle } from '@/components/WebLLMStatus';
import SortSelect, { SortOption } from '@/components/SortSelect';
import Pagination from '@/components/Pagination';
import ClarificationPrompt from '@/components/ClarificationPrompt';
import SearchPromptPills from '@/components/SearchPromptPills';

// Maps the UI sort to the server's ordering key (applied before the result cap).
const SORT_TO_SEARCH_SORT: Record<SortOption, import('@/search/types').SearchSort> = {
  'most-popular': 'most-popular',
  'price-asc': 'price-asc',
  'price-desc': 'price-desc',
  'rating-desc': 'rating-desc',
};

// Results are fetched once per search (server caps at 120) and paginated
// locally so turning pages never re-hits retailer APIs.
const RESULTS_PER_PAGE = 24;

export default function EmporikaApp() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ── The URL is the source of truth ────────────────────────────────
  // On `/search/results` the query string owns the query, the filters, the
  // retailer set and the sort order, so a shared link reproduces the view:
  //   /search/results?query=mac%20mini&inStock=true&maxPrice=990
  // None of it is mirrored into React state — editing a filter rewrites the
  // URL instead, which keeps links, back/forward and the UI in lockstep.
  const urlState = useMemo(
    () => parseSearchParams(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );
  const {
    query: searchQuery,
    filters,
    sources: selectedSources,
    sort: sortBy,
  } = urlState;

  const [products, setProducts] = useState<UnifiedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [totalResults, setTotalResults] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const [selectedShoeSize, setSelectedShoeSize] = useState<string | null>(null);
  const [selectedClothingSize, setSelectedClothingSize] = useState<string | null>(null);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<UnifiedProduct | null>(null);
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

  // Derive per-retailer status from the intelligent-search metadata/results
  // so the UI can show who actually returned results (vs. errored/empty).
  useEffect(() => {
    const response = aiState.response;
    if (!response?.metadata) return;
    const counts: Record<string, number> = {};
    for (const ranked of response.results ?? []) {
      for (const providerId of ranked.product.sourceProviders) {
        counts[providerId] = (counts[providerId] ?? 0) + 1;
      }
    }
    const failed = new Map(response.metadata.providersFailed.map((f) => [f.providerId, f.errorType]));
    const ids = Array.from(
      new Set<string>([
        ...response.metadata.providersSearched,
        ...response.metadata.providersFailed.map((f) => f.providerId),
      ])
    );
    setProviderStatus(
      ids.map((id) => ({
        providerId: id as RetailerSource,
        count: counts[id] ?? 0,
        error: failed.get(id as RetailerSource),
      }))
    );
  }, [aiState.response]);

  // ── URL ⇄ state plumbing ───────────────────────────────────────────
  const isResultsRoute = pathname === SEARCH_RESULTS_PATH;

  /** Rewrite the results URL. `replace` keeps filter tweaks out of history. */
  const syncUrl = useCallback(
    (state: SearchUrlState, mode: 'push' | 'replace') => {
      const href = buildSearchUrl(state);
      if (mode === 'push') router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    },
    [router]
  );

  const runSearch = async (
    query: string,
    overrides?: { sources?: RetailerSource[]; sort?: SortOption }
  ) => {
    if (!query) return;
    const sources = overrides?.sources ?? selectedSources;
    const sort = overrides?.sort ?? sortBy;
    setIsLoading(true);
    setProviderStatus([]); // Reset retailer status when searching

    // ── Intelligent search (POST /api/search) ──
    if (aiState.aiEnabled) {
      console.log('[AI Search] Firing POST /api/search for:', query);
      const destination = {
        country: 'US',
        ...(storeInfo?.zip ? { postalCode: storeInfo.zip } : {}),
      };
      aiSearch(query, undefined, sources, destination, SORT_TO_SEARCH_SORT[sort]).catch((err) => {
        console.error('AI search failed:', err);
      });
    }

    
    try {
      // Build search URL with Target store info and selected sources
      const params = new URLSearchParams({
        query,
        numItems: '120',
        sources: sources.join(','),
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
        // Classic mode has no AI metadata; map the per-source summary.
        if (!aiState.aiEnabled && data.sources) {
          setProviderStatus(
            (Object.entries(data.sources) as Array<[RetailerSource, { count: number; error?: string }]>).map(
              ([providerId, summary]) => ({
                providerId,
                count: summary.count,
                error: summary.error,
              })
            )
          );
        }
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

  // ── (Re)run the search when the URL's *search* inputs change ─────────
  // Deliberately keyed on query + retailers only. Filter edits rewrite the
  // URL but are applied client-side over the fetched set, so they must not
  // trigger a fetch.
  const searchKey = [searchQuery, selectedSources.join(',')].join('|');
  const lastSearchKey = useRef<string | null>(null);

  useEffect(() => {
    if (!searchQuery) return;
    // A deep link, a back/forward jump and a fresh submit all land here; a
    // filter-only URL change keeps the same key and is skipped.
    if (lastSearchKey.current === searchKey) return;
    lastSearchKey.current = searchKey;
    setCurrentPage(1);
    runSearch(searchQuery, { sources: selectedSources, sort: sortBy });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey]);

  /**
   * Submit a new query. Filters reset (a new search starts clean) and the
   * results route records it in the URL, which is what triggers the fetch.
   */
  const handleSearch = (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSelectedShoeSize(null);
    setSelectedClothingSize(null);
    setCurrentPage(1);
    setProviderStatus([]);

    const nextState: SearchUrlState = {
      query: trimmed,
      filters: {},
      sources: selectedSources,
      sort: 'most-popular',
    };

    // Re-submitting the same query with the same state leaves the URL
    // untouched, so the trigger effect can't fire — fetch directly instead.
    if (isResultsRoute && buildSearchUrl(nextState) === buildSearchUrl(urlState)) {
      runSearch(trimmed, { sources: selectedSources, sort: 'most-popular' });
    }

    syncUrl(nextState, 'push');
  };

  const sourceFilteredProducts = useMemo(
    () => products.filter((product) => selectedSources.includes(product.source)),
    [products, selectedSources]
  );

  // Apply property-based filters from the left sidebar
  let filteredProducts = applyProductFilters(sourceFilteredProducts, filters);

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

  const activeFilterCount = countActiveFilters(filters);

  // ── Filter / sort / retailer edits are URL writes ─────────────────────
  // They `replace` (so tweaking a filter doesn't stack history entries) and
  // re-paginate. The fetched result set is filtered client-side, so none of
  // these refetch.
  const handleFiltersChange = (next: ProductFilters) => {
    setCurrentPage(1);
    syncUrl(
      { query: searchQuery, filters: next, sources: selectedSources, sort: sortBy },
      'replace'
    );
  };

  const handleSourcesChange = (next: RetailerSource[]) => {
    setCurrentPage(1);
    syncUrl(
      { query: searchQuery, filters, sources: next, sort: sortBy },
      'replace'
    );
  };

  // Sort is part of the URL too. In AI mode the server applies the order
  // before capping results, so a sort change also re-runs the search (cheap:
  // responses are cached per sort). Classic mode sorts the fetched set.
  const handleSortChange = (next: SortOption) => {
    setCurrentPage(1);
    syncUrl(
      { query: searchQuery, filters, sources: selectedSources, sort: next },
      'replace'
    );
    if (aiState.aiEnabled && searchQuery) {
      const destination = {
        country: 'US',
        ...(storeInfo?.zip ? { postalCode: storeInfo.zip } : {}),
      };
      aiSearch(searchQuery, undefined, selectedSources, destination, SORT_TO_SEARCH_SORT[next]).catch((err) => {
        console.error('AI re-sort failed:', err);
      });
    }
  };

  // ── Pagination ──────────────────────────────────────────────────────
  // The server applies the requested ordering before capping results and
  // renumbers ranks to match, so the returned order is already correct here.
  // Ranked results are projected into the unified shape so the same sidebar
  // filters that drive the classic grid also apply to AI-ranked results.
  const aiProducts = useMemo(
    () =>
      (aiState.response?.results ?? []).map((ranked) => ({
        ranked,
        product: rankedProductToUnified(ranked),
      })),
    [aiState.response]
  );
  const filteredAiProducts = aiProducts.filter(({ product }) =>
    selectedSources.includes(product.source) && matchesProductFilters(product, filters)
  );

  // Facets are derived from whichever result set is on screen, so the options
  // and counts always match what the filters act on.
  const filterFacetProducts = useMemo(
    () =>
      aiState.aiEnabled
        ? aiProducts
            .map((entry) => entry.product)
            .filter((product) => selectedSources.includes(product.source))
        : sourceFilteredProducts,
    [aiState.aiEnabled, aiProducts, sourceFilteredProducts, selectedSources]
  );

  const aiTotalPages = Math.max(1, Math.ceil(filteredAiProducts.length / RESULTS_PER_PAGE));
  const aiPage = Math.min(currentPage, aiTotalPages);
  const aiPageItems = filteredAiProducts.slice(
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
    <EmbeddedCheckoutProvider>
    <div className="min-h-screen flex bg-white dark:bg-[#131313] transition-colors duration-300">
      {/* Left icon sidebar (desktop lg+ only) */}
      <Sidebar />

      <div className="flex-1 min-w-0 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-gradient-to-b from-white/90 to-white/60 dark:from-[#131313]/90 dark:to-[#131313]/70 backdrop-blur-xl backdrop-saturate-150 border-b border-white/50 dark:border-white/10 shadow-sm shadow-black/5 dark:shadow-black/40 transition-all duration-300">
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
                  initialQuery={searchQuery}
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
                  initialQuery={searchQuery}
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

            <CategoryPillRail />

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
              {/* Independently scrollable: the sidebar no longer inherits the
                  page height, so it scrolls without reaching the end of the
                  results column first. */}
              <div className="sticky top-28 h-[calc(100vh-9rem)]">
                <SearchFilters
                  products={filterFacetProducts}
                  filters={filters}
                  onChange={handleFiltersChange}
                  selectedSources={selectedSources}
                  onSourcesChange={handleSourcesChange}
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
                <div className="absolute inset-y-0 left-0 w-[23rem] max-w-[92vw] p-3">
                  <SearchFilters
                    products={filterFacetProducts}
                    filters={filters}
                    onChange={handleFiltersChange}
                    selectedSources={selectedSources}
                    onSourcesChange={handleSourcesChange}
                    onClose={() => setIsFiltersOpen(false)}
                  />
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
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <button
                      type="button"
                      onClick={() => setIsFiltersOpen(true)}
                      className="lg:hidden inline-flex items-center gap-2 rounded-full border border-gray-200 dark:border-[#4a4a4a] bg-white dark:bg-[#232323] px-3.5 py-1.5 text-[13px] font-medium text-gray-700 dark:text-gray-100 hover:border-gray-400 dark:hover:border-gray-400 transition-colors"
                    >
                      <SlidersHorizontal size={15} />
                      Filters
                      {activeFilterCount > 0 && (
                        <span className="ml-0.5 rounded-full bg-gray-900 dark:bg-white px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white dark:text-gray-900">
                          {activeFilterCount}
                        </span>
                      )}
                    </button>
                    <div className="ml-auto">
                      <SortSelect value={sortBy} onChange={handleSortChange} />
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

              {/* Per-retailer status — makes silent degradation visible */}
              <ProviderStatusBar statuses={providerStatus} streaming={aiState.streaming} />

              {/* AI mode: show ranked intelligent results; otherwise classic grid */}
              {aiState.aiEnabled && aiState.response?.results && aiState.response.results.length > 0 ? (
                <div className="space-y-3">
                  <div className="mb-4">
                    <SearchPromptPills query={aiState.query} onChange={(q) => handleSearch(q)} />
                  </div>

                  {aiState.streaming && (
                    <div className="flex items-center gap-2 text-xs text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg px-3 py-2 mb-1" role="status">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                      </span>
                      Showing early results — still searching more retailers…
                    </div>
                  )}

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

                  {aiPageItems.length === 0 ? (
                    <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                      No results match your filters.
                    </p>
                  ) : (
                    <div className={RESULTS_GRID_CLASS}>
                      {aiPageItems.map(({ ranked, product }) => (
                        <ProductCard
                          key={ranked.product.canonicalId}
                          product={product}
                          rank={ranked.rank}
                          ranked={ranked}
                          onClick={() => setSelectedProduct(product)}
                        />
                      ))}
                    </div>
                  )}

                  <Pagination
                    currentPage={aiPage}
                    totalPages={aiTotalPages}
                    totalItems={filteredAiProducts.length}
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

      {/* Product detail modal (AI cards) */}
      {selectedProduct && (
        <ProductModal
          key={selectedProduct.id}
          product={selectedProduct}
          isOpen={true}
          onClose={() => setSelectedProduct(null)}
        />
      )}

      {/* Cart Drawer */}
      <CartDrawer />

      {/* Embedded checkout (ECP) */}
      <EmbeddedCheckoutModal />
      </div>
    </div>
    </EmbeddedCheckoutProvider>
    </CartProvider>
  );
}
