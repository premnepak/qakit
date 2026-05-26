// @ts-check
const { defineConfig } = require('@playwright/test');
const path = require('path');

const extensionPath = path.resolve(__dirname, 'src');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI ? [['list'], ['html']] : 'html',
  // Each spec file gets a fresh browser context via the fixtures — no shared use: block needed.
  use: {
    browserName: 'chromium',
    headless: true, // Run in headless mode for CI compatibility
    launchOptions: {
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    },
  },
});