# Gmail Desk

Electron desktop app and macOS helper for keeping multiple Gmail accounts in one predictable window.

## What It Does

- Opens Gmail in its own desktop app window.
- Keeps a separate Electron profile at `~/Library/Application Support/Gmail Desk`.
- Adds macOS app and menu bar controls for Gmail routes and Google account switching.
- Switches between signed-in Gmail accounts in the same window without opening extra browser windows.
- Adds an in-window account rail over Gmail so account slots stay visible.
- Uses Gmail and Google sign-in directly. No Gmail API credentials are required.

## Run

Install dependencies:

```sh
npm install
```

Run the app:

```sh
npm start
```

## Commands

```sh
npm run build
npm run check
npm run verify
npm run package
npm run install:mac
```

`npm run build` generates local app icons and the menu bar template icon.

## Menu Bar Behavior

Closing the main Gmail window hides it to the macOS menu bar instead of quitting the app. `Command+W` and the default `Command+Q` app shortcut also close to the menu bar. Restore it from the Gmail Desk menu bar item with a click, double-click, or `Show Gmail Desk`.

Use `Quit Gmail Desk` from the menu bar menu, or `Command+Shift+Q` from the app menu, when you want to exit the app completely.

## Account Switching

Use the in-window account switcher, the `Accounts` menu, or the menu bar item to switch between signed-in Google accounts in the same Gmail pane.

The native account menus use the account name/email from the Electron Google session when Google exposes it. If account labels are not available yet, Gmail Desk falls back to numbered account slots 1-10 and learns labels as accounts load.

Keyboard shortcuts:

```text
Command+Option+1..9  Switch to Google account slot 1..9
Command+Option+Left  Previous account
Command+Option+Right Next account
Command+Option+A     Add another Google account in the same pane
```

The selected account is saved and used when the app reopens. Switching preserves the current Gmail route when possible.

After Google's add-account flow completes, Gmail Desk refreshes the Gmail renderer so the new account is available without relaunching the app. If Google leaves Gmail in a stale state, use `Accounts > Refresh Account State`.

## Mail Shortcuts

The `Mail` menu includes direct routes for Inbox, Unread, Starred, Snoozed, Sent, Drafts, Search Mail, and Compose Mail.

## AI Reply Assist

Gmail Desk includes an optional local AI reply-assist popover. Open an email and click `AI Reply Assist`, or use `AI > Show AI Reply Assist`. The popover auto-assesses a newly presented email when opened.

What it does:

- Reads the currently open Gmail message or selected email text.
- First suggests short sender-intent tokens and likely response intent options.
- Then asks for your direction before drafting.
- Classifies whether the email is a simple ask, needs clarification, likely needs no reply, or warrants a handwritten reply.
- Suggests response strategy, reply-all guidance, watch-outs, and copyable draft text after you give direction.
- Can copy a suggestion, insert it into a focused Gmail draft body, or explicitly open reply/reply-all and preload the draft.

What it does not do:

- It never sends mail.
- It never clicks Gmail send controls.
- It never drafts from an assumed user intention without asking for your direction first.
- It never exposes your OpenAI/Codex auth token to Gmail page JavaScript.

AI credentials are read by the Electron main process from, in order:

```text
OPENAI_API_KEY
~/Library/Application Support/Gmail Desk/ai.json
~/Library/Application Support/Gmail Desk/Codex/auth.json
~/.codex/auth.json
```

Codex ChatGPT access tokens are not used as OpenAI API keys. If no API key is available, Gmail Desk falls back to the local `codex exec` CLI when it can find Codex and `~/Library/Application Support/Gmail Desk/Codex/auth.json`.

Do not commit or package personal Codex auth. The packaged app reads local auth from the user's app-support folder at runtime.

Set a custom Codex binary path if needed:

```sh
GMAIL_DESK_CODEX_CLI_PATH="/absolute/path/to/codex"
```

`ai.json` can set a model without storing a key:

```json
{
  "apiKey": "sk-...",
  "model": "gpt-5.5"
}
```

AI debug tracing is off by default. In development, run `npm run start:debug`, or launch with `GMAIL_DESK_AI_DEBUG=1` or `GMAIL_DESK_DEV_MODE=1`, to enable the `AI > Debug AI Assist` menu item and the popover debug toggle. Debug output is sanitized: it logs modes, providers, counts, and text lengths, not raw email bodies, subjects, senders, or draft text.

## Extensions

Gmail Desk can load local unpacked Chrome extensions at startup. This is experimental and disabled by default. It knows the extension ID for:

- Grammarly: `kbfnbcaeplbcioakkpcpgfkobkghlhen`

When enabled, macOS auto-detection looks in common Arc, Chrome, Chrome Beta, Chrome Canary, Brave, and Edge profile extension folders. The app does not download or redistribute third-party extension code.

Enable auto-detection or provide exact extension paths with environment variables:

```sh
GMAIL_DESK_ENABLE_GRAMMARLY=1
GMAIL_DESK_ENABLE_EXTENSIONS=1

GMAIL_DESK_GRAMMARLY_PATH="/absolute/path/to/kbfnbcaeplbcioakkpcpgfkobkghlhen/version"
GMAIL_DESK_EXTENSION_PATHS="/absolute/path/to/extension-a:/absolute/path/to/extension-b"
GMAIL_DESK_EXTENSION_SEARCH_ROOTS="/absolute/path/to/Browser/Profile/Extensions"
```

For packaged app launches, use:

`~/Library/Application Support/Gmail Desk/extensions.json`

```json
{
  "grammarly": {
    "enabled": true,
    "patch": true
  },
  "contentBlocker": {
    "enabled": true,
    "allowHosts": [],
    "hosts": [],
    "listPaths": []
  },
  "paths": [],
  "searchRoots": []
}
```

Per-extension objects can also specify exact paths:

```json
{
  "grammarly": {
    "enabled": true,
    "patch": true,
    "path": "/absolute/path/to/kbfnbcaeplbcioakkpcpgfkobkghlhen/version"
  }
}
```

Electron supports only unpacked extension directories and not every Chrome extension API. Gmail Desk's Grammarly path uses a generated local patched copy in `~/Library/Application Support/Gmail Desk/Patched Extensions` with a narrow shim for the Chrome APIs Grammarly needs in Gmail. The source extension is still read from the user's local browser profile; the app does not download, commit, package, or redistribute Grammarly.

Check `Extensions` in the app menu after launch to see what loaded. The AI Reply popover shows compact Grammarly status because Electron does not show Chrome-style extension toolbar icons. Grammarly sign-in and account pages are kept inside Gmail Desk-owned Electron windows instead of opening the system browser.

Gmail Desk does not load the uBlock Origin extension runtime. Loading uBlock itself caused Electron instability locally, so the app instead installs a lightweight network blocker at the Electron session level. When it can find a local uBlock Origin install, it reads conservative host rules from the packaged uBlock assets, EasyList, EasyPrivacy, and URLHaus filter files. Gmail, Google auth, Grammarly, and core Google asset/API hosts are allowlisted so broad filter-list rules do not break sign-in or writing assistance. You can add extra host rules, exact allowlist hosts, or local filter-list files with `contentBlocker.hosts`, `contentBlocker.allowHosts`, and `contentBlocker.listPaths`. This blocker is intentionally quiet and is not shown in the Reply Assist overlay.

After signing in to Grammarly locally, close the Grammarly window or click `Refresh in Gmail` in the AI Reply popover. Gmail Desk flushes local session cookies, reloads unpacked writing extensions, clears the cached extension service-worker scripts, and refreshes the Gmail window. Personal Grammarly cookies remain in the local Electron session and are not stored in the repo or packaged release.

The fixed `Grammarly` button in Gmail is only a fallback utility. Inline Grammarly in Gmail is the target behavior when the patched extension is enabled and loaded. The fallback actions are:

- The fixed `Grammarly` button in Gmail opens `https://app.grammarly.com/` inside Gmail Desk.
- `Open Grammarly` in the AI Reply popover opens the same editor.
- `Copy draft to Grammarly` copies the focused Gmail draft and opens the Grammarly editor.
- `Paste checked text` inserts clipboard text back into the focused Gmail draft for review.
- Extension-triggered third-party popups are blocked so Grammarly background scripts cannot open ad/tracking pages in the default browser.

Known local test results with Electron 42:

- Grammarly loads from the generated patched copy when `patch` is enabled in local config or `GMAIL_DESK_PATCH_GRAMMARLY=1` is set.
- The patched copy keeps Grammarly's stable extension ID so local extension storage and session state can line up with the Gmail content script.
- Gmail Desk clears the service-worker script cache before loading the patched copy so the worker does not reuse stale loopback auth-bridge tokens.
- The runtime smoke test confirmed the loaded Grammarly extension could see local Grammarly auth cookie presence through the Electron session bridge without printing cookie values.
- uBlock Origin's extension runtime is not loaded. Gmail Desk reads uBlock-compatible filter list assets directly and applies host-level blocking through Electron `webRequest`.

## Install

Package and install to `/Applications/Gmail Desk.app`:

```sh
./scripts/install.sh
open "/Applications/Gmail Desk.app"
```

Install somewhere else:

```sh
./scripts/install.sh "$HOME/Applications/Gmail Desk.app"
```

## Data Locations

- Electron profile: `~/Library/Application Support/Gmail Desk`
- Local dev env file, if needed: `.env`

## Notes

Website sign-in happens inside the Electron Gmail window. This app intentionally does not use the Gmail API, so there are no OAuth client JSON files or stored API tokens to manage.
