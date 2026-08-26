import { vi, beforeEach } from 'vitest';

export function createChromeStub() {
  const store = new Map();
  const messageListeners = new Set();
  const connectListeners = new Set();

  return {
    __store: store,
    storage: {
      local: {
        get: vi.fn(async (keys) => {
          const wanted =
            keys == null ? [...store.keys()]
            : Array.isArray(keys) ? keys
            : typeof keys === 'string' ? [keys]
            : Object.keys(keys);
          const out = {};
          for (const k of wanted) {
            if (store.has(k)) out[k] = store.get(k);
            else if (keys && !Array.isArray(keys) && typeof keys === 'object') out[k] = keys[k];
          }
          return out;
        }),
        set: vi.fn(async (items) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        }),
        remove: vi.fn(async (keys) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
        }),
        clear: vi.fn(async () => store.clear()),
      },
    },
    runtime: {
      id: 'testextensionidtestextensionid',
      lastError: undefined,
      getURL: vi.fn((p) => `chrome-extension://testextensionidtestextensionid/${p}`),
      sendMessage: vi.fn(async (msg) => {
        for (const l of messageListeners) l(msg, { id: 'testextensionidtestextensionid' }, () => {});
      }),
      onMessage: {
        addListener: vi.fn((fn) => messageListeners.add(fn)),
        removeListener: vi.fn((fn) => messageListeners.delete(fn)),
      },
      onConnect: {
        addListener: vi.fn((fn) => connectListeners.add(fn)),
        removeListener: vi.fn((fn) => connectListeners.delete(fn)),
      },
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      connect: vi.fn(),
      openOptionsPage: vi.fn(),
    },
    permissions: {
      contains: vi.fn(async () => true),
      request: vi.fn(async () => true),
    },
    contextMenus: {
      create: vi.fn(),
      removeAll: vi.fn((cb) => cb?.()),
      onClicked: { addListener: vi.fn() },
    },
    tabs: { query: vi.fn(async () => []), create: vi.fn(async () => ({ id: 1 })), update: vi.fn(), sendMessage: vi.fn() },
    scripting: { executeScript: vi.fn(async () => [{ result: '' }]) },
    action: { onClicked: { addListener: vi.fn() } },
    commands: { onCommand: { addListener: vi.fn() } },
    extension: { isAllowedFileSchemeAccess: vi.fn(async () => false) },
  };
}

beforeEach(() => {
  vi.stubGlobal('chrome', createChromeStub());
});
