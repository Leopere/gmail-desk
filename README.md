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
