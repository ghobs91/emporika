/**
 * Get user's ZIP code from browser geolocation
 * Uses reverse geocoding to convert coordinates to ZIP code
 */
export async function getUserZipCode(): Promise<string | null> {
  try {
    // Check if geolocation is available
    if (!navigator.geolocation) {
      console.warn('Geolocation is not supported by this browser');
      return null;
    }

    // Get user's position
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: 10000,
        maximumAge: 300000, // Cache for 5 minutes
      });
    });

    const { latitude, longitude } = position.coords;

    // Use a reverse geocoding service to get ZIP code
    // Using Nominatim (OpenStreetMap) as it's free and doesn't require API key
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'Emporika Shopping App',
        },
      }
    );

    if (!response.ok) {
      console.error('Reverse geocoding failed');
      return null;
    }

    const data = await response.json();
    const zipCode = data.address?.postcode;

    if (zipCode) {
      // Store in localStorage for future use
      localStorage.setItem('user_zip_code', zipCode);
      return zipCode;
    }

    return null;
  } catch (error) {
    console.error('Error getting user location:', error);
    
    // Try to get from localStorage as fallback
    const cachedZip = localStorage.getItem('user_zip_code');
    if (cachedZip) {
      return cachedZip;
    }
    
    return null;
  }
}

/**
 * Get cached ZIP code from localStorage
 */
export function getCachedZipCode(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('user_zip_code');
}

/**
 * Clear cached location data
 */
export function clearCachedLocation(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('user_zip_code');
  localStorage.removeItem('target_store_id');
  localStorage.removeItem('target_store_zip');
}
