// capacitor.config.ts
// Landlord app — separate SKU from tenant MoveOut Shield app.
// appId MUST differ from tenant app's bundle identifier.

import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.moveoutshield.landlord',
  appName: 'MoveOut Shield Landlord',
  webDir: 'dist',
  bundledWebRuntime: false,
  ios: {
    contentInset: 'always',
    scheme: 'MoveOutShieldLandlord',
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#0F172A',
      showSpinner: false,
    },
    Camera: {
      // User-facing strings — landlord-specific wording
      permissions: {
        camera: 'MoveOut Shield Landlord needs camera access to document property condition with photos.',
        photos: 'MoveOut Shield Landlord needs photo library access to save and retrieve inspection photos.',
      },
    },
  },
};

export default config;
