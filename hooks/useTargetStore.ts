'use client';

import { useState, useEffect } from 'react';
import { getUserZipCode, getCachedZipCode } from '@/lib/geolocation';

interface TargetStoreInfo {
  storeId: string;
  zip: string;
}

export function useTargetStore() {
  const [storeInfo, setStoreInfo] = useState<TargetStoreInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initializeStore = async () => {
      try {
        setIsLoading(true);
        
        // Check localStorage cache first
        const cachedStoreId = localStorage.getItem('target_store_id');
        const cachedZip = localStorage.getItem('target_store_zip');
        
        if (cachedStoreId && cachedZip) {
          setStoreInfo({ storeId: cachedStoreId, zip: cachedZip });
          setIsLoading(false);
          return;
        }

        // Try to get user's ZIP code
        let zipCode = getCachedZipCode();
        
        if (!zipCode) {
          zipCode = await getUserZipCode();
        }

        if (zipCode) {
          // The nearest-store lookup goes through Target's Redsky host, which is
          // edge-blocked (see search/providers/availability.ts). The ZIP is still
          // the shopper's destination and drives shipping/pickup filtering for
          // every other retailer, so it must not be discarded along with it.
          const fallback = { storeId: '', zip: zipCode };

          try {
            const response = await fetch(`/api/target/nearest-store?zip=${zipCode}`);
            const data = response.ok ? await response.json() : null;

            if (data?.storeId && data?.zip) {
              const info = { storeId: data.storeId, zip: data.zip };
              setStoreInfo(info);

              // Cache the result
              localStorage.setItem('target_store_id', data.storeId);
              localStorage.setItem('target_store_zip', data.zip);
            } else {
              setStoreInfo(fallback);
            }
          } catch {
            setStoreInfo(fallback);
          }
        }
      } catch (err) {
        console.error('Error initializing Target store:', err);
        setError(err instanceof Error ? err.message : 'Failed to get store info');
      } finally {
        setIsLoading(false);
      }
    };

    initializeStore();
  }, []);

  const refreshStore = async () => {
    // Clear cache and reinitialize
    localStorage.removeItem('target_store_id');
    localStorage.removeItem('target_store_zip');
    localStorage.removeItem('user_zip_code');
    setStoreInfo(null);
    setIsLoading(true);
    
    try {
      const zipCode = await getUserZipCode();
      
      if (zipCode) {
        const fallback = { storeId: '', zip: zipCode };

        try {
          const response = await fetch(`/api/target/nearest-store?zip=${zipCode}`);
          const data = response.ok ? await response.json() : null;

          if (data?.storeId && data?.zip) {
            const info = { storeId: data.storeId, zip: data.zip };
            setStoreInfo(info);
            localStorage.setItem('target_store_id', data.storeId);
            localStorage.setItem('target_store_zip', data.zip);
          } else {
            setStoreInfo(fallback);
          }
        } catch {
          setStoreInfo(fallback);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh store');
    } finally {
      setIsLoading(false);
    }
  };

  return { storeInfo, isLoading, error, refreshStore };
}
