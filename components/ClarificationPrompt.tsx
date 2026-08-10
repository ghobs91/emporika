'use client';

// ── Clarification prompt component ─────────────────────────────────────
//
// Renders a clarification question when the planner determines more
// information is needed before searching.

import { HelpCircle, X } from 'lucide-react';

interface ClarificationPromptProps {
  field: string;
  question: string;
  reason: string;
  onDismiss: () => void;
}

export default function ClarificationPrompt({
  field,
  question,
  reason,
  onDismiss,
}: ClarificationPromptProps) {
  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            <HelpCircle size={18} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-1">
              Help narrow your search
            </h3>
            <p className="text-sm text-amber-700 dark:text-amber-300 mb-2">
              {question}
            </p>
            <p className="text-xs text-amber-600/70 dark:text-amber-400/70">
              {reason}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 p-1"
          aria-label="Dismiss clarification"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
