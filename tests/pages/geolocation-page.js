// @ts-check
const { BasePage } = require('./base-page');

/**
 * Page object for the Geolocation panel.
 * Handles geolocation override settings.
 */
class GeolocationPage extends BasePage {
  constructor(page) {
    super(page);
    this.lat = page.locator('#geoLat');
    this.lng = page.locator('#geoLng');
    this.accuracy = page.locator('#geoAccuracy');
    this.presetSelect = page.locator('#geoPresetSelect');
    this.applyBtn = page.locator('#geoApplyBtn');
    this.clearBtn = page.locator('#geoClearBtn');
  }

  /**
   * Set latitude coordinate.
   * @param {string|number} lat
   */
  async setLatitude(lat) {
    await this.lat.fill(String(lat));
  }

  /**
   * Set longitude coordinate.
   * @param {string|number} lng
   */
  async setLongitude(lng) {
    await this.lng.fill(String(lng));
  }

  /**
   * Set accuracy.
   * @param {string|number} accuracy
   */
  async setAccuracy(accuracy) {
    await this.accuracy.fill(String(accuracy));
  }

  /**
   * Select a preset location.
   * @param {string} presetValue
   */
  async selectPreset(presetValue) {
    await this.presetSelect.selectOption(presetValue);
  }

  /**
   * Get available presets.
   * @returns {Promise<string[]>}
   */
  async getPresets() {
    const options = this.page.locator('#geoPresetSelect option');
    const count = await options.count();
    const presets = [];
    for (let i = 0; i < count; i++) {
      const value = await this.getAttribute(options.nth(i), 'value');
      if (value) presets.push(value);
    }
    return presets;
  }

  /**
   * Apply geolocation settings.
   */
  async apply() {
    await this.applyBtn.click();
  }

  /**
   * Clear geolocation settings.
   */
  async clear() {
    await this.clearBtn.click();
  }

  /**
   * Set a specific location by coordinates.
   * @param {object} opts
   * @param {string|number} opts.lat
   * @param {string|number} opts.lng
   * @param {string|number} opts.accuracy
   */
  async setLocation(opts = {}) {
    const { lat = 0, lng = 0, accuracy = 100 } = opts;
    await this.setLatitude(lat);
    await this.setLongitude(lng);
    await this.setAccuracy(accuracy);
    await this.apply();
  }

  /**
   * Get current latitude value.
   * @returns {Promise<string>}
   */
  async getLatitude() {
    return this.lat.inputValue();
  }

  /**
   * Get current longitude value.
   * @returns {Promise<string>}
   */
  async getLongitude() {
    return this.lng.inputValue();
  }

  /**
   * Get current accuracy value.
   * @returns {Promise<string>}
   */
  async getAccuracy() {
    return this.accuracy.inputValue();
  }
}

module.exports = { GeolocationPage };
