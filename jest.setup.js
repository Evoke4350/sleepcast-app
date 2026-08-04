// MMKV is a native module: createMMKV() reaches through nitro to C++ that does
// not exist in a jest process. src/platform/storage.ts calls it at import time,
// on purpose — it installs the localStorage polyfill as a side effect before
// any shared player code runs — so merely importing App.tsx crashed the suite.
//
// react-native-mmkv ships its own in-memory mock, so use that rather than
// hand-rolling a Map: it tracks the real API, including the methods
// storage.ts depends on (getString, set, remove, getAllKeys, clearAll).
// Reach straight for the mock's own module. Requiring the package entry — even
// via requireActual, to spread its other exports — pulls in nitro's
// TurboModuleRegistry.getEnforcing, which is the exact native call being
// avoided here. storage.ts imports createMMKV and nothing else.
jest.mock('react-native-mmkv', () => {
  const {
    createMockMMKV,
  } = jest.requireActual('react-native-mmkv/lib/createMMKV/createMockMMKV');
  return {createMMKV: () => createMockMMKV()};
});

// SafeAreaProvider reads its insets from a native module. Without one it
// renders null children rather than failing loudly, so every testID in the
// tree simply stops existing and the failure reads as "component missing"
// instead of "no safe-area provider". The library ships a mock for exactly
// this; the .tsx extension is explicit because jest's default resolver
// doesn't try it for a bare subpath.
jest.mock(
  'react-native-safe-area-context',
  // .default because the mock is an ES default export and this require is
  // interop'd, not a namespace import.
  () => require('react-native-safe-area-context/jest/mock.tsx').default,
);

// Install localStorage polyfill after mocks are set up, so that shared player
// code can use it synchronously without async setup.
// Jest's React Native preset provides an empty localStorage, so delete it first.
const { installLocalStorage } = require('./src/platform/storage');
delete global.localStorage;
installLocalStorage();

// Provide a DOMParser for the shared player code's XML feed parsing.
// The shared engine.ts uses DOMParser; for Jest we provide a simple
// implementation backed by fast-xml-parser.
const { XMLParser } = require('fast-xml-parser');

class MockElement {
  constructor(data, localName) {
    this.data = data;
    this.localName = localName;
  }

  getAttribute(name) {
    if (typeof this.data !== 'object') return null;
    const attrKey = '@_' + name;
    return this.data[attrKey] ?? null;
  }

  get textContent() {
    if (typeof this.data === 'string') return this.data;
    if (typeof this.data === 'number') return String(this.data);
    if (typeof this.data === 'object' && '#text' in this.data) {
      const val = this.data['#text'];
      return typeof val === 'string' ? val : null;
    }
    return null;
  }

  get children() {
    if (typeof this.data !== 'object') return [];
    const result = [];
    for (const key in this.data) {
      if (key.startsWith('@') || key === '#text') continue;
      const value = this.data[key];
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        result.push(new MockElement(item, key));
      }
    }
    return result;
  }

  querySelector(selector) {
    const parts = selector.split('>').map((s) => s.trim());
    const result = this._search(this.data, parts);
    return result ? new MockElement(result.data, result.tag) : null;
  }

  querySelectorAll(selector) {
    const parts = selector.split('>').map((s) => s.trim());
    const results = [];
    this._searchAll(this.data, parts, results);
    return results;
  }

  _search(node, parts) {
    if (!node || typeof node !== 'object') return null;
    if (parts.length === 0) return null;

    // Try direct match first
    const firstTag = parts[0];
    if (node[firstTag]) {
      const value = node[firstTag];
      const item = Array.isArray(value) ? value[0] : value;
      if (parts.length === 1) {
        return { data: item, tag: firstTag };
      }
      // Continue searching in the item
      const found = this._search(item, parts.slice(1));
      if (found) return found;
    }

    // Recursively search children
    for (const key in node) {
      if (key.startsWith('@') || key === '#text') continue;
      const value = node[key];
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        const found = this._search(item, parts);
        if (found) return found;
      }
    }
    return null;
  }

  _searchAll(node, parts, results) {
    if (!node || typeof node !== 'object') return;
    if (parts.length === 0) return;

    const firstTag = parts[0];
    if (node[firstTag]) {
      const value = node[firstTag];
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        if (parts.length === 1) {
          results.push(new MockElement(item, firstTag));
        } else {
          this._searchAll(item, parts.slice(1), results);
        }
      }
    }

    // Recursively search children
    for (const key in node) {
      if (key.startsWith('@') || key === '#text') continue;
      const value = node[key];
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        this._searchAll(item, parts, results);
      }
    }
  }

  [Symbol.iterator]() {
    return this.children[Symbol.iterator]();
  }
}

class MockDocument extends MockElement {
  constructor(data) {
    super(data, '');
  }
}

global.DOMParser = class {
  parseFromString(source, mimeType) {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => name === 'item',
      trimValues: true,
    });
    const data = parser.parse(source);
    return new MockDocument(data);
  }
};

// Clear localStorage before each test to isolate test state and cache.
beforeEach(() => {
  if (global.localStorage) {
    global.localStorage.clear();
    // Also clear any feed-related state to ensure a fresh start for each test
    global.localStorage.removeItem('sleepcast_state');
  }
});

