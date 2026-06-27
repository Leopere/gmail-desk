const { contextBridge, ipcRenderer } = require("electron");

function installGmailTrustedTypesPolicy() {
  if (!/\.?mail\.google\.com$/i.test(location.hostname)) {
    return;
  }

  contextBridge.executeInMainWorld({
    func: () => {
      if (globalThis.__gmailDeskTrustedTypesPolicyInstalled) {
        return;
      }
      globalThis.__gmailDeskTrustedTypesPolicyInstalled = true;

      const trustedTypes = globalThis.trustedTypes;
      if (!trustedTypes || typeof trustedTypes.createPolicy !== "function") {
        return;
      }

      try {
        trustedTypes.createPolicy("default", {
          createHTML: (value) => String(value),
          createScript: (value) => String(value),
          createScriptURL: (value) => String(value)
        });
      } catch (_error) {
        // Gmail or another injected script may already have installed it.
      }
    }
  });
}

installGmailTrustedTypesPolicy();

contextBridge.exposeInMainWorld("gmailDeskAI", {
  analyzeEmail(payload) {
    return ipcRenderer.invoke("ai:analyzeEmail", payload);
  },
  getDebugStatus() {
    return ipcRenderer.invoke("ai:debugStatus");
  },
  getExtensionStatus() {
    return ipcRenderer.invoke("extensions:status");
  },
  openGrammarly() {
    return ipcRenderer.invoke("extensions:openGrammarly");
  },
  refreshWritingTools() {
    return ipcRenderer.invoke("extensions:refreshWritingTools");
  },
  setDebugEnabled(enabled) {
    return ipcRenderer.invoke("ai:setDebugEnabled", Boolean(enabled));
  }
});
