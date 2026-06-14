const fs = require("node:fs");
const path = require("node:path");

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  session,
  shell
} = require("electron");

const {
  GMAIL_ACCOUNT_COUNT,
  findLaunchUrl,
  gmailAccountIndexFromUrl,
  gmailUrl,
  isAppUrl,
  isHttpUrl,
  normalizeAccountIndex,
  withGmailAccount
} = require("./url-rules");

const APP_NAME = "Gmail Desk";
const WINDOW_WIDTH = 1440;
const WINDOW_HEIGHT = 940;
const WINDOW_X = 80;
const WINDOW_Y = 60;
const POST_GOOGLE_ACCOUNT_REFRESH_MS = 900;

app.setName(APP_NAME);
app.setPath("userData", path.join(app.getPath("appData"), APP_NAME));

loadDotEnv(path.join(__dirname, "..", ".env"));

let mainWindow;
let tray;
let pendingOpenUrl = findLaunchUrl(process.argv);
let activeAccountIndex = 0;
let googleAccounts = [];
let googleAccountsLastRefresh = 0;
let googleAccountsRefreshPromise;
let pendingGoogleAccountRefresh = false;
let googleAccountRefreshTimer;
let isQuitting = false;

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }

    const value = match[2].trim().replace(/^['"]|['"]$/g, "");
    process.env[match[1]] = value;
  }
}

function preferencesPath() {
  return path.join(app.getPath("userData"), "preferences.json");
}

function readPreferences() {
  try {
    return JSON.parse(fs.readFileSync(preferencesPath(), "utf8"));
  } catch (_error) {
    return {};
  }
}

function writePreferences(preferences) {
  fs.mkdirSync(path.dirname(preferencesPath()), { recursive: true });
  fs.writeFileSync(preferencesPath(), JSON.stringify(preferences, null, 2), "utf8");
}

function loadPreferredAccountIndex() {
  return normalizeAccountIndex(readPreferences().activeAccountIndex);
}

function savePreferredAccountIndex(accountIndex) {
  const preferences = readPreferences();
  preferences.activeAccountIndex = normalizeAccountIndex(accountIndex);
  writePreferences(preferences);
}

function cleanLabel(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function accountShortLabel(account) {
  const source = cleanLabel(account.name || account.email || account.label);
  if (!source) {
    return String(account.index + 1);
  }

  const words = source
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");

  return initials || String(account.index + 1);
}

function formatAccountLabel(account) {
  const name = cleanLabel(account.name);
  const email = cleanLabel(account.email);

  if (name && email && name.toLowerCase() !== email.toLowerCase()) {
    return `${name} - ${email}`;
  }

  return name || email || `Google Account ${account.index + 1}`;
}

function fallbackAccount(index) {
  return {
    email: "",
    index,
    known: false,
    label: `Google Account ${index + 1}`,
    name: "",
    photoUrl: "",
    shortLabel: String(index + 1)
  };
}

function normalizeGoogleAccount(account, index) {
  const normalized = {
    email: cleanLabel(account.email),
    gaiaId: cleanLabel(account.gaiaId),
    index,
    known: Boolean(account.known),
    label: "",
    name: cleanLabel(account.name),
    photoUrl: cleanLabel(account.photoUrl)
  };
  normalized.label = formatAccountLabel(normalized);
  normalized.shortLabel = accountShortLabel(normalized);
  return normalized;
}

function availableGmailAccounts() {
  if (googleAccounts.length > 0) {
    const accounts = googleAccounts
      .map((account, index) => account ? normalizeGoogleAccount(account, index) : null)
      .filter(Boolean);
    if (!accounts.some((account) => account.index === activeAccountIndex)) {
      accounts.push(fallbackAccount(activeAccountIndex));
      accounts.sort((a, b) => a.index - b.index);
    }
    return accounts;
  }

  return Array.from({ length: GMAIL_ACCOUNT_COUNT }, (_value, index) => fallbackAccount(index));
}

function activeGoogleAccountLabel() {
  const account = availableGmailAccounts().find((candidate) => candidate.index === activeAccountIndex);
  return account ? account.label : `Google Account ${activeAccountIndex + 1}`;
}

function parseGoogleAccountEntry(entry, index) {
  if (!Array.isArray(entry) || entry[0] !== "gaia.l.a") {
    return null;
  }

  return normalizeGoogleAccount({
    email: entry[3],
    gaiaId: entry[10],
    known: true,
    name: entry[2],
    photoUrl: entry[4]
  }, index);
}

function parseGoogleAccountsPayload(payload) {
  let parsed;
  try {
    parsed = JSON.parse(String(payload || "").replace(/^\)\]\}'\s*/, ""));
  } catch (_error) {
    return [];
  }

  const accountEntries = Array.isArray(parsed) && Array.isArray(parsed[1]) ? parsed[1] : [];
  return accountEntries
    .slice(0, GMAIL_ACCOUNT_COUNT)
    .map((entry, index) => parseGoogleAccountEntry(entry, index))
    .filter(Boolean);
}

function mergeCurrentAccount(account) {
  if (!account || (!account.name && !account.email)) {
    return false;
  }

  const index = normalizeAccountIndex(account.index);
  const nextAccounts = [...googleAccounts];
  nextAccounts[index] = normalizeGoogleAccount({
    ...nextAccounts[index],
    ...account,
    known: true
  }, index);
  googleAccounts = nextAccounts;
  googleAccountsLastRefresh = Date.now();
  return true;
}

function chromeCompatibleUserAgent() {
  return session.defaultSession.getUserAgent().replace(/\sElectron\/\S+/g, "");
}

function hostFromUrl(urlValue) {
  try {
    return new URL(urlValue).hostname.toLowerCase();
  } catch (_error) {
    return "";
  }
}

function isGoogleAccountsUrl(urlValue) {
  return hostFromUrl(urlValue) === "accounts.google.com";
}

function isGmailWebUrl(urlValue) {
  return hostFromUrl(urlValue) === "mail.google.com";
}

function rememberGmailAccountFromUrl(url) {
  const accountIndex = gmailAccountIndexFromUrl(url);
  if (accountIndex === null || accountIndex === activeAccountIndex) {
    return;
  }

  activeAccountIndex = accountIndex;
  savePreferredAccountIndex(activeAccountIndex);
  createMenu();
  updateTrayMenu();
  injectAccountSwitcher();
}

function loadAppUrl(targetWindow, url) {
  const targetUrl = url || gmailUrl(activeAccountIndex);
  rememberGmailAccountFromUrl(targetUrl);
  targetWindow.loadURL(targetUrl, {
    userAgent: chromeCompatibleUserAgent()
  });
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow(gmailUrl(activeAccountIndex));
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}

function closeMainWindowToTray() {
  hideMainWindow();
  updateTrayMenu();
}

function closeAppToTray() {
  closeMainWindowToTray();
}

function closeFocusedWindowToTray() {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow && focusedWindow !== mainWindow) {
    focusedWindow.close();
    return;
  }

  closeMainWindowToTray();
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

function openAppUrl(url) {
  if (!isAppUrl(url)) {
    return false;
  }

  rememberGmailAccountFromUrl(url);
  showMainWindow();
  loadAppUrl(mainWindow, url);
  return true;
}

function openGmailRoute(route = "inbox") {
  return openAppUrl(gmailUrl(activeAccountIndex, route));
}

function openCompose() {
  return openAppUrl(`https://mail.google.com/mail/u/${normalizeAccountIndex(activeAccountIndex)}/?view=cm&fs=1&tf=1`);
}

function switchGmailAccount(accountIndex, { preserveRoute = true } = {}) {
  const normalizedIndex = normalizeAccountIndex(accountIndex);
  activeAccountIndex = normalizedIndex;
  savePreferredAccountIndex(activeAccountIndex);
  createMenu();
  updateTrayMenu();

  const currentUrl = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow.webContents.getURL()
    : "";
  const targetUrl = preserveRoute && currentUrl
    ? withGmailAccount(currentUrl, normalizedIndex)
    : gmailUrl(normalizedIndex);

  openAppUrl(targetUrl);
}

function switchRelativeAccount(direction) {
  const accounts = availableGmailAccounts();
  const activePosition = Math.max(0, accounts.findIndex((account) => account.index === activeAccountIndex));
  const nextPosition = (activePosition + direction + accounts.length) % accounts.length;
  switchGmailAccount(accounts[nextPosition].index);
}

function noteGoogleAccountNavigation(url) {
  if (isGoogleAccountsUrl(url)) {
    pendingGoogleAccountRefresh = true;
  }
}

function addGoogleAccountUrl() {
  const continueUrl = mainWindow && !mainWindow.isDestroyed()
    ? withGmailAccount(mainWindow.webContents.getURL(), activeAccountIndex)
    : gmailUrl(activeAccountIndex);
  const url = new URL("https://accounts.google.com/AddSession");
  url.searchParams.set("continue", continueUrl);
  return url.toString();
}

function addOrRefreshGoogleAccounts() {
  pendingGoogleAccountRefresh = true;
  openAppUrl(addGoogleAccountUrl());
}

function refreshCurrentGoogleAccountState() {
  pendingGoogleAccountRefresh = true;
  const currentUrl = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow.webContents.getURL()
    : "";

  if (isGmailWebUrl(currentUrl)) {
    scheduleGoogleAccountRefresh(currentUrl, { force: true });
  } else {
    openGmailRoute();
  }
}

function scheduleGoogleAccountRefresh(url, { force = false } = {}) {
  if (!force && !pendingGoogleAccountRefresh) {
    return;
  }

  if (!isGmailWebUrl(url)) {
    return;
  }

  pendingGoogleAccountRefresh = false;
  if (googleAccountRefreshTimer) {
    clearTimeout(googleAccountRefreshTimer);
  }

  googleAccountRefreshTimer = setTimeout(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    const currentUrl = mainWindow.webContents.getURL();
    if (!isGmailWebUrl(currentUrl)) {
      return;
    }

    const targetUrl = withGmailAccount(currentUrl, activeAccountIndex);
    try {
      await mainWindow.webContents.session.cookies.flushStore();
      await mainWindow.webContents.session.clearCache();
      await refreshGoogleAccounts({ force: true });
    } catch (error) {
      console.error("Could not refresh Google account state:", error);
    }

    loadAppUrl(mainWindow, targetUrl);
  }, POST_GOOGLE_ACCOUNT_REFRESH_MS);
}

function setDockIcon() {
  if (process.platform !== "darwin" || !app.dock) {
    return;
  }

  const icon = nativeImage.createFromPath(path.join(__dirname, "..", "assets", "gmail-desk.icns"));
  if (!icon.isEmpty()) {
    app.dock.setIcon(icon);
  }
}

function configureSession() {
  const targetSession = session.defaultSession;
  const userAgent = chromeCompatibleUserAgent();

  targetSession.setUserAgent(userAgent);
  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents.getURL();
    const allowedPermissions = new Set([
      "clipboard-sanitized-write",
      "fullscreen",
      "notifications"
    ]);
    callback(isAppUrl(requestingUrl) && allowedPermissions.has(permission));
  });
}

async function refreshGoogleAccounts({ force = false } = {}) {
  if (googleAccountsRefreshPromise) {
    return googleAccountsRefreshPromise;
  }

  if (!force && Date.now() - googleAccountsLastRefresh < 30 * 1000) {
    return googleAccounts;
  }

  googleAccountsRefreshPromise = (async () => {
    try {
      const response = await session.defaultSession.fetch(
        "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard",
        {
          body: " ",
          credentials: "include",
          headers: {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            origin: "https://www.google.com"
          },
          method: "POST"
        }
      );

      if (!response.ok) {
        throw new Error(`Google account list returned HTTP ${response.status}.`);
      }

      const accounts = parseGoogleAccountsPayload(await response.text());
      googleAccounts = accounts;
      googleAccountsLastRefresh = Date.now();
      createMenu();
      updateTrayMenu();
      injectAccountSwitcher();
      return googleAccounts;
    } catch (error) {
      console.error("Could not refresh Google account labels:", error);
      googleAccountsLastRefresh = Date.now();
      return googleAccounts;
    } finally {
      googleAccountsRefreshPromise = null;
    }
  })();

  return googleAccountsRefreshPromise;
}

function createMainWindow(startUrl) {
  const userAgent = chromeCompatibleUserAgent();
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: WINDOW_X,
    y: WINDOW_Y,
    minWidth: 1024,
    minHeight: 700,
    title: APP_NAME,
    backgroundColor: "#f8fafc",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });

  mainWindow.webContents.setUserAgent(userAgent);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      noteGoogleAccountNavigation(url);
      loadAppUrl(mainWindow, url);
    } else if (isHttpUrl(url)) {
      shell.openExternal(url);
    }

    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    noteGoogleAccountNavigation(url);
    if (isAppUrl(url) || url.startsWith("about:")) {
      return;
    }

    event.preventDefault();
    if (isHttpUrl(url)) {
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.on("did-start-navigation", (_event, url, isInPlace, isMainFrame) => {
    if (!isInPlace && isMainFrame) {
      noteGoogleAccountNavigation(url);
    }
  });

  mainWindow.webContents.on("will-redirect", (_event, url) => {
    noteGoogleAccountNavigation(url);
  });

  mainWindow.webContents.on("did-navigate", (_event, url) => {
    rememberGmailAccountFromUrl(url);
    injectAccountSwitcher();
    scheduleGoogleAccountRefresh(url);
    refreshGoogleAccounts().catch((_error) => {});
  });

  mainWindow.webContents.on("did-navigate-in-page", (_event, url) => {
    rememberGmailAccountFromUrl(url);
    injectAccountSwitcher();
    scheduleGoogleAccountRefresh(url);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    const currentUrl = mainWindow.webContents.getURL();
    rememberGmailAccountFromUrl(currentUrl);
    injectAccountSwitcher();
    scheduleGoogleAccountRefresh(currentUrl);
    refreshGoogleAccounts().catch((_error) => {});
    captureCurrentGoogleAccountFromPage();
  });

  mainWindow.on("show", updateTrayMenu);
  mainWindow.on("hide", updateTrayMenu);

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    hideMainWindow();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  loadAppUrl(mainWindow, startUrl || gmailUrl(activeAccountIndex));
  return mainWindow;
}

function accountSwitcherScript(accountIndex, accounts) {
  return `
(() => {
  const activeIndex = ${JSON.stringify(accountIndex)};
  const accounts = ${JSON.stringify(accounts)};
  const switcherId = "gmdesk-account-switcher";

  if (location.hostname !== "mail.google.com") {
    return;
  }

  function targetUrl(index) {
    const url = new URL(location.href);
    if (/^\\/mail\\/u\\/\\d+(?:\\/|$)/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/^\\/mail\\/u\\/\\d+/, "/mail/u/" + index);
    } else {
      url.pathname = "/mail/u/" + index + "/";
    }
    if (!url.hash && !url.search) {
      url.hash = "#inbox";
    }
    return url.toString();
  }

  function switchTo(index) {
    if (index === activeIndex) {
      return;
    }
    location.href = targetUrl(index);
  }

  let switcher = document.getElementById(switcherId);
  if (!switcher) {
    switcher = document.createElement("div");
    switcher.id = switcherId;
    switcher.setAttribute("role", "toolbar");
    switcher.setAttribute("aria-label", "Gmail Desk account switcher");
    document.documentElement.appendChild(switcher);
  }

  switcher.innerHTML = "";
  Object.assign(switcher.style, {
    alignItems: "center",
    background: "rgba(255,255,255,0.96)",
    border: "1px solid rgba(95,99,104,0.28)",
    borderRadius: "8px",
    boxShadow: "0 2px 10px rgba(60,64,67,0.18)",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "6px",
    position: "fixed",
    right: "12px",
    top: "88px",
    zIndex: "2147483647"
  });

  const title = document.createElement("div");
  title.textContent = "Mail";
  Object.assign(title.style, {
    color: "#5f6368",
    font: "600 10px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    lineHeight: "12px"
  });
  switcher.appendChild(title);

  for (const account of accounts) {
    const index = account.index;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = account.shortLabel || String(index + 1);
    button.title = account.label || ("Switch to Google account " + (index + 1));
    button.setAttribute("aria-pressed", index === activeIndex ? "true" : "false");
    Object.assign(button.style, {
      alignItems: "center",
      background: index === activeIndex ? "#c5221f" : "#fff",
      border: "1px solid " + (index === activeIndex ? "#c5221f" : "#dadce0"),
      borderRadius: "6px",
      color: index === activeIndex ? "#fff" : "#202124",
      cursor: "pointer",
      display: "flex",
      font: "600 11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      height: "26px",
      justifyContent: "center",
      margin: "0",
      padding: "0",
      width: "30px"
    });
    button.addEventListener("click", () => switchTo(index));
    switcher.appendChild(button);
  }
})();
`;
}

function injectAccountSwitcher() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const currentUrl = mainWindow.webContents.getURL();
  if (!isGmailWebUrl(currentUrl)) {
    return;
  }

  mainWindow.webContents
    .executeJavaScript(accountSwitcherScript(activeAccountIndex, availableGmailAccounts()), true)
    .catch((_error) => {
      // The page may still be navigating. The next navigation event will retry.
    });
}

function currentAccountReaderScript(accountIndex) {
  return `
(() => {
  const accountIndex = ${JSON.stringify(accountIndex)};
  const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i;

  function normalize(value) {
    return String(value || "").replace(/\\s+/g, " ").trim();
  }

  function parseLabel(value) {
    const raw = normalize(value);
    const emailMatch = raw.match(emailPattern);
    if (!emailMatch) {
      return null;
    }

    const email = emailMatch[0];
    let name = raw
      .replace(/Google Account:?/i, "")
      .replace(email, "")
      .replace(/[()]/g, " ")
      .replace(/Manage your Google Account/i, "")
      .replace(/Change account/i, "")
      .replace(/Gmail/i, "");
    name = normalize(name);

    return {
      email,
      index: accountIndex,
      name
    };
  }

  const directEmail = document.querySelector("[data-email]");
  if (directEmail) {
    const parsed = parseLabel(directEmail.getAttribute("data-email"));
    if (parsed) {
      return parsed;
    }
  }

  const candidates = Array.from(document.querySelectorAll("[aria-label], [title]"))
    .flatMap((element) => [
      element.getAttribute("aria-label"),
      element.getAttribute("title")
    ])
    .filter(Boolean);

  for (const candidate of candidates) {
    const parsed = parseLabel(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
})();
`;
}

function captureCurrentGoogleAccountFromPage() {
  if (!mainWindow || mainWindow.isDestroyed() || !isGmailWebUrl(mainWindow.webContents.getURL())) {
    return;
  }

  mainWindow.webContents
    .executeJavaScript(currentAccountReaderScript(activeAccountIndex), true)
    .then((account) => {
      if (mergeCurrentAccount(account)) {
        createMenu();
        updateTrayMenu();
        injectAccountSwitcher();
      }
    })
    .catch((_error) => {
      // Gmail may still be rendering; account-list refresh remains the primary path.
    });
}

function focusGmailSearch() {
  showMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents
    .executeJavaScript(`
(() => {
  const selectors = [
    'input[aria-label="Search mail"]',
    'input[placeholder*="Search mail"]',
    'input[name="q"]'
  ];
  const input = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
  if (!input) {
    return false;
  }
  input.focus();
  input.select();
  return true;
})();
`, true)
    .catch((_error) => {});
}

function openExternalUrl(url) {
  if (isHttpUrl(url)) {
    shell.openExternal(url);
  }
}

function openCurrentInBrowser() {
  const currentUrl = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow.webContents.getURL()
    : gmailUrl(activeAccountIndex);
  openExternalUrl(currentUrl);
}

function createMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [{
          label: APP_NAME,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            {
              label: "Close to Menu Bar",
              accelerator: "Command+Q",
              click: closeAppToTray
            },
            {
              label: `Quit ${APP_NAME}`,
              accelerator: "Command+Shift+Q",
              click: quitApp
            }
          ]
        }]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Compose Mail",
          accelerator: "CommandOrControl+N",
          click: openCompose
        },
        {
          label: "Open Current Page in Browser",
          accelerator: "CommandOrControl+Shift+O",
          click: openCurrentInBrowser
        },
        { type: "separator" },
        isMac
          ? {
              label: "Close to Menu Bar",
              accelerator: "Command+W",
              click: closeFocusedWindowToTray
            }
          : {
              label: `Quit ${APP_NAME}`,
              click: quitApp
            }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { type: "separator" },
        { role: "selectAll" }
      ]
    },
    {
      label: "Mail",
      submenu: [
        {
          label: "Open Inbox",
          accelerator: "CommandOrControl+0",
          click() {
            openGmailRoute("inbox");
          }
        },
        {
          label: "Unread",
          accelerator: "CommandOrControl+1",
          click() {
            openGmailRoute("search/is%3Aunread");
          }
        },
        {
          label: "Starred",
          accelerator: "CommandOrControl+2",
          click() {
            openGmailRoute("starred");
          }
        },
        {
          label: "Snoozed",
          accelerator: "CommandOrControl+3",
          click() {
            openGmailRoute("snoozed");
          }
        },
        {
          label: "Sent",
          accelerator: "CommandOrControl+4",
          click() {
            openGmailRoute("sent");
          }
        },
        {
          label: "Drafts",
          accelerator: "CommandOrControl+5",
          click() {
            openGmailRoute("drafts");
          }
        },
        { type: "separator" },
        {
          label: "Search Mail",
          accelerator: "CommandOrControl+F",
          click: focusGmailSearch
        },
        {
          label: "Compose Mail",
          click: openCompose
        }
      ]
    },
    {
      label: "Accounts",
      submenu: [
        ...availableGmailAccounts().map((account) => ({
          label: account.label,
          type: "radio",
          checked: account.index === activeAccountIndex,
          accelerator: account.index < 9 ? `CommandOrControl+Alt+${account.index + 1}` : undefined,
          click() {
            switchGmailAccount(account.index);
          }
        })),
        { type: "separator" },
        {
          label: "Previous Account",
          accelerator: "CommandOrControl+Alt+Left",
          click() {
            switchRelativeAccount(-1);
          }
        },
        {
          label: "Next Account",
          accelerator: "CommandOrControl+Alt+Right",
          click() {
            switchRelativeAccount(1);
          }
        },
        { type: "separator" },
        {
          label: "Add Google Account",
          accelerator: "CommandOrControl+Alt+A",
          click: addOrRefreshGoogleAccounts
        },
        {
          label: "Refresh Account State",
          click: refreshCurrentGoogleAccountState
        }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [
              { type: "separator" },
              { role: "front" }
            ]
          : [])
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function trayIcon() {
  const iconPath = path.join(__dirname, "..", "assets", "generated", "tray-template.png");
  const icon = nativeImage.createFromPath(iconPath).resize({
    height: 18,
    width: 18
  });
  if (!icon.isEmpty()) {
    icon.setTemplateImage(true);
  }

  return icon;
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip(APP_NAME);
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  const template = [
    {
      label: mainWindow && mainWindow.isVisible() ? "Hide Gmail Desk" : "Show Gmail Desk",
      click() {
        if (mainWindow && mainWindow.isVisible()) {
          hideMainWindow();
        } else {
          showMainWindow();
        }
      }
    },
    { type: "separator" },
    {
      label: "Open Inbox",
      click() {
        openGmailRoute("inbox");
      }
    },
    {
      label: "Compose Mail",
      click: openCompose
    },
    {
      label: "Unread",
      click() {
        openGmailRoute("search/is%3Aunread");
      }
    },
    { type: "separator" },
    {
      label: activeGoogleAccountLabel(),
      submenu: [
        ...availableGmailAccounts().map((account) => ({
          label: account.label,
          type: "radio",
          checked: account.index === activeAccountIndex,
          click() {
            switchGmailAccount(account.index);
          }
        })),
        { type: "separator" },
        {
          label: "Add Google Account",
          click: addOrRefreshGoogleAccounts
        },
        {
          label: "Refresh Account State",
          click: refreshCurrentGoogleAccountState
        }
      ]
    },
    { type: "separator" },
    {
      label: "Open Current Page in Browser",
      click: openCurrentInBrowser
    },
    {
      label: `Quit ${APP_NAME}`,
      click: quitApp
    }
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const url = findLaunchUrl(argv);
    if (url && openAppUrl(url)) {
      return;
    }

    showMainWindow();
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();

    if (mainWindow) {
      openAppUrl(url);
    } else {
      pendingOpenUrl = isAppUrl(url) ? url : pendingOpenUrl;
    }
  });

  app.whenReady().then(() => {
    activeAccountIndex = loadPreferredAccountIndex();

    const launchAccountIndex = gmailAccountIndexFromUrl(pendingOpenUrl);
    if (launchAccountIndex !== null) {
      activeAccountIndex = launchAccountIndex;
      savePreferredAccountIndex(activeAccountIndex);
    }

    setDockIcon();
    configureSession();
    createMenu();
    createMainWindow(pendingOpenUrl || gmailUrl(activeAccountIndex));
    createTray();
    refreshGoogleAccounts({ force: true }).catch((error) => {
      console.error("Could not load Google account labels:", error);
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow(gmailUrl(activeAccountIndex));
      } else {
        showMainWindow();
      }
    });
  });

  app.on("before-quit", (event) => {
    if (process.platform === "darwin" && !isQuitting) {
      event.preventDefault();
      closeAppToTray();
      return;
    }

    isQuitting = true;
    if (googleAccountRefreshTimer) {
      clearTimeout(googleAccountRefreshTimer);
    }
  });

  app.on("window-all-closed", () => {
    mainWindow = null;

    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
