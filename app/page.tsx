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
    <div className="min-h-screen bg-linear-to-b from-blue-50 to-white dark:from-gray-950 dark:to-gray-900 transition-colors duration-300">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white dark:bg-gray-800 backdrop-blur-xl shadow-md border-b-2 border-gray-200 dark:border-gray-700 transition-all duration-300">
        <div className={`container mx-auto px-4 transition-all duration-300 ${
          isScrolled ? 'py-3' : 'py-6'
        }`}>
          <div className={`flex items-center transition-all duration-300 ${
            isScrolled ? 'gap-4 justify-start' : 'gap-6 justify-center flex-col'
          }`}>
            <div className={`flex items-center transition-all duration-300 ${
              isScrolled ? 'gap-2 order-1' : 'gap-3 order-2'
            }`}>
              <ShoppingBag 
                size={isScrolled ? 24 : 36} 
                className="text-blue-600 dark:text-blue-400 transition-all duration-300" 
              />
              <h1 className={`font-bold text-gray-900 dark:text-white transition-all duration-300 whitespace-nowrap ${
                isScrolled ? 'text-xl' : 'text-4xl'
              }`}>
                Emporika
              </h1>
            </div>
            
            <div className={`transition-all duration-300 ${
              isScrolled ? 'flex-1 order-2' : 'w-full order-3'
            }`}>
              <div className={`transition-all duration-300 overflow-hidden ${
                isScrolled ? 'max-h-0 opacity-0 mb-0' : 'max-h-10 opacity-100 mb-6'
              }`}>
                <p className="text-center text-gray-600 dark:text-gray-300">
                  Search and compare products across multiple online retailers
                </p>
              </div>
              <SearchBar onSearch={handleSearch} isLoading={isLoading} isScrolled={isScrolled} />
            </div>
            
            <div className={`transition-all duration-300 ${
              isScrolled ? 'order-3' : 'absolute top-6 right-4 order-1'
            }`}>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Show trending items when no search has been performed */}
        {!searchQuery && !isLoading && (
          <>
            <TrendingFeed />
          </>
        )}

        {/* Show search results when user has searched */}
        {searchQuery && !isLoading && (
          <div className="sticky top-[72px] z-40 bg-linear-to-b from-blue-50 via-blue-50 to-transparent dark:from-gray-950 dark:via-gray-950 dark:to-transparent pb-4 mb-2">
            <div className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4">
              <div>
                <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">
                  Results for &quot;{searchQuery}&quot;
                  {totalResults > 0 && (
                    <span className="text-gray-500 dark:text-gray-400 font-normal ml-2">
                      ({totalResults} items found)
                    </span>
                  )}
                </h2>
              </div>
              <div className="flex items-center gap-3">
                <label htmlFor="sort-select" className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                  Sort by:
                </label>
                <select
                  id="sort-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="px-4 py-2 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/40 dark:focus:ring-blue-500/40 cursor-pointer transition-all duration-200"
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
      <footer className="bg-gray-900 dark:bg-gray-950 text-white mt-20 py-8">
        <div className="container mx-auto px-4 text-center">
          <p className="text-gray-400 dark:text-gray-500">
            © 2025 Emporika. Built with Next.js, Walmart API, Best Buy API, and Target API
          </p>
        </div>
      </footer>

      {/* PWA Install Prompt */}
      <PWAInstallPrompt />
    </div>
  );
}
