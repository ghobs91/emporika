'use client';

import { useState, useEffect } from 'react';
import SearchBar from '@/components/SearchBar';
import ProductGrid from '@/components/ProductGrid';
import TrendingFeed from '@/components/TrendingFeed';
import ThemeToggle from '@/components/ThemeToggle';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';
import { UnifiedProduct } from '@/types/unified';
import { ShoppingBag } from 'lucide-react';
import { useTargetStore } from '@/hooks/useTargetStore';

type SortOption = 'relevance' | 'price-asc' | 'price-desc' | 'rating-desc';

export default function Home() {
  const [products, setProducts] = useState<UnifiedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [totalResults, setTotalResults] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const { storeInfo } = useTargetStore();

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

  const handleSearch = async (query: string) => {
    setIsLoading(true);
    setSearchQuery(query);
    setSortBy('relevance'); // Reset sort when searching
    
    try {
      // Build search URL with Target store info if available
      const params = new URLSearchParams({
        query,
        numItems: '20',
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

  // Sort products based on selected option
  const sortedProducts = [...products].sort((a, b) => {
    switch (sortBy) {
      case 'price-asc':
        return (a.price || Infinity) - (b.price || Infinity);
      case 'price-desc':
        return (b.price || 0) - (a.price || 0);
      case 'rating-desc':
        return (b.customerRating || 0) - (a.customerRating || 0);
      case 'relevance':
      default:
        return 0; // Keep original order
    }
  });

  return (
    <div className="min-h-screen bg-white dark:bg-[#1a1a1a] transition-colors duration-300">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/95 dark:bg-[#1a1a1a]/95 backdrop-blur-xl border-b border-gray-200 dark:border-gray-800 transition-all duration-300">
        <div className={`container mx-auto px-6 transition-all duration-300 ${
          isScrolled ? 'py-3' : 'py-5'
        }`}>
          {/* Desktop layout: Single row with logo, search, and theme toggle */}
          <div className="hidden md:flex items-center gap-4">
            <div className={`flex items-center transition-all duration-300 ${
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
            </div>
            
            <div className="flex-1">
              <SearchBar onSearch={handleSearch} isLoading={isLoading} isScrolled={isScrolled} />
            </div>
            
            <div>
              <ThemeToggle />
            </div>
          </div>

          {/* Mobile layout: Two rows - nav bar on top, search below */}
          <div className="md:hidden">
            {/* First row: Logo and theme toggle */}
            <div className="flex items-center justify-between mb-3">
              <div className={`flex items-center transition-all duration-300 ${
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
              </div>
              
              <div>
                <ThemeToggle />
              </div>
            </div>

            {/* Second row: Search bar on its own line */}
            <div className="w-full">
              <SearchBar onSearch={handleSearch} isLoading={isLoading} isScrolled={isScrolled} />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        {/* Show trending items when no search has been performed */}
        {!searchQuery && !isLoading && (
          <>
            <TrendingFeed />
          </>
        )}

        {/* Show search results when user has searched */}
        {searchQuery && !isLoading && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-medium text-gray-900 dark:text-gray-100">
                  Results for &quot;{searchQuery}&quot;
                  {totalResults > 0 && (
                    <span className="text-gray-500 dark:text-gray-400 font-normal text-base ml-2">
                      ({totalResults.toLocaleString()} items)
                    </span>
                  )}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="sort-select" className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                  Sort by:
                </label>
                <select
                  id="sort-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#242424] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer transition-all"
                >
                  <option value="relevance">Relevance</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="price-desc">Price: High to Low</option>
                  <option value="rating-desc">Rating: High to Low</option>
                </select>
              </div>
            </div>
          </div>
        )}

        <ProductGrid products={sortedProducts} isLoading={isLoading} />
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
    </div>
  );
}
