const { contextBridge, ipcRenderer } = require("electron");

const SUPPORTED_EXTENSION_IDS = new Set([
  "kbfnbcaeplbcioakkpcpgfkobkghlhen"
]);

function shouldShimCurrentPage() {
  return location.protocol === "chrome-extension:" && SUPPORTED_EXTENSION_IDS.has(location.hostname);
}

if (shouldShimCurrentPage()) {
  const extensionId = location.hostname;

  contextBridge.exposeInMainWorld("gmailDeskExtensionShim", {
    invoke(name, ...args) {
      return ipcRenderer.invoke(`extension-shim:${name}`, extensionId, ...args);
    }
  });

  contextBridge.executeInMainWorld({
    func: () => {
      const shim = globalThis.gmailDeskExtensionShim;
      const chrome = globalThis.chrome || {};
      const extensionId = location.hostname;

      function defineApi(name, value) {
        try {
          Object.defineProperty(chrome, name, {
            configurable: true,
            enumerable: true,
            value,
            writable: true
          });
        } catch (_error) {
          chrome[name] = value;
        }
      }

      class ExtensionEvent {
        constructor(name) {
          this.name = name;
          this.listeners = [];
        }

        addListener(callback) {
          if (typeof callback === "function" && !this.listeners.includes(callback)) {
            this.listeners.push(callback);
          }
        }

        removeListener(callback) {
          const index = this.listeners.indexOf(callback);
          if (index >= 0) {
            this.listeners.splice(index, 1);
          }
        }

        hasListener(callback) {
          return this.listeners.includes(callback);
        }

        hasListeners() {
          return this.listeners.length > 0;
        }
      }

      function invoke(name, defaultValue) {
        return (...args) => {
          const callback = typeof args[args.length - 1] === "function" ? args.pop() : null;
          const promise = shim.invoke(name, ...args)
            .catch((error) => {
              console.warn(`[Gmail Desk Extension Shim] ${name} failed`, error);
              return defaultValue;
            });

          if (callback) {
            promise.then((result) => callback(result));
            return undefined;
          }

          return promise;
        };
      }

      function noop(defaultValue) {
        return (...args) => {
          const callback = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;
          if (callback) {
            queueMicrotask(() => callback(defaultValue));
            return undefined;
          }
          return Promise.resolve(defaultValue);
        };
      }

      const cookies = chrome.cookies || {};
      defineApi("cookies", {
        ...cookies,
        get: cookies.get || invoke("cookies.get", null),
        getAll: cookies.getAll || invoke("cookies.getAll", []),
        getAllCookieStores: cookies.getAllCookieStores || invoke("cookies.getAllCookieStores", []),
        onChanged: cookies.onChanged || new ExtensionEvent("cookies.onChanged"),
        remove: cookies.remove || invoke("cookies.remove", null),
        set: cookies.set || invoke("cookies.set", null)
      });

      function storageArea(existingArea, areaName) {
        const memory = {};
        function selected(keys) {
          if (keys == null) {
            return { ...memory };
          }
          if (typeof keys === "string") {
            return { [keys]: memory[keys] };
          }
          if (Array.isArray(keys)) {
            return keys.reduce((result, key) => {
              result[key] = memory[key];
              return result;
            }, {});
          }
          if (typeof keys === "object") {
            return Object.keys(keys).reduce((result, key) => {
              result[key] = memory[key] === undefined ? keys[key] : memory[key];
              return result;
            }, {});
          }
          return {};
        }

        return {
          ...existingArea,
          clear: existingArea.clear || ((callback) => {
            for (const key of Object.keys(memory)) {
              delete memory[key];
            }
            if (callback) queueMicrotask(callback);
          }),
          get: existingArea.get || ((keys, callback) => {
            const result = selected(keys);
            if (callback) {
              queueMicrotask(() => callback(result));
              return undefined;
            }
            return Promise.resolve(result);
          }),
          getBytesInUse: existingArea.getBytesInUse || ((_keys, callback) => {
            const size = JSON.stringify(memory).length;
            if (callback) {
              queueMicrotask(() => callback(size));
              return undefined;
            }
            return Promise.resolve(size);
          }),
          onChanged: existingArea.onChanged || new ExtensionEvent(`storage.${areaName}.onChanged`),
          remove: existingArea.remove || ((keys, callback) => {
            const list = Array.isArray(keys) ? keys : [keys];
            for (const key of list) {
              delete memory[key];
            }
            if (callback) queueMicrotask(callback);
          }),
          set: existingArea.set || ((items, callback) => {
            Object.assign(memory, items || {});
            if (callback) queueMicrotask(callback);
          }),
          setAccessLevel: existingArea.setAccessLevel || noop(undefined)
        };
      }

      const storage = chrome.storage || {};
      defineApi("storage", {
        ...storage,
        local: storageArea(storage.local || {}, "local"),
        onChanged: storage.onChanged || new ExtensionEvent("storage.onChanged"),
        session: storageArea(storage.session || {}, "session"),
        sync: storageArea(storage.sync || {}, "sync")
      });

      const tabs = chrome.tabs || {};
      defineApi("tabs", {
        ...tabs,
        onActivated: tabs.onActivated || new ExtensionEvent("tabs.onActivated"),
        onRemoved: tabs.onRemoved || new ExtensionEvent("tabs.onRemoved"),
        onUpdated: tabs.onUpdated || new ExtensionEvent("tabs.onUpdated"),
        query: tabs.query || invoke("tabs.query", [])
      });

      const windows = chrome.windows || {};
      defineApi("windows", {
        ...windows,
        WINDOW_ID_CURRENT: windows.WINDOW_ID_CURRENT || -2,
        WINDOW_ID_NONE: windows.WINDOW_ID_NONE || -1,
        create: windows.create || noop(null),
        get: windows.get || invoke("windows.get", null),
        getAll: windows.getAll || invoke("windows.getAll", []),
        getCurrent: windows.getCurrent || invoke("windows.getCurrent", null),
        getLastFocused: windows.getLastFocused || invoke("windows.getLastFocused", null),
        onBoundsChanged: windows.onBoundsChanged || new ExtensionEvent("windows.onBoundsChanged"),
        onCreated: windows.onCreated || new ExtensionEvent("windows.onCreated"),
        onFocusChanged: windows.onFocusChanged || new ExtensionEvent("windows.onFocusChanged"),
        onRemoved: windows.onRemoved || new ExtensionEvent("windows.onRemoved"),
        remove: windows.remove || noop(null),
        update: windows.update || invoke("windows.update", null)
      });

      const identity = chrome.identity || {};
      defineApi("identity", {
        ...identity,
        getRedirectURL: identity.getRedirectURL || ((path = "") => `https://${extensionId}.chromiumapp.org/${String(path || "").replace(/^\//, "")}`),
        launchWebAuthFlow: identity.launchWebAuthFlow || noop(undefined)
      });

      const notifications = chrome.notifications || {};
      defineApi("notifications", {
        ...notifications,
        clear: notifications.clear || noop(false),
        create: notifications.create || noop(""),
        getAll: notifications.getAll || noop({}),
        onButtonClicked: notifications.onButtonClicked || new ExtensionEvent("notifications.onButtonClicked"),
        onClicked: notifications.onClicked || new ExtensionEvent("notifications.onClicked"),
        onClosed: notifications.onClosed || new ExtensionEvent("notifications.onClosed"),
        update: notifications.update || noop(false)
      });

      const sidePanel = chrome.sidePanel || {};
      defineApi("sidePanel", {
        ...sidePanel,
        open: sidePanel.open || noop(undefined),
        setOptions: sidePanel.setOptions || noop(undefined)
      });

      globalThis.chrome = chrome;
    }
  });
}
