// @ts-check
const { BasePage } = require('./base-page');

/**
 * Page object for utility tools.
 * Handles base64 encoding/decoding, JWT, URL encoding, timezone conversion, etc.
 */
class UtilityPage extends BasePage {
  constructor(page) {
    super(page);
    // Base64 tools
    this.b64Input = page.locator('#b64Input');
    this.b64Output = page.locator('#b64Output');
    this.b64EncodeBtn = page.locator('#b64EncodeBtn');
    this.b64DecodeBtn = page.locator('#b64DecodeBtn');
    this.b64UrlEncBtn = page.locator('#b64UrlEncBtn');
    
    // URL encoding
    this.urlInput = page.locator('#urlInput');
    this.urlOutput = page.locator('#urlOutput');
    this.urlEncodeBtn = page.locator('#urlEncodeBtn');
    this.urlDecodeBtn = page.locator('#urlDecodeBtn');
    this.urlFullEncBtn = page.locator('#urlFullEncBtn');
    
    // JWT tools
    this.jwtInput = page.locator('#jwtInput');
    this.jwtDecodeOut = page.locator('#jwtDecodeOut');
    this.jwtEncodeOut = page.locator('#jwtEncodeOut');
    this.jwtDecodeBtn = page.locator('#jwtDecodeBtn');
    this.jwtEncodeBtn = page.locator('#jwtEncodeBtn');
    this.jwtPayInput = page.locator('#jwtPayInput');
    
    // Time tools
    this.epochInput = page.locator('#epochInput');
    this.epochNowBtn = page.locator('#epochNowBtn');
    this.epochUnit = page.locator('#epochUnit');
    this.humanDateInput = page.locator('#humanDateInput');
    this.humanNowBtn = page.locator('#humanNowBtn');
    
    // Timezone conversion
    this.tzFrom = page.locator('#tzFrom');
    this.tzTo = page.locator('#tzTo');
    this.tzSwapBtn = page.locator('#tzSwapBtn');
    this.tzConvertBtn = page.locator('#tzConvertBtn');
  }

  /**
   * Encode a string to base64.
   * @param {string} input
   * @returns {Promise<string>}
   */
  async encodeBase64(input) {
    await this.b64Input.fill(input);
    await this.b64EncodeBtn.click();
    return this.getText(this.b64Output);
  }

  /**
   * Decode a base64 string.
   * @param {string} input
   * @returns {Promise<string>}
   */
  async decodeBase64(input) {
    await this.b64Input.fill(input);
    await this.b64DecodeBtn.click();
    return this.getText(this.b64Output);
  }

  /**
   * URL encode a string.
   * @param {string} input
   * @returns {Promise<string>}
   */
  async encodeUrl(input) {
    await this.urlInput.fill(input);
    await this.urlEncodeBtn.click();
    return this.getText(this.urlOutput);
  }

  /**
   * URL decode a string.
   * @param {string} input
   * @returns {Promise<string>}
   */
  async decodeUrl(input) {
    await this.urlInput.fill(input);
    await this.urlDecodeBtn.click();
    return this.getText(this.urlOutput);
  }

  /**
   * Decode a JWT token.
   * @param {string} token
   * @returns {Promise<string>}
   */
  async decodeJwt(token) {
    await this.jwtInput.fill(token);
    await this.jwtDecodeBtn.click();
    return this.getText(this.jwtDecodeOut);
  }

  /**
   * Encode a payload as JWT.
   * @param {string} payload
   * @returns {Promise<string>}
   */
  async encodeJwt(payload) {
    await this.jwtPayInput.fill(payload);
    await this.jwtEncodeBtn.click();
    return this.getText(this.jwtEncodeOut);
  }

  /**
   * Convert epoch timestamp to human-readable date.
   * @param {string} epoch
   * @returns {Promise<string>}
   */
  async convertFromEpoch(epoch) {
    await this.epochInput.fill(epoch);
    await this.page.waitForTimeout(500);
    return this.getText(this.humanDateInput);
  }

  /**
   * Convert human-readable date to epoch timestamp.
   * @param {string} date
   * @returns {Promise<string>}
   */
  async convertToEpoch(date) {
    await this.humanDateInput.fill(date);
    await this.page.waitForTimeout(500);
    return this.getText(this.epochInput);
  }

  /**
   * Set epoch to current time.
   */
  async setEpochToNow() {
    await this.epochNowBtn.click();
  }

  /**
   * Set human date to now.
   */
  async setHumanDateToNow() {
    await this.humanNowBtn.click();
  }

  /**
   * Convert time between timezones.
   * @param {string} fromTz - Timezone code
   * @param {string} toTz - Timezone code
   * @returns {Promise<string>}
   */
  async convertTimezone(fromTz, toTz) {
    await this.tzFrom.selectOption(fromTz);
    await this.tzTo.selectOption(toTz);
    await this.tzConvertBtn.click();
    return this.getText(this.page.locator('#tzResult'));
  }

  /**
   * Swap timezone conversion.
   */
  async swapTimezones() {
    await this.tzSwapBtn.click();
  }
}

module.exports = { UtilityPage };
