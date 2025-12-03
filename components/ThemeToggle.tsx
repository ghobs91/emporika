'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Check for saved theme preference or default to light mode
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      setIsDark(true);
      document.documentElement.classList.add('dark');
    } else {
      setIsDark(false);
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const toggleTheme = () => {
    if (isDark) {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
      setIsDark(false);
    } else {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
      setIsDark(true);
    }
  };

  return (
    <button
      onClick={toggleTheme}
      className="p-3 rounded-xl bg-blue-100 dark:bg-gray-700 hover:bg-blue-200 dark:hover:bg-gray-600 border-2 border-blue-200 dark:border-gray-600 transition-all duration-300 shadow-md hover:shadow-lg hover:scale-110"
      aria-label="Toggle theme"
    >
      {isDark ? (
        <Sun size={22} className="text-yellow-500" />
      ) : (
        <Moon size={22} className="text-blue-600" />
      )}
    </button>
  );
}
