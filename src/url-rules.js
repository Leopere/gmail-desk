const GMAIL_ACCOUNT_COUNT = 10;
const DEFAULT_ACCOUNT_INDEX = 0;

function normalizeAccountIndex(accountIndex) {
  const parsed = Number.parseInt(accountIndex, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_ACCOUNT_INDEX;
  }

  return Math.min(parsed, GMAIL_ACCOUNT_COUNT - 1);
}

function normalizeGmailRoute(route) {
  const normalized = String(route || "").trim().replace(/^#/, "");
  return normalized || "inbox";
}

function gmailUrl(accountIndex = DEFAULT_ACCOUNT_INDEX, route = "inbox") {
  const account = normalizeAccountIndex(accountIndex);
  return `https://mail.google.com/mail/u/${account}/#${normalizeGmailRoute(route)}`;
}

const START_URL = gmailUrl(DEFAULT_ACCOUNT_INDEX);

const APP_HOSTS = new Set([
  "accounts.google.com",
  "mail.google.com",
  "myaccount.google.com"
]);

function isHttpUrl(urlValue) {
  try {
    const url = new URL(urlValue);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function isAppUrl(urlValue) {
  try {
    const url = new URL(urlValue);
    const host = url.hostname.toLowerCase();

    return APP_HOSTS.has(host);
  } catch (_error) {
    return false;
  }
}

function findLaunchUrl(argv) {
  return argv.find((arg) => isHttpUrl(arg) && isAppUrl(arg)) || "";
}

function gmailAccountIndexFromUrl(urlValue) {
  try {
    const url = new URL(urlValue);
    const match = url.pathname.match(/^\/mail\/u\/(\d+)(?:\/|$)/);
    return match ? normalizeAccountIndex(match[1]) : null;
  } catch (_error) {
    return null;
  }
}

function withGmailAccount(urlValue, accountIndex) {
  const normalizedIndex = normalizeAccountIndex(accountIndex);

  try {
    const url = new URL(urlValue || START_URL);
    if (url.hostname.toLowerCase() !== "mail.google.com") {
      return gmailUrl(normalizedIndex);
    }

    if (url.pathname.match(/^\/mail\/u\/\d+(?:\/|$)/)) {
      url.pathname = url.pathname.replace(/^\/mail\/u\/\d+/, `/mail/u/${normalizedIndex}`);
      if (!url.hash && !url.search) {
        url.hash = "#inbox";
      }
      return url.toString();
    }

    if (url.pathname === "/mail" || url.pathname.startsWith("/mail/")) {
      url.pathname = `/mail/u/${normalizedIndex}/`;
      if (!url.hash && !url.search) {
        url.hash = "#inbox";
      }
      return url.toString();
    }
  } catch (_error) {
    // Fall through to the default account URL.
  }

  return gmailUrl(normalizedIndex);
}

module.exports = {
  GMAIL_ACCOUNT_COUNT,
  START_URL,
  findLaunchUrl,
  gmailAccountIndexFromUrl,
  gmailUrl,
  isAppUrl,
  isHttpUrl,
  normalizeAccountIndex,
  withGmailAccount
};
