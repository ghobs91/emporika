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
          // Fetch nearest store from API
          const response = await fetch(`/api/target/nearest-store?zip=${zipCode}`);
          
          if (response.ok) {
            const data = await response.json();
            if (data.storeId && data.zip) {
              const info = { storeId: data.storeId, zip: data.zip };
              setStoreInfo(info);
              
              // Cache the result
              localStorage.setItem('target_store_id', data.storeId);
              localStorage.setItem('target_store_zip', data.zip);
            }
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
        const response = await fetch(`/api/target/nearest-store?zip=${zipCode}`);
        
        if (response.ok) {
          const data = await response.json();
          if (data.storeId && data.zip) {
            const info = { storeId: data.storeId, zip: data.zip };
            setStoreInfo(info);
            localStorage.setItem('target_store_id', data.storeId);
            localStorage.setItem('target_store_zip', data.zip);
          }
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
