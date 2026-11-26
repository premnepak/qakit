// @ts-check
/**
 * Example: Refactored Tests Using Page Object Model Architecture
 *
 * This file demonstrates best practices for writing QAKit tests using the
 * Page Object Model (POM) architecture. It shows before/after comparisons
 * and common patterns for different types of tests.
 *
 * Run with: npx playwright test example-pom-tests.spec.js
 */

const { test, expect } = require('./fixtures');
const { 
  NetworkMockPage,
  CookieManagerPage,
  PageAuditPage,
  UtilityPage,
  GeolocationPage,
} = require('./pages');

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN 1: Simple Panel Navigation & Verification
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Example: Basic Navigation', () => {
  test('navigate to network mock panel using popup page object', async ({ popup, popupPage }) => {
    // Open panel using the PopupPage helper
    await popup.openPanel('net');
    
    // Verify panel is active
    await expect(popup.panel('net')).toHaveClass(/active/);
  });

  test('navigate between multiple panels', async ({ popup }) => {
    // The PopupPage provides methods for consistent panel navigation
    await popup.openPanel('cookies');
    await expect(popup.panel('cookies')).toHaveClass(/active/);
    
    // Switch to another panel
    await popup.openPanel('utils');
    await expect(popup.panel('utils')).toHaveClass(/active/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN 2: Creating and Managing Rules (Network Mock Example)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Example: Network Mock Page Object', () => {
  test('create a simple network mock rule', async ({ popup, popupPage }) => {
    // Open the network mock panel
    await popup.openPanel('net');
    
    // Create a page object for network mock functionality
    const networkMock = new NetworkMockPage(popupPage);
    
    // Create a rule using the page object method
    // The method handles all details: opening modal, filling form, submitting
    await networkMock.createRule({
      name: 'API Endpoint Mock',
      pattern: '/api/users',
      matchType: 'contains',
      status: '200',
      body: '{"users":[{"id":1,"name":"Alice"}]}',
    });
    
    // Verify the rule was created
    const ruleCount = await networkMock.getRuleCount();
    expect(ruleCount).toBe(1);
  });

  test('create multiple rules and verify list', async ({ popup, popupPage }) => {
    await popup.openPanel('net');
    const networkMock = new NetworkMockPage(popupPage);
    
    // Create first rule
    await networkMock.createRule({
      name: 'GET /api/users',
      pattern: '/api/users',
    });
    
    // Create second rule
    await networkMock.createRule({
      name: 'POST /api/create',
      pattern: '/api/create',
      status: '201',
      body: '{"created":true}',
    });
    
    // Verify both rules exist
    expect(await networkMock.getRuleCount()).toBe(2);
  });

  test('edit and delete rules', async ({ popup, popupPage }) => {
    await popup.openPanel('net');
    const networkMock = new NetworkMockPage(popupPage);
    
    // Create a rule first
    await networkMock.createRule({
      name: 'Original Name',
      pattern: '/api/test',
    });
    
    // Edit the rule (first rule is at index 0)
    await networkMock.editRule(0, {
      name: 'Updated Name',
      status: '500',
    });
    
    // Verify edit
    expect(await networkMock.getRuleCount()).toBe(1);
    
    // Delete the rule
    await networkMock.deleteRule(0);
    
    // Verify deletion
    expect(await networkMock.getRuleCount()).toBe(0);
  });

  test('toggle rule on and off', async ({ popup, popupPage }) => {
    await popup.openPanel('net');
    const networkMock = new NetworkMockPage(popupPage);
    
    // Create a rule
    await networkMock.createRule({
      name: 'Toggle Test',
      pattern: '/api',
    });
    
    // Toggle the rule (disable it)
    await networkMock.toggleRule(0);
    
    // Verify it's still there but disabled
    expect(await networkMock.getRuleCount()).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN 3: Working with Multiple Page Objects in One Test
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Example: Multiple Page Objects', () => {
  test('configure network mock and utilities together', async ({ popup, popupPage }) => {
    // Set up network mock
    await popup.openPanel('net');
    const networkMock = new NetworkMockPage(popupPage);
    await networkMock.createRule({
      name: 'API Mock',
      pattern: '/api',
      status: '200',
      body: '{"status":"ok"}',
    });

    // Verify rule was created
    expect(await networkMock.getRuleCount()).toBe(1);
  });

  test('use geolocation with utilities', async ({ popup, popupPage }) => {
    await popup.openPanel('geo');
    const geo = new GeolocationPage(popupPage);
    
    // Set a location
    await geo.setLocation({
      lat: 51.5074,
      lng: -0.1278,
      accuracy: 50,
    });
    
    // Verify values were set
    const lat = await geo.getLatitude();
    const lng = await geo.getLongitude();
    
    expect(lat).toBe('51.5074');
    expect(lng).toBe('-0.1278');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN 4: Using pageObjects Fixture (Recommended)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Example: pageObjects Fixture', () => {
  test('create rules using the pageObjects fixture', async ({ popup, popupPage, pageObjects }) => {
    // The pageObjects fixture provides factory methods for all page objects
    // This is cleaner than creating them manually each time
    
    await popup.openPanel('net');
    const networkMock = pageObjects.createNetworkMockPage(popupPage);
    
    await networkMock.createRule({
      name: 'Test Rule',
      pattern: '/api/test',
    });
    
    expect(await networkMock.getRuleCount()).toBe(1);
  });

  test('use multiple page objects from pageObjects fixture', async ({ 
    popup, 
    popupPage, 
    pageObjects 
  }) => {
    // Open and work with network mock
    await popup.openPanel('net');
    const net = pageObjects.createNetworkMockPage(popupPage);
    await net.createRule({ name: 'Rule 1', pattern: '/api' });
    
    // Verify first configuration
    expect(await net.getRuleCount()).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN 5: Testing with Setup/Teardown (beforeEach/afterEach)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Example: Setup and Teardown', () => {
  test.beforeEach(async ({ popup, popupPage }) => {
    // Common setup: navigate to network mock panel
    // All tests in this describe block start with this setup
    await popup.openPanel('net');
    
    // Clear any existing rules
    // (This would depend on your extension's storage API)
  });

  test('first test inherits the setup', async ({ popup, popupPage, pageObjects }) => {
    const networkMock = pageObjects.createNetworkMockPage(popupPage);
    
    // Panel is already open, rules are cleared from beforeEach
    await networkMock.createRule({
      name: 'Test 1',
      pattern: '/api',
    });
    
    expect(await networkMock.getRuleCount()).toBe(1);
  });

  test('second test also inherits the same setup', async ({ popup, popupPage, pageObjects }) => {
    const networkMock = pageObjects.createNetworkMockPage(popupPage);
    
    // Fresh state again - beforeEach runs for each test
    await networkMock.createRule({
      name: 'Test 2',
      pattern: '/v2/api',
    });
    
    expect(await networkMock.getRuleCount()).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN 6: Standalone Page Tests
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Example: Standalone Pages', () => {
  test('open and use JSON viewer', async ({ popup, popupPage, context }) => {
    // Open the JSON viewer as a new tab
    const jsonViewerPage = await popup.openStandalone('open-jsondiff');
    
    // Create page object for the new page
    const { JsonViewerPage } = require('./pages');
    const jsonViewer = new JsonViewerPage(jsonViewerPage);
    
    // Paste and verify JSON
    const sampleJson = JSON.stringify({ name: 'QAKit', version: '1.0' });
    await jsonViewer.pasteJson(sampleJson);
    
    // The status should show valid after parsing
    // (Wait for validation to complete)
    await jsonViewerPage.waitForTimeout(1000);
    
    // Clean up
    await jsonViewerPage.close();
  });

  test('open and use text compare tool', async ({ popup, popupPage }) => {
    // Open the text compare tool
    const textComparePage = await popup.openStandalone('open-textcompare');
    
    // Create page object
    const { TextComparePage } = require('./pages');
    const textCompare = new TextComparePage(textComparePage);
    
    // Compare two texts
    await textCompare.compare('hello world', 'hello wörld');
    
    // Verify comparison happened
    const stats = await textCompare.stats.textContent();
    expect(stats).toBeTruthy();
    
    // Clean up
    await textComparePage.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN 7: Async Operations and Waiting
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Example: Async Operations', () => {
  test('page audit with proper wait for completion', async ({ popup, popupPage, pageObjects }) => {
    await popup.openPanel('audit');
    const audit = pageObjects.createPageAuditPage(popupPage);
    
    // Create test page
    const testPage = await popup.page.context().newPage();
    await testPage.goto('https://example.com');
    
    // Run audit on the popup's panel
    await audit.runAudit();
    
    // Verify it's running initially
    expect(await audit.isRunning()).toBe(true);
    
    // Clean up
    await testPage.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN 8: Error Handling and Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Example: Error Handling', () => {
  test('handle empty state gracefully', async ({ popup, popupPage, pageObjects }) => {
    await popup.openPanel('net');
    const networkMock = pageObjects.createNetworkMockPage(popupPage);
    
    // Check empty state
    const isEmptyVisible = await networkMock.isEmptyStateVisible();
    expect(isEmptyVisible).toBe(true);
    
    // Rule count should be 0
    const count = await networkMock.getRuleCount();
    expect(count).toBe(0);
  });

  test('verify modal closes after action', async ({ popup, popupPage, pageObjects }) => {
    await popup.openPanel('net');
    const networkMock = pageObjects.createNetworkMockPage(popupPage);
    
    // Create rule
    await networkMock.createRule({
      name: 'Test',
      pattern: '/api',
    });
    
    // Modal should be hidden after creation
    const isModalVisible = await networkMock.isModalVisible();
    expect(isModalVisible).toBe(false);
  });

  test('close modal manually', async ({ popup, popupPage, pageObjects }) => {
    await popup.openPanel('net');
    const networkMock = pageObjects.createNetworkMockPage(popupPage);
    
    // Don't complete the form, just close
    await networkMock.page.locator('#netAddBtn').click();
    expect(await networkMock.isModalVisible()).toBe(true);
    
    await networkMock.closeModal();
    expect(await networkMock.isModalVisible()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN 9: Testing with Context and Multiple Pages
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Example: Multi-Page Tests', () => {
  test('interact with popup and page content simultaneously', async ({ 
    popup, 
    popupPage, 
    context,
    pageObjects 
  }) => {
    // Set up mock in popup
    await popup.openPanel('net');
    const networkMock = pageObjects.createNetworkMockPage(popupPage);
    await networkMock.createRule({
      name: 'Test Mock',
      pattern: '/api',
      body: '{"data":"mocked"}',
    });
    
    // Create a test page in the context
    const testPage = await context.newPage();
    await testPage.goto('https://example.com');
    
    // The mock is now active for this page
    // You could verify the mock is working by making requests
    
    // Clean up
    await testPage.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN 10: Combining POM with Existing Tests
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Example: Gradual Migration', () => {
  test('old style with direct locator access still works', async ({ popup, popupPage }) => {
    // This style still works (backward compatible)
    await popup.homeTile('net').click();
    await popupPage.locator('#netAddBtn').click();
    
    // But it's not recommended
  });

  test('new style using page objects is preferred', async ({ popup, popupPage, pageObjects }) => {
    // This style is recommended
    await popup.openPanel('net');
    const networkMock = pageObjects.createNetworkMockPage(popupPage);
    
    // Much cleaner and more maintainable
  });

  test('mixed approach: transition test', async ({ popup, popupPage, pageObjects }) => {
    // You can gradually migrate tests
    // Start with page objects for new functionality
    // Keep old patterns for existing tests
    
    await popup.openPanel('net');
    const networkMock = pageObjects.createNetworkMockPage(popupPage);
    await networkMock.createRule({
      name: 'Test',
      pattern: '/api',
    });
    
    // Can still access popup directly if needed
    // (though not recommended)
    await popup.panel('net').waitFor();
  });
});
