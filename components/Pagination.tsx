'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  /** Total item count, used for the "Showing X–Y of Z" label. */
  totalItems?: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

function getPageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  // Sliding window of 5 pages centered on the current page
  let start = Math.max(1, current - 2);
  const end = Math.min(total, start + 4);
  start = Math.max(1, end - 4);

  const pages: (number | 'ellipsis')[] = [];
  if (start > 1) pages.push(1);
  if (start > 2) pages.push('ellipsis');
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < total - 1) pages.push('ellipsis');
  if (end < total) pages.push(total);
  return pages;
}

export default function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const from = totalItems !== undefined ? (currentPage - 1) * pageSize + 1 : undefined;
  const to =
    totalItems !== undefined
      ? Math.min(currentPage * pageSize, totalItems)
      : undefined;

  const buttonClass = (active: boolean) =>
    `min-w-8 h-8 px-2 inline-flex items-center justify-center text-sm rounded-lg border transition-colors ${
      active
        ? 'bg-blue-500 border-blue-500 text-white font-medium'
        : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-[#242424] text-gray-700 dark:text-gray-300 hover:border-gray-500 dark:hover:border-gray-500'
    }`;

  return (
    <nav aria-label="Search results pagination" className="flex flex-col items-center gap-3 mt-8">
      {totalItems !== undefined && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Showing {from}–{to} of {totalItems.toLocaleString()} results
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Previous page"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          className={`${buttonClass(false)} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-gray-300 dark:disabled:hover:border-gray-700`}
        >
          <ChevronLeft size={16} />
        </button>

        {getPageNumbers(currentPage, totalPages).map((page, i) =>
          page === 'ellipsis' ? (
            <span
              key={`ellipsis-${i}`}
              className="px-1 text-sm text-gray-400 dark:text-gray-500 select-none"
            >
              …
            </span>
          ) : (
            <button
              key={page}
              type="button"
              aria-label={`Page ${page}`}
              aria-current={page === currentPage ? 'page' : undefined}
              onClick={() => onPageChange(page)}
              className={buttonClass(page === currentPage)}
            >
              {page}
            </button>
          )
        )}

        <button
          type="button"
          aria-label="Next page"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className={`${buttonClass(false)} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-gray-300 dark:disabled:hover:border-gray-700`}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </nav>
  );
}
