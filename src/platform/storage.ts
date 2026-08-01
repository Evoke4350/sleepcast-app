// A localStorage polyfill over MMKV.
//
// The shared player code (vendor/player) calls localStorage.getItem and
// setItem *synchronously*, inline, in roughly forty places. That is not an
// accident of style — it is how store.ts, rest/ledger.ts and rest/surface.ts
// are written, and the website depends on the same code.
//
// MMKV is synchronous, so it can sit underneath that API unchanged. This is
// the entire reason MMKV was chosen over AsyncStorage: an async store would
// have meant refactoring every one of those call sites in a repository shared
// with the web app, to no benefit here.
//
// Installed by importing this module for its side effect, before anything
// that touches the shared code.
import { createMMKV } from "react-native-mmkv";

const mmkv = createMMKV({ id: "sleepcast" });

// The DOM Storage interface, declared here rather than pulled in via the "dom"
// lib. Adding that lib would make every browser global typecheck clean in a
// React Native app, which is exactly the mistake it would then hide.
interface LocalStorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

class MMKVLocalStorage implements LocalStorageLike {
  get length(): number {
    return mmkv.getAllKeys().length;
  }

  key(index: number): string | null {
    return mmkv.getAllKeys()[index] ?? null;
  }

  getItem(key: string): string | null {
    // The DOM contract is null for absent, and the shared code leans on it:
    // `const raw = localStorage.getItem(KEY); if (!raw) return default`.
    return mmkv.getString(key) ?? null;
  }

  setItem(key: string, value: string): void {
    mmkv.set(key, String(value));
  }

  removeItem(key: string): void {
    mmkv.remove(key);
  }

  clear(): void {
    mmkv.clearAll();
  }
}

export function installLocalStorage(): void {
  const g = globalThis as { localStorage?: LocalStorageLike };
  if (g.localStorage) return;
  g.localStorage = new MMKVLocalStorage();
}
