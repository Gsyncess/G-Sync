import type { CapacitorConfig } from '@capacitor/cli';

const configuredServerUrl = process.env.CAPACITOR_SERVER_URL?.trim();
const serverHost = configuredServerUrl ? new URL(configuredServerUrl).host : null;

const config: CapacitorConfig = {
  appId: 'com.gsync.app',
  appName: 'G-Sync',
  webDir: 'www',
  server: configuredServerUrl
    ? {
        url: configuredServerUrl,
        androidScheme: 'https',
        allowNavigation: [serverHost ?? 'localhost', 'localhost', '127.0.0.1'],
      }
    : {
        androidScheme: 'https',
        allowNavigation: ['*'],
      },
};

export default config;
