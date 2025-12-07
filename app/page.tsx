'use client';

import { useState, useEffect } from 'react';
import SearchBar from '@/components/SearchBar';
import ProductGrid from '@/components/ProductGrid';
import TrendingFeed from '@/components/TrendingFeed';
import ThemeToggle from '@/components/ThemeToggle';
import { UnifiedProduct } from '@/types/unified';
import { ShoppingBag } from 'lucide-react';
import { useTargetStore } from '@/hooks/useTargetStore';

export default function Home() {
  const [products, setProducts] = useState<UnifiedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [totalResults, setTotalResults] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
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
          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">
              Results for &quot;{searchQuery}&quot;
              {totalResults > 0 && (
                <span className="text-gray-500 dark:text-gray-400 font-normal ml-2">
                  ({totalResults} items found)
                </span>
              )}
            </h2>
          </div>
        )}

        <ProductGrid products={products} isLoading={isLoading} />
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 dark:bg-gray-950 text-white mt-20 py-8">
        <div className="container mx-auto px-4 text-center">
          <p className="text-gray-400 dark:text-gray-500">
            © 2025 Emporika. Built with Next.js, Walmart API, Best Buy API, and Target API
          </p>
        </div>
      </footer>
    </div>
  );
}
