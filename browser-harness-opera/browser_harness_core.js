/*
 * Modern Promise-based Driver / ElementProxy facade preserving the operating model
 * of scriby/browser-harness (MIT): controller-side Driver, browser-side element proxies,
 * find/findVisible, waitFor, action then condition.
 */
(function(root){
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

  function matchesDescriptor(d, spec = {}) {
    if (!d) return false;
    if (spec.ref && d.ref !== spec.ref) return false;
    if (spec.role && norm(d.role) !== norm(spec.role)) return false;
    if (spec.tag && norm(d.tag) !== norm(spec.tag)) return false;
    if (spec.name) {
      const hay = norm(d.name);
      const needle = norm(spec.name);
      if (spec.exact ? hay !== needle : !hay.includes(needle)) return false;
    }
    if (spec.label) {
      const hay = norm(d.label);
      const needle = norm(spec.label);
      if (spec.exact ? hay !== needle : !hay.includes(needle)) return false;
    }
    if (spec.text) {
      const hay = norm(d.text);
      const needle = norm(spec.text);
      if (spec.exact ? hay !== needle : !hay.includes(needle)) return false;
    }
    const hints = spec.hints || {};
    for (const key of ['id','name','testid','aria','placeholder','type','hrefPath']) {
      if (hints[key] && norm(d.hints?.[key]) !== norm(hints[key])) return false;
    }
    return true;
  }

  class ElementProxy {
    constructor(driver, descriptor) {
      this.driver = driver;
      this.descriptor = JSON.parse(JSON.stringify(descriptor || {}));
      this.isElementProxy = true;
    }
    target(extra = {}) {
      return {
        ...this.descriptor,
        ...extra,
        hints: {...(this.descriptor.hints || {}), ...(extra.hints || {})}
      };
    }
    async click(extra = {}) { return this.driver.act({type:'click', target:this.target(extra)}); }
    async focus(extra = {}) { return this.driver.act({type:'focus', target:this.target(extra)}); }
    async fill(value, extra = {}) { return this.driver.act({type:'fill', target:this.target(extra), value}); }
    async val(value) {
      if (arguments.length === 0) return this.readValue();
      return this.fill(value);
    }
    async selectDropdownByText(text) { return this.driver.act({type:'select', target:this.target(), optionText:text}); }
    async selectDropdownByValue(value) { return this.driver.act({type:'select', target:this.target(), value}); }
    async check() { return this.driver.act({type:'check', target:this.target()}); }
    async uncheck() { return this.driver.act({type:'uncheck', target:this.target()}); }
    async submit() { return this.driver.act({type:'submit', target:this.target()}); }
    async assert(spec = {}) { return this.driver.act({type:'assert', target:this.target(), ...spec}); }
    async readValue() { return this.driver.act({type:'read_value', target:this.target()}); }
    async scrollIntoView(extra = {}) { return this.driver.act({type:'scroll', target:this.target(), ...extra}); }
  }

  class Driver {
    constructor(tabId) {
      this.tabId = Number(tabId);
      if (!Number.isInteger(this.tabId)) throw new Error('tabId must be an integer');
    }

    async tab() {
      const tab = await chrome.tabs.get(this.tabId).catch(() => null);
      if (!tab) throw new Error('BOUND_TAB_CLOSED');
      return tab;
    }

    async ensureClient() {
      await this.tab();
      try {
        const pong = await chrome.tabs.sendMessage(this.tabId, {type:'BH_PING'});
        if (pong?.ok) return pong;
      } catch {}
      await chrome.scripting.executeScript({target:{tabId:this.tabId}, files:['browser_harness_client.js']});
      const pong = await chrome.tabs.sendMessage(this.tabId, {type:'BH_PING'});
      if (!pong?.ok) throw new Error('BROWSER_HARNESS_CLIENT_NOT_READY');
      return pong;
    }

    async send(message) {
      await this.ensureClient();
      try {
        return await chrome.tabs.sendMessage(this.tabId, message);
      } catch (err) {
        await this.ensureClient();
        return chrome.tabs.sendMessage(this.tabId, message);
      }
    }

    async inspect(options = {}) {
      const result = await this.send({type:'BH_INSPECT', max:options.max || 200});
      if (!result?.ok) throw new Error(result?.error || 'INSPECT_FAILED');
      return result;
    }

    async read(options = {}) {
      const result = await this.send({type:'BH_READ', maxChars:options.maxChars || 16000, tail:!!options.tail});
      if (!result?.ok) throw new Error(result?.error || 'READ_FAILED');
      return result;
    }

    async act(action) {
      const result = await this.send({type:'BH_ACT', action});
      if (!result?.ok && !result?.recoverable) throw new Error(result?.error || 'ACTION_FAILED');
      return result;
    }

    async findElements(spec = {}, options = {}) {
      const timeoutMs = Number(options.timeoutMs || spec.timeoutMs || 10000);
      const started = Date.now();
      do {
        const scan = await this.inspect({max:options.max || 400});
        const found = scan.elements.filter(d => matchesDescriptor(d, spec));
        if (found.length) return found.map(d => new ElementProxy(this, d));
        if (Date.now() - started >= timeoutMs) break;
        await sleep(Number(options.retryMs || 150));
      } while (true);
      return [];
    }

    async findElement(spec = {}, options = {}) {
      const elements = await this.findElements(spec, options);
      if (!elements.length) throw new Error(`Element not found: ${JSON.stringify(spec)}`);
      if (elements.length > 1 && options.allowMultiple !== true) {
        throw new Error(`Too many elements found (${elements.length}): ${JSON.stringify(spec)}`);
      }
      return elements[0];
    }

    async findVisible(spec = {}, options = {}) { return this.findElement(spec, options); }
    async findVisibles(spec = {}, options = {}) { return this.findElements(spec, options); }
    async find(spec = {}, options = {}) { return this.findElement(spec, options); }

    async waitFor(condition, options = {}) {
      if (typeof condition !== 'function') throw new Error('waitFor requires a read-only condition function');
      const timeoutMs = Number(options.timeoutMs || 10000);
      const retryMs = Number(options.retryMs || 150);
      const started = Date.now();
      let lastError = null;
      while (Date.now() - started < timeoutMs) {
        try {
          const value = await condition(this);
          if (value) return value;
        } catch (err) { lastError = err; }
        await sleep(retryMs);
      }
      const suffix = lastError ? `; last error: ${lastError.message || lastError}` : '';
      throw new Error(`waitFor condition timed out (${timeoutMs})${suffix}`);
    }

    async waitForElement(spec = {}, options = {}) {
      return this.waitFor(async driver => {
        const list = await driver.findElements(spec, {timeoutMs:0, max:options.max || 400});
        return list[0] || false;
      }, options);
    }

    async waitForText(text, options = {}) {
      const wanted = norm(text);
      return this.waitFor(async driver => {
        const page = await driver.read({maxChars:options.maxChars || 50000, tail:!!options.tail});
        return norm(page.text).includes(wanted) ? page : false;
      }, options);
    }

    async navigate(url, options = {}) {
      const before = await this.tab();
      const target = new URL(String(url), before.url).href;
      await chrome.tabs.update(this.tabId, {url:target});
      const timeoutMs = Number(options.timeoutMs || 25000);
      const started = Date.now();
      await this.waitFor(async () => {
        const tab = await this.tab();
        return tab.status === 'complete' ? tab : false;
      }, {timeoutMs, retryMs:200});
      await this.ensureClient();
      return this.tab();
    }
  }

  const api = {Driver, ElementProxy, matchesDescriptor, sleep};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BH_CORE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
