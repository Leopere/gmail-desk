const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");

const {
  app,
  BrowserWindow,
  ipcMain,
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
const UBLOCK_ORIGIN_ID = "cjpalhdlnbpafiamejdnhcphjbkeiagm";
const SUPPORTED_EXTENSIONS = [
  {
    configKey: "grammarly",
    enableEnv: "GMAIL_DESK_ENABLE_GRAMMARLY",
    envPath: "GMAIL_DESK_GRAMMARLY_PATH",
    id: "kbfnbcaeplbcioakkpcpgfkobkghlhen",
    name: "Grammarly"
  }
];
const UBLOCK_ASSET_RELATIVE_PATHS = [
  path.join("assets", "ublock", "filters.min.txt"),
  path.join("assets", "ublock", "privacy.min.txt"),
  path.join("assets", "ublock", "badware.min.txt"),
  path.join("assets", "ublock", "quick-fixes.min.txt"),
  path.join("assets", "thirdparties", "easylist", "easylist.txt"),
  path.join("assets", "thirdparties", "easylist", "easyprivacy.txt"),
  path.join("assets", "thirdparties", "urlhaus-filter", "urlhaus-filter-online.txt")
];
const BUILT_IN_BLOCKED_HOSTS = [
  "2mdn.net",
  "ad.doubleclick.net",
  "ads.google.com",
  "adservice.google.com",
  "adservice.google.ca",
  "googlesyndication.com",
  "googleadservices.com",
  "googletagmanager.com",
  "googletagservices.com",
  "pagead2.googlesyndication.com",
  "securepubads.g.doubleclick.net"
];
const BUILT_IN_ALLOWED_EXACT_HOSTS = [
  "accounts.google.com",
  "gmail.com",
  "google.com",
  "mail.google.com",
  "myaccount.google.com",
  "www.google.com",
  "www.youtube.com",
  "youtube.com"
];
const BUILT_IN_ALLOWED_HOST_SUFFIXES = [
  "googleapis.com",
  "googleusercontent.com",
  "gstatic.com",
  "grammarly.com",
  "grammarly.io",
  "grammarly.net"
];
const GRAMMARLY_HOST_SUFFIXES = [
  "grammarly.com",
  "grammarly.io",
  "grammarly.net"
];
const GRAMMARLY_EDITOR_URL = "https://app.grammarly.com/";
const EXTENSION_SERVICE_WORKER_SHIM_VERSION = 15;
const PATCH_GRAMMARLY_ENV = "GMAIL_DESK_PATCH_GRAMMARLY";

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
let loadedExtensions = [];
let extensionLoadErrors = [];
let extensionShimPort = 0;
let extensionShimServer = null;
let extensionShimToken = "";
let aiOverlaySource = "";
let aiDebugEnabled = false;
let contentBlockerRuleCount = 0;
let contentBlockerErrors = [];

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

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return {};
  }
}

function aiConfigPath() {
  return path.join(app.getPath("userData"), "ai.json");
}

function codexAuthPaths() {
  return [
    path.join(app.getPath("userData"), "Codex", "auth.json"),
    path.join(app.getPath("home"), ".codex", "auth.json")
  ];
}

function aiConfig() {
  const config = readJsonFile(aiConfigPath());
  const codexAuth = codexAuthPaths()
    .map(readJsonFile)
    .find((candidate) => candidate.OPENAI_API_KEY);

  return {
    apiKey: process.env.OPENAI_API_KEY || config.apiKey || (codexAuth && codexAuth.OPENAI_API_KEY) || "",
    model: process.env.GMAIL_DESK_AI_MODEL || config.model || "gpt-5.5"
  };
}

function envFlagEnabled(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] || "").toLowerCase());
}

function isDevDebugAvailable() {
  return !app.isPackaged || envFlagEnabled("GMAIL_DESK_DEV_MODE") || envFlagEnabled("GMAIL_DESK_AI_DEBUG");
}

function isAiDebugEnabled() {
  return isDevDebugAvailable() && (aiDebugEnabled || envFlagEnabled("GMAIL_DESK_AI_DEBUG"));
}

function aiDebugStatus() {
  return {
    available: isDevDebugAvailable(),
    enabled: isAiDebugEnabled()
  };
}

function summarizeAiPayload(input) {
  const email = input.email || {};
  return {
    bodyChars: String(email.body || "").length,
    dateChars: String(email.date || "").length,
    directionChars: String(input.userDirection || "").length,
    fromPresent: Boolean(email.from),
    mode: input.mode,
    replyMode: input.replyMode,
    subjectChars: String(email.subject || "").length
  };
}

function summarizeAiResult(result) {
  return {
    classification: result.classification,
    draftCount: Array.isArray(result.drafts) ? result.drafts.length : 0,
    draftChars: Array.isArray(result.drafts)
      ? result.drafts.map((draft) => String(draft.body || "").length)
      : [],
    needsUserInput: result.needsUserInput,
    responseIntentCount: Array.isArray(result.responseIntentOptions) ? result.responseIntentOptions.length : 0,
    senderIntentCount: Array.isArray(result.senderIntentTokens) ? result.senderIntentTokens.length : 0
  };
}

function debugAi(eventName, details = {}) {
  if (!isAiDebugEnabled()) {
    return;
  }

  console.debug(`[Gmail Desk AI Debug] ${eventName}`, details);
}

function chromeCookieFromElectronCookie(cookie) {
  if (!cookie) {
    return null;
  }

  return {
    domain: cookie.domain,
    expirationDate: cookie.expirationDate,
    hostOnly: !String(cookie.domain || "").startsWith("."),
    httpOnly: Boolean(cookie.httpOnly),
    name: cookie.name,
    path: cookie.path,
    sameSite: cookie.sameSite,
    secure: Boolean(cookie.secure),
    session: Boolean(cookie.session),
    storeId: "0",
    value: cookie.value
  };
}

function cookieFilterFromDetails(details = {}) {
  const filter = {};
  for (const key of ["domain", "name", "path", "secure", "url"]) {
    if (details[key] !== undefined) {
      filter[key] = details[key];
    }
  }
  return filter;
}

function cookieSetDetails(details = {}) {
  const setDetails = {};
  for (const key of ["domain", "expirationDate", "httpOnly", "name", "path", "sameSite", "secure", "url", "value"]) {
    if (details[key] !== undefined) {
      setDetails[key] = details[key];
    }
  }
  return setDetails;
}

function focusedWindowPayload() {
  const focusedWindow = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!focusedWindow || focusedWindow.isDestroyed()) {
    return null;
  }

  const bounds = focusedWindow.getBounds();
  return {
    alwaysOnTop: focusedWindow.isAlwaysOnTop(),
    focused: focusedWindow.isFocused(),
    height: bounds.height,
    id: focusedWindow.id,
    incognito: false,
    left: bounds.x,
    state: focusedWindow.isMinimized() ? "minimized" : "normal",
    tabs: [],
    top: bounds.y,
    type: "normal",
    width: bounds.width
  };
}

function activeTabPayload() {
  const targetWindow = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : BrowserWindow.getFocusedWindow();
  if (!targetWindow || targetWindow.isDestroyed()) {
    return null;
  }

  const webContents = targetWindow.webContents;
  return {
    active: true,
    audible: false,
    discarded: false,
    favIconUrl: "",
    frozen: false,
    height: targetWindow.getBounds().height,
    highlighted: true,
    id: webContents.id,
    incognito: false,
    index: 0,
    mutedInfo: { muted: false },
    pinned: false,
    selected: true,
    status: webContents.isLoading() ? "loading" : "complete",
    title: webContents.getTitle(),
    url: webContents.getURL(),
    width: targetWindow.getBounds().width,
    windowId: targetWindow.id
  };
}

function supportedExtensionById(extensionId) {
  return SUPPORTED_EXTENSIONS.find((extension) => extension.id === extensionId) || null;
}

function parseRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function writeJsonResponse(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "access-control-allow-headers": "content-type, x-gmail-desk-extension-shim",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-origin": "*",
    "content-type": "application/json"
  });
  response.end(JSON.stringify(payload));
}

async function extensionShimResult(route, payload) {
  const details = payload && payload.details ? payload.details : {};

  switch (route) {
    case "/cookies.get": {
      const [cookie] = await session.defaultSession.cookies.get(cookieFilterFromDetails(details));
      return chromeCookieFromElectronCookie(cookie);
    }
    case "/cookies.getAll": {
      const cookies = await session.defaultSession.cookies.get(cookieFilterFromDetails(details));
      return cookies.map(chromeCookieFromElectronCookie);
    }
    case "/cookies.getAllCookieStores":
      return [{ id: "0", tabIds: [] }];
    case "/cookies.remove":
      if (!details.url || !details.name) {
        return null;
      }
      await session.defaultSession.cookies.remove(details.url, details.name);
      return { name: details.name, storeId: "0", url: details.url };
    case "/cookies.set": {
      const setDetails = cookieSetDetails(details);
      if (!setDetails.url || !setDetails.name) {
        return null;
      }
      await session.defaultSession.cookies.set(setDetails);
      const [cookie] = await session.defaultSession.cookies.get({
        name: setDetails.name,
        url: setDetails.url
      });
      return chromeCookieFromElectronCookie(cookie);
    }
    case "/windows.get":
    case "/windows.getCurrent":
    case "/windows.getLastFocused":
    case "/windows.update":
      return focusedWindowPayload();
    case "/windows.getAll":
      return BrowserWindow.getAllWindows()
        .filter((browserWindow) => !browserWindow.isDestroyed())
        .map((browserWindow) => {
          const bounds = browserWindow.getBounds();
          return {
            alwaysOnTop: browserWindow.isAlwaysOnTop(),
            focused: browserWindow.isFocused(),
            height: bounds.height,
            id: browserWindow.id,
            incognito: false,
            left: bounds.x,
            state: browserWindow.isMinimized() ? "minimized" : "normal",
            tabs: [],
            top: bounds.y,
            type: "normal",
            width: bounds.width
          };
        });
    case "/tabs.query": {
      const tab = activeTabPayload();
      return tab ? [tab] : [];
    }
    default:
      throw new Error(`Unknown extension shim route: ${route}`);
  }
}

async function ensureExtensionShimServer() {
  if (extensionShimServer && extensionShimPort) {
    return {
      port: extensionShimPort,
      token: extensionShimToken
    };
  }

  extensionShimToken = randomBytes(24).toString("hex");
  extensionShimServer = http.createServer(async (request, response) => {
    try {
      if (request.method === "OPTIONS") {
        writeJsonResponse(response, 204, {});
        return;
      }

      if (request.method !== "POST" || request.headers["x-gmail-desk-extension-shim"] !== extensionShimToken) {
        writeJsonResponse(response, 403, { error: "Forbidden" });
        return;
      }

      const payload = await parseRequestBody(request);
      if (!supportedExtensionById(payload.extensionId)) {
        writeJsonResponse(response, 403, { error: "Unsupported extension" });
        return;
      }

      const route = new URL(request.url, `http://${request.headers.host}`).pathname;
      const result = await extensionShimResult(route, payload);
      writeJsonResponse(response, 200, { result });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      writeJsonResponse(response, 500, { error: message });
    }
  });

  await new Promise((resolve, reject) => {
    extensionShimServer.once("error", reject);
    extensionShimServer.listen(0, "127.0.0.1", () => {
      extensionShimServer.off("error", reject);
      extensionShimPort = extensionShimServer.address().port;
      resolve();
    });
  });

  return {
    port: extensionShimPort,
    token: extensionShimToken
  };
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

function truncateText(value, maxLength) {
  const text = String(value || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 80)}\n\n[Truncated ${text.length - maxLength + 80} characters]`;
}

function extractResponseText(responseBody) {
  if (typeof responseBody.output_text === "string") {
    return responseBody.output_text;
  }

  const chunks = [];
  for (const item of responseBody.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function normalizeAiResult(result) {
  return {
    classification: String(result.classification || "needs_clarification"),
    needsUserInput: result.needsUserInput !== false,
    warrantedResponse: String(result.warrantedResponse || ""),
    reasoning: String(result.reasoning || ""),
    replyAllRecommendation: String(result.replyAllRecommendation || ""),
    responseStrategy: String(result.responseStrategy || ""),
    senderIntentTokens: Array.isArray(result.senderIntentTokens)
      ? result.senderIntentTokens.slice(0, 6).map(String)
      : [],
    responseIntentOptions: Array.isArray(result.responseIntentOptions)
      ? result.responseIntentOptions.slice(0, 6).map(String)
      : [],
    suggestedIntentQuestions: Array.isArray(result.suggestedIntentQuestions)
      ? result.suggestedIntentQuestions.slice(0, 5).map(String)
      : [],
    risks: Array.isArray(result.risks) ? result.risks.slice(0, 5).map(String) : [],
    drafts: Array.isArray(result.drafts)
      ? result.drafts.slice(0, 3).map((draft) => ({
          body: String(draft && draft.body ? draft.body : ""),
          label: String(draft && draft.label ? draft.label : "Suggested reply"),
          tone: String(draft && draft.tone ? draft.tone : "")
        })).filter((draft) => draft.body)
      : []
  };
}

function aiResultJsonSchema() {
  return {
    additionalProperties: false,
    properties: {
      classification: {
        enum: ["simple_ask", "handwritten_reply", "needs_clarification", "no_reply_needed"],
        type: "string"
      },
      drafts: {
        items: {
          additionalProperties: false,
          properties: {
            body: { type: "string" },
            label: { type: "string" },
            tone: { type: "string" }
          },
          required: ["label", "tone", "body"],
          type: "object"
        },
        type: "array"
      },
      needsUserInput: { type: "boolean" },
      reasoning: { type: "string" },
      replyAllRecommendation: { type: "string" },
      responseIntentOptions: {
        items: { type: "string" },
        type: "array"
      },
      responseStrategy: { type: "string" },
      risks: {
        items: { type: "string" },
        type: "array"
      },
      senderIntentTokens: {
        items: { type: "string" },
        type: "array"
      },
      suggestedIntentQuestions: {
        items: { type: "string" },
        type: "array"
      },
      warrantedResponse: { type: "string" }
    },
    required: [
      "classification",
      "needsUserInput",
      "senderIntentTokens",
      "responseIntentOptions",
      "warrantedResponse",
      "reasoning",
      "replyAllRecommendation",
      "responseStrategy",
      "suggestedIntentQuestions",
      "risks",
      "drafts"
    ],
    type: "object"
  };
}

function codexHomePath() {
  return path.join(app.getPath("userData"), "Codex");
}

function findCodexCliPath() {
  const candidates = [
    process.env.GMAIL_DESK_CODEX_CLI_PATH,
    path.join(app.getPath("home"), ".local", "bin", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "codex"
  ].filter(Boolean);

  return candidates.find((candidate) => {
    if (candidate === "codex") {
      return true;
    }
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch (_error) {
      return false;
    }
  }) || "";
}

function parsePossiblyJsonText(value) {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(text);
}

function runCodexExec({ prompt, schemaPath, outputPath }) {
  const codexPath = findCodexCliPath();
  if (!codexPath) {
    throw new Error("Codex CLI not found. Set GMAIL_DESK_CODEX_CLI_PATH or configure an OpenAI API key.");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(codexPath, [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-rules",
      "-s",
      "read-only",
      "-C",
      app.getPath("userData"),
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      "-"
    ], {
      env: {
        ...process.env,
        CODEX_HOME: fs.existsSync(path.join(codexHomePath(), "auth.json")) ? codexHomePath() : (process.env.CODEX_HOME || path.join(app.getPath("home"), ".codex"))
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Codex CLI exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      resolve();
    });
    child.stdin.end(prompt);
  });
}

async function analyzeEmailWithCodexCli(input, instructions) {
  const schemaPath = path.join(app.getPath("userData"), "ai-reply-schema.json");
  const outputPath = path.join(app.getPath("userData"), "ai-reply-output.json");
  fs.writeFileSync(schemaPath, JSON.stringify(aiResultJsonSchema(), null, 2), "utf8");
  await fs.promises.rm(outputPath, { force: true });

  const prompt = [
    instructions,
    "",
    "Return only the JSON object matching the provided output schema.",
    "Do not inspect the filesystem, do not run commands, and do not modify anything.",
    "",
    "Email analysis payload:",
    JSON.stringify(input, null, 2)
  ].join("\n");

  await runCodexExec({ outputPath, prompt, schemaPath });
  const output = fs.readFileSync(outputPath, "utf8");
  return normalizeAiResult(parsePossiblyJsonText(output));
}

async function analyzeEmailWithAi(payload) {
  const { apiKey, model } = aiConfig();
  const email = payload && payload.email ? payload.email : {};
  const mode = payload && payload.mode === "draft" ? "draft" : "assess";
  const userDirection = truncateText(payload && (payload.userDirection || payload.intention), 1200);
  const replyMode = payload && payload.replyMode === "replyAll" ? "replyAll" : "reply";
  const input = {
    email: {
      body: truncateText(email.body, 12000),
      date: truncateText(email.date, 200),
      from: truncateText(email.from, 300),
      subject: truncateText(email.subject, 500)
    },
    mode,
    replyMode,
    userDirection: userDirection || ""
  };
  const provider = apiKey ? "openai-api" : "codex-cli";

  const instructions = [
    "You are Gmail Desk's local reply-assist agent.",
    "Never send email, never claim an email was sent, and never ask for authority to send.",
    "Give suggestions the user can copy or insert manually into a Gmail reply or reply-all draft.",
    "First infer the sender's intent from the currently presented email. Use short intent tokens such as asks-confirmation, asks-scheduling, FYI, sales, action-required, sensitive, no-reply-needed.",
    "Then suggest likely response intent options the user may choose from, but do not assume the user's actual intention until they provide direction.",
    "If mode is assess, drafts must be an empty array. Focus on senderIntentTokens, responseIntentOptions, classification, warrantedResponse, and suggestedIntentQuestions.",
    "If mode is draft, use userDirection and replyMode to produce up to three drafts suitable for manual insertion into Gmail.",
    "Classify whether the email is a simple ask, warrants a handwritten reply, needs clarification, or likely needs no reply.",
    "Prefer concise, practical language. Preserve user agency.",
    "Return only valid JSON with these keys: classification, needsUserInput, senderIntentTokens, responseIntentOptions, warrantedResponse, reasoning, replyAllRecommendation, responseStrategy, suggestedIntentQuestions, risks, drafts.",
    "classification must be one of: simple_ask, handwritten_reply, needs_clarification, no_reply_needed.",
    "needsUserInput should be true for assess mode unless no reply is needed.",
    "drafts must contain up to three objects with label, tone, and body."
  ].join("\n");

  debugAi("request", {
    provider,
    ...summarizeAiPayload(input)
  });

  if (!apiKey) {
    try {
      const result = await analyzeEmailWithCodexCli(input, instructions);
      debugAi("response", {
        provider,
        ...summarizeAiResult(result)
      });
      return result;
    } catch (error) {
      debugAi("error", {
        message: error && error.message ? error.message : String(error),
        provider
      });
      throw error;
    }
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        input: JSON.stringify(input, null, 2),
        instructions,
        model,
        reasoning: {
          effort: "low"
        },
        text: {
          format: {
            type: "json_object"
          }
        }
      })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body.error && body.error.message
        ? body.error.message
        : `OpenAI API returned HTTP ${response.status}.`;
      throw new Error(message);
    }

    const text = extractResponseText(body);
    if (!text) {
      throw new Error("OpenAI API returned no text output.");
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_error) {
      throw new Error("OpenAI API returned non-JSON output.");
    }

    const result = normalizeAiResult(parsed);
    debugAi("response", {
      provider,
      ...summarizeAiResult(result)
    });
    return result;
  } catch (error) {
    debugAi("error", {
      message: error && error.message ? error.message : String(error),
      provider
    });
    throw error;
  }
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

function isGrammarlyUrl(urlValue) {
  try {
    const url = new URL(urlValue);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return false;
    }

    const host = url.hostname.toLowerCase();
    return GRAMMARLY_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch (_error) {
    return false;
  }
}

function isSupportedExtensionUrl(urlValue) {
  try {
    const url = new URL(urlValue);
    return url.protocol === "chrome-extension:" &&
      SUPPORTED_EXTENSIONS.some((extension) => extension.id === url.hostname);
  } catch (_error) {
    return false;
  }
}

function isInternalBrowserUrl(urlValue) {
  return isAppUrl(urlValue) ||
    isGrammarlyUrl(urlValue) ||
    isSupportedExtensionUrl(urlValue) ||
    String(urlValue || "").startsWith("about:");
}

function referrerUrlFromWindowOpenDetails(details = {}) {
  return details.referrer && details.referrer.url ? details.referrer.url : "";
}

function isExtensionInitiatedWindowOpen(details = {}) {
  return isSupportedExtensionUrl(referrerUrlFromWindowOpenDetails(details)) ||
    isSupportedExtensionUrl(details.url);
}

function handleWindowOpenForMainWindow(details = {}) {
  const { url } = details;
  if (isAppUrl(url)) {
    noteGoogleAccountNavigation(url);
    loadAppUrl(mainWindow, url);
  } else if (isGrammarlyUrl(url) || isSupportedExtensionUrl(url)) {
    openInternalBrowserUrl(url);
  } else if (isExtensionInitiatedWindowOpen(details)) {
    console.warn(`Blocked extension-triggered external window: ${url}`);
  } else if (isHttpUrl(url)) {
    console.warn(`Blocked main-window external popup: ${url}`);
  }

  return { action: "deny" };
}

function handleWindowOpenForInternalWindow(targetWindow, details = {}) {
  const { url } = details;
  if (isInternalBrowserUrl(url)) {
    noteGoogleAccountNavigation(url);
    loadBrowserUrl(targetWindow, url);
  } else if (isHttpUrl(url)) {
    console.warn(`Blocked internal-window external popup: ${url}`);
  }

  return { action: "deny" };
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

function loadBrowserUrl(targetWindow, url) {
  targetWindow.loadURL(url, {
    userAgent: chromeCompatibleUserAgent()
  });
}

function createInternalBrowserWindow(startUrl, { onClosed, title = APP_NAME } = {}) {
  const ownerWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const browserWindow = new BrowserWindow({
    parent: ownerWindow,
    width: 980,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    title,
    backgroundColor: "#fff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });

  browserWindow.webContents.setUserAgent(chromeCompatibleUserAgent());
  browserWindow.webContents.setWindowOpenHandler((details) => handleWindowOpenForInternalWindow(browserWindow, details));

  browserWindow.webContents.on("will-navigate", (event, url) => {
    noteGoogleAccountNavigation(url);
    if (isInternalBrowserUrl(url)) {
      return;
    }

    event.preventDefault();
    console.warn(`Blocked internal-window external navigation: ${url}`);
  });

  browserWindow.webContents.on("will-redirect", (event, url) => {
    noteGoogleAccountNavigation(url);
    if (isInternalBrowserUrl(url)) {
      return;
    }

    event.preventDefault();
    console.warn(`Blocked internal-window external redirect: ${url}`);
  });

  if (typeof onClosed === "function") {
    browserWindow.on("closed", () => {
      onClosed();
    });
  }

  loadBrowserUrl(browserWindow, startUrl);
  return browserWindow;
}

function openInternalBrowserUrl(url, options = {}) {
  if (!isInternalBrowserUrl(url)) {
    return false;
  }

  createInternalBrowserWindow(url, {
    ...options,
    title: isGrammarlyUrl(url) || isSupportedExtensionUrl(url) ? "Grammarly" : APP_NAME
  });
  return true;
}

function openGrammarlyAccount() {
  return openInternalBrowserUrl(GRAMMARLY_EDITOR_URL, {
    onClosed() {
      refreshWritingToolsAfterAuth("grammarly-auth-window-closed").catch((error) => {
        console.error("Could not refresh writing tools after Grammarly auth:", error);
      });
    }
  });
}

function aiOverlayScript() {
  if (!aiOverlaySource) {
    aiOverlaySource = fs.readFileSync(path.join(__dirname, "gmail-ai-overlay.js"), "utf8");
  }

  return aiOverlaySource;
}

function injectAiAssistant({ show = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed() || !isGmailWebUrl(mainWindow.webContents.getURL())) {
    return;
  }

  mainWindow.webContents
    .executeJavaScript(aiOverlayScript(), true)
    .then(() => {
      if (show && mainWindow && !mainWindow.isDestroyed()) {
        return mainWindow.webContents.executeJavaScript("window.dispatchEvent(new CustomEvent('gmail-desk-ai-show'));", true);
      }
      return null;
    })
    .catch((_error) => {
      // Gmail may still be navigating. The next load event will retry.
    });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow(gmailUrl(activeAccountIndex));
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (process.platform === "darwin" && app.dock) {
    app.dock.show();
  }

  mainWindow.show();
  mainWindow.moveTop();
  mainWindow.focus();
  app.focus({ steal: true });
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
  targetSession.setPreloads([path.join(__dirname, "extension-shim-preload.js")]);
  configureContentBlocker(targetSession);
  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents.getURL();
    const allowedPermissions = new Set([
      "clipboard-sanitized-write",
      "fullscreen",
      "notifications"
    ]);
    callback(isInternalBrowserUrl(requestingUrl) && allowedPermissions.has(permission));
  });
}

function splitPathList(value) {
  return String(value || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function existingDirectory(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch (_error) {
    return false;
  }
}

function readManifest(extensionPath) {
  const manifestPath = path.join(extensionPath, "manifest.json");
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (_error) {
    return null;
  }
}

function patchedExtensionRoot(extensionId, version) {
  return path.join(app.getPath("userData"), "Patched Extensions", extensionId, version || "unknown");
}

function sourceExtensionMarker(extensionPath, manifest) {
  let manifestMtimeMs = 0;
  let sourcePath = extensionPath;
  try {
    sourcePath = fs.realpathSync(extensionPath);
    manifestMtimeMs = fs.statSync(path.join(extensionPath, "manifest.json")).mtimeMs;
  } catch (_error) {
    // Keep best-effort marker values.
  }

  return {
    manifestMtimeMs,
    shimVersion: EXTENSION_SERVICE_WORKER_SHIM_VERSION,
    sourcePath,
    version: manifest && manifest.version ? manifest.version : ""
  };
}

function clearServiceWorkerScriptCacheForPatchedExtension() {
  const userDataPath = app.getPath("userData");
  const cachePaths = [
    path.join(userDataPath, "Service Worker", "ScriptCache"),
    path.join(userDataPath, "Code Cache", "js")
  ];

  for (const cachePath of cachePaths) {
    try {
      fs.rmSync(cachePath, { force: true, recursive: true });
    } catch (error) {
      console.warn(`Could not clear extension script cache at ${cachePath}:`, error);
    }
  }
}

function serviceWorkerShimSource({ extensionId, port, token }) {
  return `
var chrome = Object.create(self.chrome || globalThis.chrome || null);
const extensionId = ${JSON.stringify(extensionId)};
const endpoint = "http://127.0.0.1:${port}";
const token = ${JSON.stringify(token)};
const chromeObject = chrome;

  function defineApi(name, value) {
    try {
      Object.defineProperty(chromeObject, name, {
        configurable: true,
        enumerable: true,
        value,
        writable: true
      });
    } catch (_error) {
      chromeObject[name] = value;
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

  async function request(route, details) {
    const response = await fetch(endpoint + "/" + route, {
      body: JSON.stringify({ details: details || {}, extensionId }),
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-gmail-desk-extension-shim": token
      },
      method: "POST"
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    return payload.result === undefined ? null : payload.result;
  }

  function invoke(route, fallback) {
    return (...args) => {
      const callback = typeof args[args.length - 1] === "function" ? args.pop() : null;
      const details = args[0] || {};
      const promise = request(route, details).then((result) => result === null ? fallback : result).catch(() => fallback);
      if (callback) {
        promise.then((result) => callback(result));
        return undefined;
      }
      return promise;
    };
  }

	  function noop(fallback) {
	    return (...args) => {
	      const callback = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;
	      if (callback) {
	        Promise.resolve().then(() => callback(fallback));
        return undefined;
      }
	      return Promise.resolve(fallback);
	    };
	  }

	  function method(existingObject, name, fallback) {
	    const candidate = existingObject && existingObject[name];
	    return typeof candidate === "function" ? candidate.bind(existingObject) : fallback;
	  }

	  const cookies = chromeObject.cookies || {};
	  defineApi("cookies", {
	    ...cookies,
	    get: method(cookies, "get", invoke("cookies.get", null)),
	    getAll: method(cookies, "getAll", invoke("cookies.getAll", [])),
	    getAllCookieStores: method(cookies, "getAllCookieStores", invoke("cookies.getAllCookieStores", [])),
	    onChanged: cookies.onChanged || new ExtensionEvent("cookies.onChanged"),
	    remove: method(cookies, "remove", invoke("cookies.remove", null)),
	    set: method(cookies, "set", invoke("cookies.set", null))
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
	      clear: method(existingArea, "clear", (callback) => {
	        for (const key of Object.keys(memory)) {
	          delete memory[key];
	        }
	        if (callback) queueMicrotask(callback);
	      }),
	      get: method(existingArea, "get", (keys, callback) => {
	        const result = selected(keys);
	        if (callback) {
	          queueMicrotask(() => callback(result));
	          return undefined;
	        }
	        return Promise.resolve(result);
	      }),
	      getBytesInUse: method(existingArea, "getBytesInUse", (_keys, callback) => {
	        const size = JSON.stringify(memory).length;
	        if (callback) {
	          queueMicrotask(() => callback(size));
	          return undefined;
	        }
	        return Promise.resolve(size);
	      }),
	      onChanged: existingArea.onChanged || new ExtensionEvent("storage." + areaName + ".onChanged"),
	      remove: method(existingArea, "remove", (keys, callback) => {
	        const list = Array.isArray(keys) ? keys : [keys];
	        for (const key of list) {
	          delete memory[key];
	        }
	        if (callback) queueMicrotask(callback);
	      }),
	      set: method(existingArea, "set", (items, callback) => {
	        Object.assign(memory, items || {});
	        if (callback) queueMicrotask(callback);
	      }),
	      setAccessLevel: method(existingArea, "setAccessLevel", noop(undefined))
	    };
	  }

  const storage = chromeObject.storage || {};
  defineApi("storage", {
    ...storage,
    local: storageArea(storage.local || {}, "local"),
    onChanged: storage.onChanged || new ExtensionEvent("storage.onChanged"),
    session: storageArea(storage.session || {}, "session"),
    sync: storageArea(storage.sync || {}, "sync")
  });

  const tabs = chromeObject.tabs || {};
	  defineApi("tabs", {
	    ...tabs,
	    create: method(tabs, "create", noop(null)),
	    onActivated: tabs.onActivated || new ExtensionEvent("tabs.onActivated"),
	    onRemoved: tabs.onRemoved || new ExtensionEvent("tabs.onRemoved"),
	    onUpdated: tabs.onUpdated || new ExtensionEvent("tabs.onUpdated"),
	    query: method(tabs, "query", invoke("tabs.query", []))
	  });

  const windows = chromeObject.windows || {};
  defineApi("windows", {
	    ...windows,
	    WINDOW_ID_CURRENT: windows.WINDOW_ID_CURRENT || -2,
	    WINDOW_ID_NONE: windows.WINDOW_ID_NONE || -1,
	    create: method(windows, "create", noop(null)),
	    get: method(windows, "get", invoke("windows.get", null)),
	    getAll: method(windows, "getAll", invoke("windows.getAll", [])),
	    getCurrent: method(windows, "getCurrent", invoke("windows.getCurrent", null)),
	    getLastFocused: method(windows, "getLastFocused", invoke("windows.getLastFocused", null)),
	    onBoundsChanged: windows.onBoundsChanged || new ExtensionEvent("windows.onBoundsChanged"),
	    onCreated: windows.onCreated || new ExtensionEvent("windows.onCreated"),
	    onFocusChanged: windows.onFocusChanged || new ExtensionEvent("windows.onFocusChanged"),
	    onRemoved: windows.onRemoved || new ExtensionEvent("windows.onRemoved"),
	    remove: method(windows, "remove", noop(null)),
	    update: method(windows, "update", invoke("windows.update", null))
	  });

	  const identity = chromeObject.identity || {};
	  defineApi("identity", {
	    ...identity,
	    getRedirectURL: identity.getRedirectURL || ((path = "") => "https://" + extensionId + ".chromiumapp.org/" + String(path || "").replace(/^\\//, "")),
	    launchWebAuthFlow: method(identity, "launchWebAuthFlow", noop(undefined))
	  });

	  const notifications = chromeObject.notifications || {};
	  defineApi("notifications", {
	    ...notifications,
	    clear: method(notifications, "clear", noop(false)),
	    create: method(notifications, "create", noop("")),
	    getAll: method(notifications, "getAll", noop({})),
	    onButtonClicked: notifications.onButtonClicked || new ExtensionEvent("notifications.onButtonClicked"),
	    onClicked: notifications.onClicked || new ExtensionEvent("notifications.onClicked"),
	    onClosed: notifications.onClosed || new ExtensionEvent("notifications.onClosed"),
	    update: method(notifications, "update", noop(false))
	  });

	  const sidePanel = chromeObject.sidePanel || {};
	  defineApi("sidePanel", {
	    ...sidePanel,
	    open: method(sidePanel, "open", noop(undefined)),
	    setOptions: method(sidePanel, "setOptions", noop(undefined))
	  });

	  const management = chromeObject.management || {};
	  defineApi("management", {
	    ...management,
	    uninstallSelf: method(management, "uninstallSelf", noop(undefined))
	  });

  self.chrome = chromeObject;
  globalThis.chrome = chromeObject;
var gmailDeskChrome = chromeObject;
	`.trim();
}

function patchGrammarlyBackgroundSource(source, shimSource) {
  const patchedSource = source
    .replaceAll("this._chromeInstance.storage.session", "(this._chromeInstance.storage && this._chromeInstance.storage.session || gmailDeskChrome.storage.session)")
    .replaceAll("this._chrome.windows", "(this._chrome && this._chrome.windows || gmailDeskChrome.windows)")
    .replace(/\bself\.chrome\.(cookies|identity|management|notifications|runtime|sidePanel|storage|tabs|windows)\b/g, "gmailDeskChrome.$1")
    .replace(/(?<![.\w$"])chrome\.(cookies|identity|management|notifications|runtime|sidePanel|storage|tabs|windows)\b/g, "gmailDeskChrome.$1");
  return `${shimSource}\n${patchedSource}\n`;
}

function grammarlyTrustedTypesShimSource() {
  return `
;(() => {
  if (globalThis.__gmailDeskTrustedTypesShimInstalled) {
    return;
  }
  globalThis.__gmailDeskTrustedTypesShimInstalled = true;

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
    // A page or another content script may already own the default policy.
  }
})();
`.trim();
}

function patchGrammarlyContentScriptSource(source) {
  if (source.includes("__gmailDeskTrustedTypesShimInstalled")) {
    return source;
  }

  return `${grammarlyTrustedTypesShimSource()}\n${source}`;
}

function patchGrammarlyContentScriptsForElectron(sourceRoot, targetRoot, manifest) {
  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  const scriptPaths = new Set();
  for (const contentScript of contentScripts) {
    for (const scriptPath of contentScript.js || []) {
      scriptPaths.add(scriptPath);
    }
  }

  for (const scriptPath of scriptPaths) {
    const sourcePath = path.join(sourceRoot, scriptPath);
    const targetPath = path.join(targetRoot, scriptPath);
    if (!fs.existsSync(sourcePath) || !fs.existsSync(targetPath)) {
      continue;
    }

    fs.writeFileSync(targetPath, patchGrammarlyContentScriptSource(fs.readFileSync(sourcePath, "utf8")), "utf8");
  }
}

function patchGrammarlyManifestForElectron(manifestPath) {
  const manifest = readJsonFile(manifestPath);
  const policy = manifest.content_security_policy || {};
  const extensionPages = typeof policy.extension_pages === "string" ? policy.extension_pages : "";
  const loopbackSource = "http://127.0.0.1:*";

  if (!extensionPages || extensionPages.includes(loopbackSource)) {
    return;
  }

  const updatedExtensionPages = extensionPages.includes("connect-src")
    ? extensionPages.replace(/connect-src\s+([^;]*)(;?)/, (match, sources, terminator) => {
      const suffix = terminator || ";";
      return `connect-src ${sources.trim()} ${loopbackSource}${suffix}`;
    })
    : `${extensionPages.replace(/\s*$/, "")} connect-src 'self' ${loopbackSource};`;

  fs.writeFileSync(manifestPath, JSON.stringify({
    ...manifest,
    content_security_policy: {
      ...policy,
      extension_pages: updatedExtensionPages
    }
  }, null, 2), "utf8");
}

async function prepareGrammarlyExtensionForElectron(entry, manifest) {
  const { port, token } = await ensureExtensionShimServer();
  const targetRoot = patchedExtensionRoot(entry.id, manifest.version);
  const markerPath = path.join(targetRoot, ".gmail-desk-source.json");
  const marker = sourceExtensionMarker(entry.extensionPath, manifest);
  const previousMarker = readJsonFile(markerPath);
  const shouldCopy = previousMarker.sourcePath !== marker.sourcePath ||
    previousMarker.version !== marker.version ||
    previousMarker.manifestMtimeMs !== marker.manifestMtimeMs ||
    previousMarker.shimVersion !== marker.shimVersion ||
    !fs.existsSync(path.join(targetRoot, "manifest.json"));

  if (shouldCopy) {
    fs.rmSync(targetRoot, { force: true, recursive: true });
    fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
    fs.cpSync(entry.extensionPath, targetRoot, { recursive: true });
    fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2), "utf8");
  }

  const sourceSwPath = path.join(entry.extensionPath, "sw.js");
  const targetSwPath = path.join(targetRoot, "sw.js");
  const sourceBackgroundPath = path.join(entry.extensionPath, "src", "js", "Grammarly-bg.js");
  const targetBackgroundPath = path.join(targetRoot, "src", "js", "Grammarly-bg.js");
  const targetManifestPath = path.join(targetRoot, "manifest.json");
  const shimFileName = "gmail-desk-service-worker-shim.js";
  const shimSource = serviceWorkerShimSource({ extensionId: entry.id, port, token });
  patchGrammarlyManifestForElectron(targetManifestPath);
  patchGrammarlyContentScriptsForElectron(entry.extensionPath, targetRoot, manifest);
  fs.writeFileSync(
    path.join(targetRoot, shimFileName),
    shimSource,
    "utf8"
  );

  const sourceSw = fs.existsSync(sourceSwPath)
    ? fs.readFileSync(sourceSwPath, "utf8")
    : "importScripts('src/js/Grammarly-bg.js')";
  const sourceBackground = fs.existsSync(sourceBackgroundPath)
    ? fs.readFileSync(sourceBackgroundPath, "utf8")
    : "";
  if (sourceBackground) {
    fs.writeFileSync(targetBackgroundPath, patchGrammarlyBackgroundSource(sourceBackground, shimSource), "utf8");
  }
  fs.writeFileSync(targetSwPath, `${sourceSw}\n`, "utf8");
  clearServiceWorkerScriptCacheForPatchedExtension();
  return targetRoot;
}

async function preparedExtensionPath(entry, manifest) {
  if (entry.id === "kbfnbcaeplbcioakkpcpgfkobkghlhen" && (entry.patch === true || envFlagEnabled(PATCH_GRAMMARLY_ENV))) {
    return prepareGrammarlyExtensionForElectron(entry, manifest);
  }

  return entry.extensionPath;
}

function extensionConfigPath() {
  return path.join(app.getPath("userData"), "extensions.json");
}

function readExtensionConfig() {
  try {
    return JSON.parse(fs.readFileSync(extensionConfigPath(), "utf8"));
  } catch (_error) {
    return {};
  }
}

function defaultExtensionRoots() {
  if (process.platform !== "darwin") {
    return [];
  }

  const appSupport = path.join(app.getPath("home"), "Library", "Application Support");
  const roots = [
    path.join(appSupport, "Arc", "User Data", "Default", "Extensions"),
    path.join(appSupport, "Google", "Chrome", "Default", "Extensions"),
    path.join(appSupport, "Google", "Chrome Beta", "Default", "Extensions"),
    path.join(appSupport, "Google", "Chrome Canary", "Default", "Extensions"),
    path.join(appSupport, "BraveSoftware", "Brave-Browser", "Default", "Extensions"),
    path.join(appSupport, "Microsoft Edge", "Default", "Extensions")
  ];

  const chromeUserData = path.join(appSupport, "Google", "Chrome");
  try {
    for (const entry of fs.readdirSync(chromeUserData, { withFileTypes: true })) {
      if (entry.isDirectory() && /^Profile \d+$/.test(entry.name)) {
        roots.push(path.join(chromeUserData, entry.name, "Extensions"));
      }
    }
  } catch (_error) {
    // Chrome may not be installed.
  }

  return roots;
}

function configuredExtensionRoots() {
  const config = readExtensionConfig();
  return [
    ...(Array.isArray(config.searchRoots) ? config.searchRoots : []),
    ...splitPathList(process.env.GMAIL_DESK_EXTENSION_SEARCH_ROOTS),
    ...defaultExtensionRoots()
  ].filter((candidate, index, candidates) => candidate && candidates.indexOf(candidate) === index);
}

function extensionVersionCandidates(extensionRoot) {
  if (!existingDirectory(extensionRoot)) {
    return [];
  }

  try {
    return fs.readdirSync(extensionRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const extensionPath = path.join(extensionRoot, entry.name);
        const manifest = readManifest(extensionPath);
        if (!manifest) {
          return null;
        }

        let modifiedMs = 0;
        try {
          modifiedMs = fs.statSync(path.join(extensionPath, "manifest.json")).mtimeMs;
        } catch (_error) {
          modifiedMs = 0;
        }

        return {
          extensionPath,
          manifest,
          modifiedMs
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.modifiedMs - a.modifiedMs);
  } catch (_error) {
    return [];
  }
}

function findInstalledExtensionPath(extensionId) {
  for (const root of configuredExtensionRoots()) {
    const extensionRoot = path.join(root, extensionId);
    const [candidate] = extensionVersionCandidates(extensionRoot);
    if (candidate) {
      return candidate.extensionPath;
    }
  }

  return "";
}

function configuredExtensionPaths() {
  const config = readExtensionConfig();
  const configured = splitPathList(process.env.GMAIL_DESK_EXTENSION_PATHS)
    .concat(Array.isArray(config.paths) ? config.paths : [])
    .map((extensionPath) => ({
      extensionPath,
      name: path.basename(extensionPath)
    }));

  const detected = SUPPORTED_EXTENSIONS
    .map((extension) => {
      const rawExtensionConfig = config[extension.configKey];
      const extensionConfig = rawExtensionConfig && typeof rawExtensionConfig === "object" ? rawExtensionConfig : {};
      const explicitPath = process.env[extension.envPath] || extensionConfig.path;
      const shouldAutoDetect =
        config.enabled === true ||
        rawExtensionConfig === true ||
        extensionConfig.enabled === true ||
        envFlagEnabled("GMAIL_DESK_ENABLE_EXTENSIONS") ||
        envFlagEnabled(extension.enableEnv);
      const extensionPath = explicitPath || (shouldAutoDetect ? findInstalledExtensionPath(extension.id) : "");
      return extensionPath
        ? {
            extensionPath,
            id: extension.id,
            name: extension.name,
            patch: extensionConfig.patch === true
          }
        : null;
    })
    .filter(Boolean);

  const seen = new Set();
  return [...configured, ...detected].filter((entry) => {
    let key = entry.extensionPath;
    try {
      key = fs.realpathSync(entry.extensionPath);
    } catch (_error) {
      // Keep the original path for error reporting.
    }

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function contentBlockerConfig() {
  const config = readExtensionConfig();
  const blockerConfig = config.contentBlocker && typeof config.contentBlocker === "object"
    ? config.contentBlocker
    : {};
  return {
    enabled: blockerConfig.enabled !== false,
    allowHosts: Array.isArray(blockerConfig.allowHosts) ? blockerConfig.allowHosts : [],
    extraHosts: Array.isArray(blockerConfig.hosts) ? blockerConfig.hosts : [],
    listPaths: Array.isArray(blockerConfig.listPaths) ? blockerConfig.listPaths : []
  };
}

function uBlockAssetListPaths() {
  const extensionRoot = findInstalledExtensionPath(UBLOCK_ORIGIN_ID);
  if (!extensionRoot) {
    return [];
  }

  return UBLOCK_ASSET_RELATIVE_PATHS
    .map((relativePath) => path.join(extensionRoot, relativePath))
    .filter((filePath) => fs.existsSync(filePath));
}

function normalizeHost(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");
}

function hostFromFilterRule(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("!") || trimmed.startsWith("#") || trimmed.startsWith("@@")) {
    return "";
  }

  if (trimmed.includes("##") || trimmed.includes("#@#") || trimmed.includes("##+js") || trimmed.includes("#%#")) {
    return "";
  }

  const [pattern] = trimmed.split("$");
  if (!pattern.startsWith("||")) {
    return "";
  }

  const hostMatch = pattern.slice(2).match(/^([a-z0-9.-]+)(?:\^)?$/i);
  const host = hostMatch ? hostMatch[1] : "";
  if (!host || host.includes("*") || !host.includes(".")) {
    return "";
  }

  return normalizeHost(host);
}

function hostMatchesHostPattern(host, hostPattern) {
  return host === hostPattern || host.endsWith(`.${hostPattern}`);
}

function allowedContentBlockerHosts(config = contentBlockerConfig()) {
  return {
    exact: new Set([
      ...BUILT_IN_ALLOWED_EXACT_HOSTS,
      ...config.allowHosts
    ].map(normalizeHost).filter(Boolean)),
    suffixes: new Set(BUILT_IN_ALLOWED_HOST_SUFFIXES.map(normalizeHost).filter(Boolean))
  };
}

function isAllowedContentBlockerHost(host, allowedHosts = allowedContentBlockerHosts()) {
  const normalized = normalizeHost(host);
  if (!normalized) {
    return false;
  }

  if (allowedHosts.exact.has(normalized)) {
    return true;
  }

  return Array.from(allowedHosts.suffixes).some((allowedHost) => hostMatchesHostPattern(normalized, allowedHost));
}

function compileContentBlockerRules() {
  const config = contentBlockerConfig();
  if (!config.enabled) {
    return new Set();
  }

  const allowedHosts = allowedContentBlockerHosts(config);
  const hosts = new Set(
    BUILT_IN_BLOCKED_HOSTS
      .map(normalizeHost)
      .filter((host) => host && !isAllowedContentBlockerHost(host, allowedHosts))
  );
  for (const host of config.extraHosts) {
    const normalized = normalizeHost(host);
    if (normalized && !isAllowedContentBlockerHost(normalized, allowedHosts)) {
      hosts.add(normalized);
    }
  }

  const listPaths = [
    ...uBlockAssetListPaths(),
    ...config.listPaths
  ].filter(Boolean);

  for (const listPath of listPaths) {
    try {
      const lines = fs.readFileSync(listPath, "utf8").split(/\r?\n/);
      for (const line of lines) {
        const host = hostFromFilterRule(line);
        if (host && !isAllowedContentBlockerHost(host, allowedHosts)) {
          hosts.add(host);
        }
      }
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      contentBlockerErrors.push(`Could not read ${listPath}: ${message}`);
    }
  }

  return hosts;
}

function configureContentBlocker(targetSession) {
  contentBlockerErrors = [];
  const blockedHosts = compileContentBlockerRules();
  const blockedHostList = Array.from(blockedHosts);
  const allowedHosts = allowedContentBlockerHosts();
  contentBlockerRuleCount = blockedHosts.size;
  if (blockedHosts.size === 0) {
    return;
  }

  targetSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
    let cancel = false;
    try {
      const host = normalizeHost(new URL(details.url).hostname);
      cancel = !isAllowedContentBlockerHost(host, allowedHosts) &&
        blockedHostList.some((blockedHost) => hostMatchesHostPattern(host, blockedHost));
    } catch (_error) {
      cancel = false;
    }
    callback({ cancel });
  });

  console.log(`Content blocker loaded ${contentBlockerRuleCount} host rules from uBlock-compatible lists.`);
}

async function loadConfiguredExtensions() {
  loadedExtensions = [];
  extensionLoadErrors = [];

  const extensionApi = session.defaultSession.extensions || session.defaultSession;
  for (const entry of configuredExtensionPaths()) {
    const manifest = readManifest(entry.extensionPath);
    const label = manifest && manifest.name ? manifest.name : entry.name;

    if (!manifest) {
      extensionLoadErrors.push(`${label}: manifest.json was not found at ${entry.extensionPath}`);
      continue;
    }

    if (entry.id === UBLOCK_ORIGIN_ID || entry.extensionPath.includes(UBLOCK_ORIGIN_ID)) {
      console.log("Skipped uBlock Origin extension runtime; using local filter-list content blocker instead.");
      continue;
    }

    try {
      const loadPath = await preparedExtensionPath(entry, manifest);
      const extension = await extensionApi.loadExtension(loadPath, {
        allowFileAccess: false
      });
      loadedExtensions.push({
        id: extension.id,
        name: extension.name || label,
        path: loadPath,
        patched: loadPath !== entry.extensionPath,
        sourcePath: entry.extensionPath,
        version: manifest.version || ""
      });
      console.log(`Loaded extension: ${extension.name || label} (${extension.id})`);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      extensionLoadErrors.push(`${label}: ${message}`);
      console.warn(`Could not load extension ${label}: ${message}`);
    }
  }
}

function extensionStatusPayload() {
  return {
    contentBlocker: {
      errors: contentBlockerErrors,
      ruleCount: contentBlockerRuleCount
    },
    errors: extensionLoadErrors,
    loaded: loadedExtensions,
    supported: SUPPORTED_EXTENSIONS.map((extension) => ({
      id: extension.id,
      name: extension.name
    }))
  };
}

async function unloadLoadedExtensions() {
  const extensionApi = session.defaultSession.extensions || session.defaultSession;
  if (typeof extensionApi.removeExtension !== "function") {
    return;
  }

  for (const extension of loadedExtensions) {
    try {
      extensionApi.removeExtension(extension.id);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      extensionLoadErrors.push(`${extension.name}: could not unload before refresh: ${message}`);
    }
  }
}

async function reloadConfiguredExtensions() {
  await unloadLoadedExtensions();
  await loadConfiguredExtensions();
  createMenu();
  updateTrayMenu();
  return extensionStatusPayload();
}

async function refreshWritingToolsAfterAuth(reason = "manual-refresh") {
  await session.defaultSession.cookies.flushStore();
  const status = await reloadConfiguredExtensions();
  console.log(`Refreshed writing tools after ${reason}.`);

  if (mainWindow && !mainWindow.isDestroyed() && isGmailWebUrl(mainWindow.webContents.getURL())) {
    mainWindow.webContents.reloadIgnoringCache();
  }

  return status;
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
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
      spellcheck: true
    }
  });

  mainWindow.webContents.setUserAgent(userAgent);
  mainWindow.webContents.setWindowOpenHandler(handleWindowOpenForMainWindow);

  mainWindow.webContents.on("will-navigate", (event, url) => {
    noteGoogleAccountNavigation(url);
    if (isAppUrl(url) || url.startsWith("about:")) {
      return;
    }

    event.preventDefault();
    if (isGrammarlyUrl(url) || isSupportedExtensionUrl(url)) {
      openInternalBrowserUrl(url);
    } else if (isHttpUrl(url)) {
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
    injectAiAssistant();
    scheduleGoogleAccountRefresh(url);
    refreshGoogleAccounts().catch((_error) => {});
  });

  mainWindow.webContents.on("did-navigate-in-page", (_event, url) => {
    rememberGmailAccountFromUrl(url);
    injectAccountSwitcher();
    injectAiAssistant();
    scheduleGoogleAccountRefresh(url);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    const currentUrl = mainWindow.webContents.getURL();
    rememberGmailAccountFromUrl(currentUrl);
    injectAccountSwitcher();
    injectAiAssistant();
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

function showAiAssistant() {
  showMainWindow();
  injectAiAssistant({ show: true });
}

function showAiAssistantDebug() {
  if (isDevDebugAvailable()) {
    aiDebugEnabled = true;
    createMenu();
  }

  showAiAssistant();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
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

function aiProviderStatusLabel() {
  const { apiKey, model } = aiConfig();
  if (apiKey) {
    return `AI provider: OpenAI API (${model})`;
  }

  if (findCodexCliPath() && fs.existsSync(path.join(codexHomePath(), "auth.json"))) {
    return "AI provider: Codex CLI";
  }

  return "AI provider missing";
}

function createExtensionsMenu() {
  const loadedItems = loadedExtensions.length > 0
    ? loadedExtensions.map((extension) => ({
        enabled: false,
        label: `${extension.name}${extension.version ? ` ${extension.version}` : ""}`
      }))
    : [{
        enabled: false,
        label: "No extensions loaded"
      }];

  const errorItems = extensionLoadErrors.length > 0
    ? [
        { type: "separator" },
        ...extensionLoadErrors.map((message) => ({
          enabled: false,
          label: message.length > 68 ? `${message.slice(0, 65)}...` : message
        }))
      ]
    : [];

  return {
    label: "Extensions",
    submenu: [
      ...loadedItems,
      ...errorItems,
      { type: "separator" },
      {
        label: "Open Grammarly in Gmail Desk",
        click: openGrammarlyAccount
      },
      {
        label: "Refresh Writing Tools in Gmail",
        click() {
          refreshWritingToolsAfterAuth("extensions-menu-refresh").catch((error) => {
            console.error("Could not refresh writing tools:", error);
          });
        }
      },
      {
        label: "Open Extension Search Locations",
        click() {
          for (const root of configuredExtensionRoots()) {
            if (existingDirectory(root)) {
              shell.openPath(root);
              return;
            }
          }
        }
      }
    ]
  };
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
      label: "AI",
      submenu: [
        {
          enabled: false,
          label: aiProviderStatusLabel()
        },
        { type: "separator" },
        {
          label: "Show AI Reply Assist",
          accelerator: "CommandOrControl+Shift+I",
          click: showAiAssistant
        },
        {
          checked: isAiDebugEnabled(),
          enabled: isDevDebugAvailable(),
          label: "Debug AI Assist",
          type: "checkbox",
          click(menuItem) {
            aiDebugEnabled = Boolean(menuItem.checked);
            createMenu();
            if (aiDebugEnabled) {
              showAiAssistantDebug();
            }
          }
        },
        {
          label: "Open AI Config Folder",
          click() {
            shell.openPath(app.getPath("userData"));
          }
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
    createExtensionsMenu(),
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

function registerIpc() {
  ipcMain.handle("ai:analyzeEmail", async (_event, payload) => analyzeEmailWithAi(payload || {}));
  ipcMain.handle("ai:debugStatus", () => aiDebugStatus());
  ipcMain.handle("ai:setDebugEnabled", (_event, enabled) => {
    if (isDevDebugAvailable()) {
      aiDebugEnabled = Boolean(enabled);
      createMenu();
    }

    return aiDebugStatus();
  });
  ipcMain.handle("extensions:status", () => extensionStatusPayload());
  ipcMain.handle("extensions:openGrammarly", () => openGrammarlyAccount());
  ipcMain.handle("extensions:refreshWritingTools", () => refreshWritingToolsAfterAuth("manual-refresh"));
  ipcMain.handle("extension-shim:cookies.get", async (_event, _extensionId, details) => {
    const [cookie] = await session.defaultSession.cookies.get(cookieFilterFromDetails(details));
    return chromeCookieFromElectronCookie(cookie);
  });
  ipcMain.handle("extension-shim:cookies.getAll", async (_event, _extensionId, details) => {
    const cookies = await session.defaultSession.cookies.get(cookieFilterFromDetails(details));
    return cookies.map(chromeCookieFromElectronCookie);
  });
  ipcMain.handle("extension-shim:cookies.getAllCookieStores", () => [{
    id: "0",
    tabIds: []
  }]);
  ipcMain.handle("extension-shim:cookies.remove", async (_event, _extensionId, details = {}) => {
    if (!details.url || !details.name) {
      return null;
    }

    await session.defaultSession.cookies.remove(details.url, details.name);
    return {
      name: details.name,
      storeId: "0",
      url: details.url
    };
  });
  ipcMain.handle("extension-shim:cookies.set", async (_event, _extensionId, details = {}) => {
    const setDetails = cookieSetDetails(details);
    if (!setDetails.url || !setDetails.name) {
      return null;
    }

    await session.defaultSession.cookies.set(setDetails);
    const [cookie] = await session.defaultSession.cookies.get({
      name: setDetails.name,
      url: setDetails.url
    });
    return chromeCookieFromElectronCookie(cookie);
  });
  ipcMain.handle("extension-shim:windows.get", () => focusedWindowPayload());
  ipcMain.handle("extension-shim:windows.getAll", () => {
    const windows = BrowserWindow.getAllWindows()
      .filter((browserWindow) => !browserWindow.isDestroyed())
      .map((browserWindow) => {
        const bounds = browserWindow.getBounds();
        return {
          alwaysOnTop: browserWindow.isAlwaysOnTop(),
          focused: browserWindow.isFocused(),
          height: bounds.height,
          id: browserWindow.id,
          incognito: false,
          left: bounds.x,
          state: browserWindow.isMinimized() ? "minimized" : "normal",
          tabs: [],
          top: bounds.y,
          type: "normal",
          width: bounds.width
        };
      });
    return windows;
  });
  ipcMain.handle("extension-shim:windows.getCurrent", () => focusedWindowPayload());
  ipcMain.handle("extension-shim:windows.getLastFocused", () => focusedWindowPayload());
  ipcMain.handle("extension-shim:windows.update", () => focusedWindowPayload());
  ipcMain.handle("extension-shim:tabs.query", () => {
    const tab = activeTabPayload();
    return tab ? [tab] : [];
  });
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

  app.whenReady().then(async () => {
    activeAccountIndex = loadPreferredAccountIndex();

    const launchAccountIndex = gmailAccountIndexFromUrl(pendingOpenUrl);
    if (launchAccountIndex !== null) {
      activeAccountIndex = launchAccountIndex;
      savePreferredAccountIndex(activeAccountIndex);
    }

    setDockIcon();
    configureSession();
    registerIpc();
    await loadConfiguredExtensions();
    createMenu();
    createMainWindow(pendingOpenUrl || gmailUrl(activeAccountIndex));
    createTray();
    setTimeout(showMainWindow, 500);
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
    if (extensionShimServer) {
      extensionShimServer.close();
      extensionShimServer = null;
      extensionShimPort = 0;
    }
  });

  app.on("window-all-closed", () => {
    mainWindow = null;

    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
