'use client';

import { useState } from 'react';

interface ShoeSizeFilterProps {
  onSizeSelect: (size: string | null) => void;
  selectedSize: string | null;
}

const SHOE_SIZES = [
  '5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5',
  '10', '10.5', '11', '11.5', '12', '12.5', '13', '13.5', '14', '15'
];

export default function ShoeSizeFilter({ onSizeSelect, selectedSize }: ShoeSizeFilterProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="mb-6 bg-gray-50 dark:bg-[#242424] rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">
          Filter by Shoe Size
        </h3>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {isExpanded ? 'Show less' : 'Show all'}
        </button>
      </div>
      
      <div className={`grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2 ${!isExpanded ? 'max-h-20 overflow-hidden' : ''}`}>
        <button
          onClick={() => onSizeSelect(null)}
          className={`px-3 py-2 text-sm rounded-md border transition-all ${
            selectedSize === null
              ? 'bg-blue-500 text-white border-blue-500'
              : 'bg-white dark:bg-[#1a1a1a] text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500'
          }`}
        >
          All
        </button>
        {SHOE_SIZES.map((size) => (
          <button
            key={size}
            onClick={() => onSizeSelect(size)}
            className={`px-3 py-2 text-sm rounded-md border transition-all ${
              selectedSize === size
                ? 'bg-blue-500 text-white border-blue-500'
                : 'bg-white dark:bg-[#1a1a1a] text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500'
            }`}
          >
            {size}
          </button>
        ))}
      </div>
      
      {selectedSize && (
        <div className="mt-3 text-xs text-gray-600 dark:text-gray-400">
          Showing results with size {selectedSize} in title or description
        </div>
      )}
    </div>
  );
}
