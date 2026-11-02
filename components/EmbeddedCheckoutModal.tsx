'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Link2,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useCart } from '@/context/CartContext';
import {
  useEmbeddedCheckout,
  type EmbeddedCheckoutSession,
} from '@/context/EmbeddedCheckoutContext';
import { useEcpSession } from '@/hooks/useEcpSession';

/** How long to wait for `ec.ready` before assuming the merchant page cannot be framed. */
const CONNECT_TIMEOUT_MS = 12_000;

/** React has no type for the `credentialless` iframe attribute yet. */
const CREDENTIALLESS_IFRAME = { credentialless: '' } as Record<string, string>;

function linkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Embedded checkout surface (ECP). Mounted once; renders nothing until
 * `useMerchantCheckout` opens a session.
 */
export default function EmbeddedCheckoutModal() {
  const { session } = useEmbeddedCheckout();
  if (!session) return null;
  // Keyed by checkout id so a new checkout always gets a fresh protocol state machine.
  return <EmbeddedCheckoutPanel key={session.checkoutId} session={session} />;
}

function EmbeddedCheckoutPanel({ session }: { session: EmbeddedCheckoutSession }) {
  const { closeEmbeddedCheckout } = useEmbeddedCheckout();
  const { removeMerchantItems } = useCart();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const handedOffRef = useRef(false);
  const [timedOut, setTimedOut] = useState(false);

  const handleComplete = useCallback(() => {
    // The merchant created the order — drop this merchant's local cart lines.
    removeMerchantItems(session.shopDomain);
  }, [removeMerchantItems, session.shopDomain]);

  const { status, order, error, pendingWindow, answerWindowOpen } = useEcpSession({
    session,
    iframe: iframeRef,
    onComplete: handleComplete,
  });

  /** Hand the buyer to the merchant's own checkout tab. */
  const handOff = useCallback(() => {
    window.open(session.continueUrl, '_blank', 'noopener,noreferrer');
  }, [session.continueUrl]);

  // Checkout renders nothing until it receives `ec.ready`; if that never
  // arrives the page is likely unframeable, so fall back to the redirect.
  useEffect(() => {
    if (status !== 'connecting') return;
    const timer = setTimeout(() => setTimedOut(true), CONNECT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status]);

  // A late `ec.ready` wins over the timeout: only a still-connecting session
  // counts as a failed embed.
  const connectionTimedOut = timedOut && status === 'connecting';
  const needsHandoff = status === 'error' || connectionTimedOut;

  // Auto-attempt the handoff once. Browsers may block it without a user
  // gesture, so the overlay always offers a button as well.
  useEffect(() => {
    if (!needsHandoff || handedOffRef.current) return;
    handedOffRef.current = true;
    handOff();
  }, [needsHandoff, handOff]);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeEmbeddedCheckout();
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = 'unset';
    };
  }, [closeEmbeddedCheckout]);

  const showIframe = status === 'active' || status === 'complete';

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Checkout with ${session.merchantName}`}
        className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-white shadow-2xl dark:bg-[#1a1a1a] sm:h-[85vh] sm:rounded-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-3 dark:border-gray-800">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldCheck size={18} className="shrink-0 text-green-600" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                {session.merchantName}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Secure checkout in Emporika
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            onClick={closeEmbeddedCheckout}
            aria-label="Close checkout"
            className="rounded-lg p-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Embedded checkout */}
        <div className="relative flex-1 overflow-hidden bg-white dark:bg-[#1a1a1a]">
          <iframe
            ref={iframeRef}
            src={session.url}
            title={`Checkout with ${session.merchantName}`}
            sandbox="allow-scripts allow-forms allow-same-origin"
            allow="payment *"
            referrerPolicy="no-referrer"
            {...CREDENTIALLESS_IFRAME}
            className={
              showIframe
                ? 'h-full w-full border-0'
                : 'invisible h-full w-full border-0'
            }
          />

          {status === 'connecting' && !connectionTimedOut && (
            <div
              role="status"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white px-8 text-center dark:bg-[#1a1a1a]"
            >
              <Loader2 size={28} className="animate-spin text-green-600" />
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Connecting to {session.merchantName}…
              </p>
              <p className="text-xs text-gray-400">
                If this takes too long, checkout opens in a new tab instead.
              </p>
            </div>
          )}

          {needsHandoff && (
            <div
              role="alert"
              className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-white px-8 text-center dark:bg-[#1a1a1a]"
            >
              <AlertTriangle size={28} className="text-amber-500" />
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {connectionTimedOut
                    ? 'Embedded checkout did not load'
                    : 'Checkout could not continue here'}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {connectionTimedOut
                    ? `${session.merchantName} may only allow checkout in its own tab.`
                    : error?.content ?? 'The merchant stopped the embedded session.'}
                </p>
              </div>
              <button
                onClick={handOff}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700"
              >
                Open checkout in a new tab
                <ExternalLink size={14} />
              </button>
              <button
                onClick={closeEmbeddedCheckout}
                className="text-xs text-gray-400 transition-colors hover:text-red-500"
              >
                Cancel
              </button>
            </div>
          )}

          {status === 'complete' && (
            <div
              role="status"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white px-8 text-center dark:bg-[#1a1a1a]"
            >
              <CheckCircle2 size={32} className="text-green-600" />
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Order placed
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Your order with {session.merchantName} is confirmed.
              </p>
              {order?.id && (
                <p className="font-mono text-[11px] text-gray-400">{order.id}</p>
              )}
              <div className="mt-2 flex items-center gap-2">
                {order?.permalinkUrl && (
                  <a
                    href={order.permalinkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    View order
                  </a>
                )}
                <button
                  onClick={closeEmbeddedCheckout}
                  className="rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-green-700"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Delegated link request (window.open) — nothing opens without a click. */}
        {pendingWindow && (
          <div className="flex items-center gap-3 border-t border-gray-200 bg-gray-50 px-5 py-3 dark:border-gray-800 dark:bg-[#242424]">
            <Link2 size={16} className="shrink-0 text-gray-400" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-gray-900 dark:text-gray-100">
                The merchant wants to open a link
              </p>
              <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                {linkHost(pendingWindow.url)}
              </p>
            </div>
            <button
              onClick={() => answerWindowOpen(true)}
              className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-700"
            >
              Open
            </button>
            <button
              onClick={() => answerWindowOpen(false)}
              className="text-xs text-gray-500 transition-colors hover:text-red-500"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Footer */}
        {status === 'active' && (
          <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-5 py-2 text-[11px] text-gray-400 dark:border-gray-800">
            <span>Payment is handled by {session.merchantName}.</span>
            <a
              href={session.continueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 transition-colors hover:text-green-600"
            >
              Open in browser
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
