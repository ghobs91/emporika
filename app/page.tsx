'use client';

import { useState } from 'react';
import SearchBar from '@/components/SearchBar';
import ProductGrid from '@/components/ProductGrid';
import TrendingFeed from '@/components/TrendingFeed';
import { WalmartProduct } from '@/types/walmart';
import { ShoppingBag } from 'lucide-react';

export default function Home() {
  const [products, setProducts] = useState<WalmartProduct[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [totalResults, setTotalResults] = useState(0);

  const handleSearch = async (query: string) => {
    setIsLoading(true);
    setSearchQuery(query);
    
    try {
      const response = await fetch(`/api/search?query=${encodeURIComponent(query)}&numItems=20`);
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
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-center gap-3 mb-6">
            <ShoppingBag size={36} className="text-blue-600" />
            <h1 className="text-4xl font-bold text-gray-900">Emporika</h1>
          </div>
          <p className="text-center text-gray-600 mb-6">
            Search and compare products across multiple online retailers
          </p>
          <SearchBar onSearch={handleSearch} isLoading={isLoading} />
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
            <h2 className="text-xl font-semibold text-gray-800">
              Results for &quot;{searchQuery}&quot;
              {totalResults > 0 && (
                <span className="text-gray-500 font-normal ml-2">
                  ({totalResults} items found)
                </span>
              )}
            </h2>
          </div>
        )}

        <ProductGrid products={products} isLoading={isLoading} />
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 text-white mt-20 py-8">
        <div className="container mx-auto px-4 text-center">
          <p className="text-gray-400">
            © 2025 Emporika. Built with Next.js and Walmart API
          </p>
        </div>
      </footer>
    </div>
  );
}
