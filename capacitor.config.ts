import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.photoflow',
  appName: 'PhotoFlow',
  webDir: 'www',
  plugins: {
    CapacitorSQLite: {
      // The library database is not encrypted. With encryption on (the plugin default) the plugin
      // opens Keystore-backed prefs at load time, and a restored backup of those prefs (whose key is
      // never backed up) makes the plugin fail to load and the app start on a blank screen.
      androidIsEncryption: false,
    },
  },
};

export default config;
