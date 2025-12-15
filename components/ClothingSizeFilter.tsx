'use client';

import { useState } from 'react';

interface ClothingSizeFilterProps {
  onSizeSelect: (size: string | null) => void;
  selectedSize: string | null;
  clothingType: 'tops' | 'bottoms' | 'general';
}

const TOPS_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const BOTTOMS_SIZES = ['26', '28', '29', '30', '31', '32', '33', '34', '36', '38', '40', '42', '44'];
const GENERAL_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '0', '2', '4', '6', '8', '10', '12', '14', '16', '18'];

export default function ClothingSizeFilter({ onSizeSelect, selectedSize, clothingType }: ClothingSizeFilterProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const sizes = clothingType === 'tops' 
    ? TOPS_SIZES 
    : clothingType === 'bottoms' 
    ? BOTTOMS_SIZES 
    : GENERAL_SIZES;

  const getTitle = () => {
    switch (clothingType) {
      case 'tops':
        return 'Filter by Top Size';
      case 'bottoms':
        return 'Filter by Pant Size';
      default:
        return 'Filter by Clothing Size';
    }
  };

  return (
    <div className="mb-6 bg-gray-50 dark:bg-[#242424] rounded-lg p-4 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">
          {getTitle()}
        </h3>
        {sizes.length > 10 && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
          >
            {isExpanded ? 'Show less' : 'Show all'}
          </button>
        )}
      </div>
      
      <div className={`grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2 ${!isExpanded && sizes.length > 10 ? 'max-h-20 overflow-hidden' : ''}`}>
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
        {sizes.map((size) => (
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
