// Ambient declarations for the browser APIs the shared player code uses.
//
// vendor/player is written for the browser: store.ts and rest/* call
// localStorage directly, and engine.ts parses feeds with DOMParser. At runtime
// localStorage is polyfilled over MMKV (src/platform/storage.ts) and
// parseFeedXml is never called — src/platform/feed.ts replaces it. But
// TypeScript still has to know these names exist.
//
// Declared as a deliberately small subset instead of adding "dom" to lib.
// Pulling in the whole DOM would make `document`, `window` and `fetch`-shaped
// browser globals typecheck cleanly throughout a React Native app, which is
// precisely the class of mistake worth keeping loud.

declare var localStorage: {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
};

interface SharedDomElement {
  readonly localName: string;
  readonly children: ArrayLike<SharedDomElement> & Iterable<SharedDomElement>;
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selectors: string): SharedDomElement | null;
  querySelectorAll(selectors: string): Iterable<SharedDomElement>;
}

interface Document extends SharedDomElement {}

declare class DOMParser {
  parseFromString(source: string, mimeType: string): Document;
}
