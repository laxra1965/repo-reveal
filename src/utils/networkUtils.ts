/**
 * Network utility functions for handling connectivity issues
 */

/**
 * Check if an error is a network error
 */
export function isNetworkError(error: any): boolean {
  if (!error) return false;
  
  const errorMessage = error.message?.toLowerCase() || '';
  const errorName = error.name?.toLowerCase() || '';
  
  return (
    errorMessage.includes('fetch') ||
    errorMessage.includes('network') ||
    errorMessage.includes('failed to fetch') ||
    errorMessage.includes('networkerror') ||
    errorName === 'typeerror' ||
    error.code === 'NETWORK_ERROR' ||
    error.status === 0
  );
}

/**
 * Get a user-friendly error message
 */
export function getErrorMessage(error: any, defaultMessage: string = 'An error occurred'): string {
  if (!error) return defaultMessage;
  
  if (isNetworkError(error)) {
    return 'Failed to connect to server. Please check your internet connection and try again.';
  }
  
  if (error.message) {
    // Handle specific Supabase errors
    if (error.message.includes('Invalid login credentials')) {
      return 'Invalid email or password. Please try again.';
    }
    if (error.message.includes('Email not confirmed')) {
      return 'Please check your email and confirm your account before signing in.';
    }
    if (error.message.includes('User already registered')) {
      return 'An account with this email already exists. Please sign in instead.';
    }
    return error.message;
  }
  
  return defaultMessage;
}

/**
 * Check if the browser is online
 */
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine;
}

/**
 * Wait for network connectivity
 */
export function waitForNetwork(maxWait: number = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    if (isOnline()) {
      resolve(true);
      return;
    }
    
    const timeout = setTimeout(() => {
      resolve(false);
    }, maxWait);
    
    const checkOnline = () => {
      if (isOnline()) {
        clearTimeout(timeout);
        window.removeEventListener('online', checkOnline);
        resolve(true);
      }
    };
    
    window.addEventListener('online', checkOnline);
  });
}

