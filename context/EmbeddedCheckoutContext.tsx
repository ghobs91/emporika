'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

/**
 * One embedded checkout session. Created from a Checkout MCP response whose
 * merchant advertises the `embedded` service binding (ECP availability).
 */
export interface EmbeddedCheckoutSession {
  shopDomain: string;
  merchantName: string;
  checkoutId: string;
  /** Merchant `continue_url`, used for the new-tab fallback. */
  continueUrl: string;
  /** `continue_url` plus the ECP query parameters (`ec_version`, …). */
  url: string;
  /** Session-bound UCP version (`ucp.version`). */
  version: string;
  /** Delegations both sides agreed to request (`window.open`). */
  delegates: string[];
}

interface EmbeddedCheckoutContextValue {
  session: EmbeddedCheckoutSession | null;
  openEmbeddedCheckout: (session: EmbeddedCheckoutSession) => void;
  closeEmbeddedCheckout: () => void;
}

const EmbeddedCheckoutContext = createContext<EmbeddedCheckoutContextValue | null>(null);

export function EmbeddedCheckoutProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<EmbeddedCheckoutSession | null>(null);

  const openEmbeddedCheckout = useCallback((next: EmbeddedCheckoutSession) => {
    setSession(next);
  }, []);

  const closeEmbeddedCheckout = useCallback(() => {
    setSession(null);
  }, []);

  return (
    <EmbeddedCheckoutContext.Provider
      value={{ session, openEmbeddedCheckout, closeEmbeddedCheckout }}
    >
      {children}
    </EmbeddedCheckoutContext.Provider>
  );
}

export function useEmbeddedCheckout(): EmbeddedCheckoutContextValue {
  const ctx = useContext(EmbeddedCheckoutContext);
  if (!ctx) {
    throw new Error('useEmbeddedCheckout must be used within an EmbeddedCheckoutProvider');
  }
  return ctx;
}
