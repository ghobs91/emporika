'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, ArrowUp } from 'lucide-react';

interface SearchBarProps {
  onSearch: (query: string) => void;
  isLoading?: boolean;
  placeholder?: string;
  /** 'large' is used by the centered hero search on the empty state */
  size?: 'default' | 'large';
}

export default function SearchBar({
  onSearch,
  isLoading,
  placeholder = 'Search for anything...',
  size = 'default',
}: SearchBarProps) {
  const isLarge = size === 'large';
  const [query, setQuery] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [query]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (query.trim()) {
        onSearch(query.trim());
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div
        className={`relative flex items-end gap-2 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-700 shadow-sm hover:border-gray-300 dark:hover:border-gray-600 focus-within:border-blue-500 dark:focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-500/20 transition-all ${
          isLarge
            ? 'rounded-3xl px-6 py-4 shadow-lg dark:border-gray-600'
            : 'rounded-xl px-3.5 py-1.5'
        }`}
      >
        <Search
          className={`text-gray-400 dark:text-gray-500 shrink-0 ${
            isLarge ? 'mt-2.5' : 'mt-1.5'
          }`}
          size={isLarge ? 24 : 18}
        />
        <textarea
          ref={textareaRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={isLoading}
          className={`w-full resize-none bg-transparent text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none leading-relaxed py-0.5 ${
            isLarge ? 'text-lg md:text-xl' : 'text-base'
          }`}
        />
        <button
          type="submit"
          disabled={isLoading || !query.trim()}
          className={`shrink-0 rounded-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 dark:disabled:bg-gray-700 disabled:opacity-50 flex items-center justify-center text-white transition-colors ${
            isLarge ? 'w-11 h-11' : 'w-7 h-7'
          }`}
          aria-label="Search"
        >
          <ArrowUp size={isLarge ? 20 : 14} />
        </button>
      </div>
    </form>
  );
}
