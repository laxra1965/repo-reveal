import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.64b44d9e8bca4a859edc15e293ba8d8a',
  appName: 'repo-reveal',
  webDir: 'dist',
  server: {
    url: 'https://64b44d9e-8bca-4a85-9edc-15e293ba8d8a.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
