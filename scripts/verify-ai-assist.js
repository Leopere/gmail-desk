#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const main = read("src/main.js");
const overlay = read("src/gmail-ai-overlay.js");
const preload = read("src/preload.js");
const extensionShim = read("src/extension-shim-preload.js");

assert(main.includes("If mode is assess, drafts must be an empty array."), "AI prompt must keep assessment separate from drafting.");
assert(main.includes("Never send email"), "AI prompt must explicitly forbid sending email.");
assert(main.includes("ipcMain.handle(\"ai:analyzeEmail\""), "Main process must expose the AI analysis IPC handler.");
assert(main.includes("ipcMain.handle(\"ai:debugStatus\"") && main.includes("ipcMain.handle(\"ai:setDebugEnabled\""), "Main process must expose constrained AI debug IPC handlers.");
assert(main.includes("ipcMain.handle(\"extensions:status\""), "Main process must expose extension status for Grammarly visibility.");
assert(main.includes("ipcMain.handle(\"extensions:openGrammarly\"") && main.includes("Open Grammarly in Gmail Desk"), "Main process must expose a visible in-app Grammarly opener.");
assert(main.includes("ipcMain.handle(\"extensions:refreshWritingTools\"") && main.includes("reloadConfiguredExtensions") && main.includes("reloadIgnoringCache"), "Main process must refresh writing tools after Grammarly auth.");
assert(main.includes("analyzeEmailWithCodexCli"), "AI assist must support the local Codex CLI fallback.");
assert(main.includes("function isGrammarlyUrl") && main.includes("createInternalBrowserWindow"), "Grammarly auth URLs must stay inside Electron windows.");
assert(main.includes("https://app.grammarly.com/"), "Grammarly opener must target the in-app Grammarly editor.");
assert(main.includes("handleWindowOpenForMainWindow") && main.includes("isExtensionInitiatedWindowOpen"), "Main window must distinguish extension-triggered popups from user-clicked external links.");
assert(main.includes("Blocked extension-triggered external window") && main.includes("Blocked main-window external popup") && main.includes("Blocked internal-window external popup"), "Extension/internal/main popups must not be opened in the user's default browser.");
assert(main.includes("configureContentBlocker(targetSession)") && main.includes("uBlockAssetListPaths") && main.includes("onBeforeRequest"), "Main process must install a lightweight content blocker from uBlock-compatible lists.");
assert(main.includes("UBLOCK_ORIGIN_ID") && !main.includes("configKey: \"ublockOrigin\""), "uBlock Origin must be treated as a filter-list source, not a loaded extension.");
assert(main.includes("BUILT_IN_ALLOWED_EXACT_HOSTS") && main.includes("isAllowedContentBlockerHost"), "Content blocker must allowlist Gmail/auth/writing-tool hosts.");
assert(main.includes("accounts.google.com") && main.includes("mail.google.com") && main.includes("grammarly.com"), "Content blocker allowlist must protect Google auth, Gmail, and Grammarly hosts.");
assert(main.includes("summarizeAiPayload") && main.includes("bodyChars") && !main.includes("console.debug(`[Gmail Desk AI Debug] ${eventName}`, input)"), "AI debug logging must be sanitized.");
assert(main.includes("setPreloads([path.join(__dirname, \"extension-shim-preload.js\")])"), "Default session must install the extension API shim preload.");
assert(/registerIpc\(\);\s+await loadConfiguredExtensions\(\);/.test(main), "Extension shim IPC must be registered before extensions load during startup.");
assert(main.includes("extension-shim:cookies.get") && main.includes("session.defaultSession.cookies.get"), "Main process must bridge chrome.cookies reads to Electron cookies.");
assert(main.includes("extension-shim:tabs.query") && main.includes("activeTabPayload"), "Main process must bridge minimal active tab queries.");
assert(main.includes("prepareGrammarlyExtensionForElectron") && main.includes("gmail-desk-service-worker-shim.js"), "Main process must support a local patched Grammarly service worker copy.");
assert(main.includes("targetBackgroundPath") && main.includes("patchGrammarlyBackgroundSource(sourceBackground, shimSource)"), "Patched Grammarly mode must patch Grammarly-bg.js itself.");
assert(main.includes("patchGrammarlyBackgroundSource") && main.includes("self\\.chrome\\.") && main.includes("gmailDeskChrome"), "Patched Grammarly mode must rewrite direct chrome API reads to the shim object.");
assert(main.includes("function method(existingObject, name, fallback)") && main.includes("candidate.bind(existingObject)"), "Patched Grammarly shim must bind native extension API methods.");
assert(main.includes("create: method(tabs, \"create\", noop(null))"), "Patched Grammarly shim must provide tabs.create.");
assert(main.includes("this._chromeInstance.storage.session") && main.includes("gmailDeskChrome.storage.session"), "Patched Grammarly mode must rewrite captured storage session reads to the shim object.");
assert(main.includes("this._chrome.windows") && main.includes("gmailDeskChrome.windows"), "Patched Grammarly mode must rewrite captured window reads to the shim object.");
assert(main.includes("clearServiceWorkerScriptCacheForPatchedExtension") && main.includes("Service Worker\", \"ScriptCache"), "Patched Grammarly mode must clear cached service-worker scripts before loading.");
assert(main.includes("patchGrammarlyManifestForElectron") && main.includes("http://127.0.0.1:*"), "Patched Grammarly mode must allow the local loopback bridge in the generated manifest CSP.");
assert(main.includes("patchGrammarlyContentScriptsForElectron") && main.includes("trustedTypes.createPolicy(\"default\""), "Patched Grammarly mode must install a content-script Trusted Types compatibility policy.");
assert(main.includes("GMAIL_DESK_PATCH_GRAMMARLY") && main.includes("envFlagEnabled(PATCH_GRAMMARLY_ENV)"), "Patched Grammarly loading must be opt-in so normal login is not blocked.");
assert(main.includes("extensionConfig.patch === true") && main.includes("entry.patch === true"), "Patched Grammarly loading must support explicit local extension config.");
assert(main.includes("var chrome = Object.create(self.chrome || globalThis.chrome || null);") && main.includes("const chromeObject = chrome;"), "Grammarly service-worker shim must provide a writable chrome wrapper.");
assert(main.includes("ensureExtensionShimServer") && main.includes("127.0.0.1") && main.includes("x-gmail-desk-extension-shim"), "Service-worker shim bridge must be loopback-only and token-gated.");

assert(preload.includes("contextBridge.exposeInMainWorld(\"gmailDeskAI\""), "Preload must expose the constrained AI bridge.");
assert(preload.includes("analyzeEmail(payload)") && preload.includes("getExtensionStatus()"), "Preload bridge must expose analysis and extension status.");
assert(preload.includes("openGrammarly()"), "Preload bridge must expose the in-app Grammarly opener.");
assert(preload.includes("refreshWritingTools()"), "Preload bridge must expose writing-tools refresh.");
assert(preload.includes("getDebugStatus()") && preload.includes("setDebugEnabled(enabled)"), "Preload bridge must expose constrained AI debug controls.");
assert(preload.includes("installGmailTrustedTypesPolicy") && preload.includes("trustedTypes.createPolicy(\"default\""), "Preload must install a Gmail-scoped Trusted Types compatibility policy.");

assert(overlay.includes("AI Reply"), "Overlay must provide the AI Reply entry point.");
assert(overlay.includes("Assess sender intent"), "Overlay must assess email intent before drafting.");
assert(overlay.includes("Create draft text"), "Overlay must include a second-stage draft action.");
assert(overlay.includes("senderIntentTokens"), "Overlay must render sender intent tokens.");
assert(overlay.includes("responseIntentOptions"), "Overlay must render response intent options.");
assert(overlay.includes("Prepare sender-only reply") && overlay.includes("Prepare reply-all draft"), "Overlay must support explicit reply/reply-all draft preparation.");
assert(overlay.includes("Reply target") && overlay.includes("Everyone on thread") && overlay.includes("Sender only"), "Overlay must make reply-vs-reply-all targeting clear.");
assert(overlay.includes("Nothing has been sent") || overlay.includes("Review before sending"), "Overlay must keep send responsibility with the user.");
assert(overlay.includes("richMessageText") && overlay.includes("img[alt]") && overlay.includes("iframe[title]"), "Overlay must extract richer message text from HTML email bodies and embedded labels.");
assert(overlay.includes("updateReplyAssistAvailability") && overlay.includes("MutationObserver") && overlay.includes("button.hidden = true"), "Overlay must hide Reply Assist when no readable email is open.");
assert(overlay.includes("Grammarly:") && overlay.includes("available"), "Overlay panel may report Grammarly status without internal implementation details.");
assert(overlay.includes("grammarlyButton.hidden = true") && overlay.includes("findVisibleDraft"), "Floating Grammarly button must only appear when a Gmail compose editor is available.");
assert(!overlay.includes("gmdesk-writing-status") && !overlay.includes("writingStatus"), "Overlay must not show a redundant floating Grammarly availability pill.");
assert(!/experimental patch|loaded with experimental/i.test(overlay), "Overlay must not expose Grammarly patch implementation details.");
assert(!/uBlock|ublock/.test(overlay), "Overlay writing-tools status must not mention uBlock.");
assert(overlay.includes("Open Grammarly") && overlay.includes("openGrammarly"), "Overlay must provide a visible Grammarly action.");
assert(overlay.includes("gmdesk-grammarly-button") && overlay.includes("Open Grammarly editor inside Gmail Desk"), "Overlay must provide an always-visible Grammarly button in Gmail.");
assert(overlay.includes("Copy draft to Grammarly") && overlay.includes("Paste checked text"), "Overlay must provide a usable Grammarly sidecar copy/paste workflow.");
assert(overlay.includes("Refresh in Gmail") && overlay.includes("refreshWritingTools"), "Overlay must provide a Grammarly/writing-tools refresh action.");
assert(overlay.includes("gmdesk-ai-debug") && overlay.includes("Debug trace"), "Overlay must expose a dev-only AI debug control.");
assert(overlay.includes("bodyChars") && !overlay.includes("console.debug(`[Gmail Desk AI Debug] ${eventName}`, state.currentEmail"), "Overlay debug logging must avoid raw email content.");
assert(overlay.includes("function togglePanel()") && overlay.includes("button.addEventListener(\"click\", togglePanel)"), "Overlay AI button must toggle the panel open and closed.");
assert(overlay.includes("event.key === \"Escape\"") && overlay.includes("closePanel()"), "Overlay must support Escape to close the panel.");
assert(overlay.includes("aria-expanded"), "Overlay toggle button must expose expanded state.");
assert(!/\.innerHTML\s*=|insertAdjacentHTML|\.outerHTML\s*=/.test(overlay), "Overlay must avoid Trusted Types-blocked HTML string injection.");

assert(extensionShim.includes("chrome.cookies") && extensionShim.includes("onChanged"), "Extension shim must provide chrome.cookies and cookie events.");
assert(extensionShim.includes("chrome.windows") && extensionShim.includes("onFocusChanged"), "Extension shim must provide chrome.windows focus events.");
assert(extensionShim.includes("chrome.storage") && extensionShim.includes("storage.session"), "Extension shim must provide chrome.storage session compatibility.");
assert(extensionShim.includes("chrome.tabs") && extensionShim.includes("tabs.query"), "Extension shim must provide minimal chrome.tabs compatibility.");
assert(extensionShim.includes("chrome.identity") && extensionShim.includes("chrome.sidePanel"), "Extension shim must provide minimal identity and sidePanel compatibility.");
assert(extensionShim.includes("SUPPORTED_EXTENSION_IDS"), "Extension shim must be scoped to supported local extensions.");

const forbiddenSendPatterns = [
  /data-tooltip=["']Send/i,
  /aria-label=["']Send/i,
  /\.T-I\.J-J5-Ji\.aoO/,
  /send-button/i
];
for (const pattern of forbiddenSendPatterns) {
  assert(!pattern.test(overlay), `Overlay must not target Gmail send controls (${pattern}).`);
}

console.log("AI assist verifier passed.");
