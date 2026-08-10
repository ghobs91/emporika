'use client';

// ── WebLLM status indicator ────────────────────────────────────────────
//
// Shows one of:
// - "Local AI planner ready."           (green, Brain icon)
// - "Loading local AI planner: 42%."    (blue, spinner)
// - "Using fast search mode"            (gray, Zap icon — normal fallback)
// - "AI planner error"                  (amber, AlertTriangle — real error)

import { useEffect, useState } from 'react';
import { Brain, Loader2, Zap, AlertTriangle } from 'lucide-react';

export type WebLLMStatus = 'idle' | 'loading' | 'ready' | 'fast' | 'error' | 'disabled';

interface WebLLMStatusProps {
  status: WebLLMStatus;
  progress?: number;
  error?: string;
}

export default function WebLLMStatusIndicator({ status, progress = 0, error }: WebLLMStatusProps) {
  if (status === 'idle' || status === 'disabled') return null;

  const configs: Record<WebLLMStatus, { icon: React.ReactNode; text: string; className: string }> = {
    idle: { icon: null, text: '', className: '' },
    disabled: { icon: null, text: '', className: '' },
    ready: {
      icon: <Brain size={14} />,
      text: 'Local AI planner ready.',
      className: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
    },
    loading: {
      icon: <Loader2 size={14} className="animate-spin" />,
      text: `Loading local AI planner: ${Math.round(progress * 100)}%`,
      className: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800',
    },
    fast: {
      icon: <Zap size={14} />,
      text: 'Using fast search mode',
      className: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700',
    },
    error: {
      icon: <AlertTriangle size={14} />,
      text: 'AI planner error',
      className: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
    },
  };

  const config = configs[status];
  if (!config.icon) return null;

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all duration-200 ${config.className}`}
      title={status === 'error' ? error : status === 'fast' ? 'Local AI model unavailable — using server-side deterministic planner' : undefined}
    >
      {config.icon}
      <span>{config.text}</span>
    </div>
  );
}

/**
 * Toggle between AI-assisted and fast search modes.
 */
interface SearchModeToggleProps {
  aiEnabled: boolean;
  onToggle: () => void;
}

export function SearchModeToggle({ aiEnabled, onToggle }: SearchModeToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all duration-200 ${
        aiEnabled
          ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700'
      }`}
    >
      {aiEnabled ? <Brain size={14} /> : <Zap size={14} />}
      <span>{aiEnabled ? 'AI search on' : 'Fast search'}</span>
    </button>
  );
}
