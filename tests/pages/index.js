// @ts-check
/**
 * Page Objects Index
 *
 * Central export point for all page objects used in QAKit tests.
 * This makes it easy to import and use page objects across test files.
 *
 * Usage:
 *   const { PopupPage, NetworkMockPage, CookieManagerPage } = require('./pages');
 */

module.exports = {
  BasePage: require('./base-page').BasePage,
  PopupPage: require('./popup-page').PopupPage,
  
  // Popup panels
  NetworkMockPage: require('./network-mock-page').NetworkMockPage,
  CookieManagerPage: require('./cookie-manager-page').CookieManagerPage,
  PageAuditPage: require('./page-audit-page').PageAuditPage,
  HeadersPage: require('./headers-page').HeadersPage,
  ConsolePage: require('./console-page').ConsolePage,
  ToolsPage: require('./tools-page').ToolsPage,
  UtilityPage: require('./utility-page').UtilityPage,
  LocalStoragePage: require('./local-storage-page').LocalStoragePage,
  GeolocationPage: require('./geolocation-page').GeolocationPage,
  EnvironmentMarkerPage: require('./environment-marker-page').EnvironmentMarkerPage,
  
  // Standalone pages
  TextComparePage: require('./text-compare-page').TextComparePage,
  JsonViewerPage: require('./json-viewer-page').JsonViewerPage,
  MarkupPage: require('./markup-page').MarkupPage,
};
