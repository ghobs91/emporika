'use client';

import Sidebar from '@/components/Sidebar';
import CartDrawer from '@/components/CartDrawer';
import EmbeddedCheckoutModal from '@/components/EmbeddedCheckoutModal';
import { CartProvider } from '@/context/CartContext';
import { EmbeddedCheckoutProvider } from '@/context/EmbeddedCheckoutContext';

/**
 * Shared application shell: the persistent chrome every route renders inside.
 *
 * Owns the two client stores the whole app depends on (cart, embedded checkout)
 * plus the pieces that must survive navigation — the left nav rail / mobile
 * dock, the cart drawer, and the embedded checkout modal. Pages keep their own
 * header and main content, so `/` (with its hero search bar), `/search/results`,
 * `/deals`, and `/explore` all share one navigation surface instead of each
 * mounting its own.
 *
 * Mounted once in `app/layout.tsx`, so children stay server components.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <EmbeddedCheckoutProvider>
        <div className="min-h-screen flex bg-white dark:bg-[#131313] transition-colors duration-300">
          {/* Left icon rail on desktop, floating dock on mobile */}
          <Sidebar />

          <div className="flex-1 min-w-0 flex flex-col">{children}</div>
        </div>

        <CartDrawer />
        <EmbeddedCheckoutModal />
      </EmbeddedCheckoutProvider>
    </CartProvider>
  );
}
