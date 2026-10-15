# Send-to-anything: Chromium Extension & Host Bridge

Send, rewrite, summarize, or pipe any web text, drafts, and selections to any local command, shell pipeline, or integrated web AI plugin (`gemini_web`, `jq`, `tee`, `gemini` CLI, etc.) with zero external runtime dependencies (no Python or Node required).

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Page Input / Selection                          │
│        (Active form field, highlighted text, or whole page)            │
│  * If no field is active, interactive Target Picker lets you click it  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       Send-to-anything Router                          │
│                                                                        │
│  1. Engine Selection:                                                  │
│     ├── 💻 Host Bridge: Spawns local CLI / binaries / scripts          │
│     └── 🌐 Web Plugins: Integrated adapters (e.g. Gemini Web)         │
│                                                                        │
│  2. Workflow Mode:                                                     │
│     ├── ➔ One-way (Fire-and-forget): Send only without waiting         │
│     └── ⇄ Two-way: Waits for return data                               │
│                                                                        │
│  3. Return Data Format (When Two-way):                                 │
│     ├── 📄 Plain: As-is raw output                                     │
│     └── ✨ Custom Template: Wraps output (e.g. `> {{output}}`)         │
│                                                                        │
│  4. Output Destination (When Two-way):                                 │
│     ├── 📝 Replace In-place (Native undo Ctrl+Z preserved)             │
│     ├── 💬 Floating Panel (Sidecar & [ ] Fullscreen toggle)            │
│     └── 📋 Copy to Clipboard                                           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Features

- **Generic Engine Architecture**:
  - **Host Bridge (Local CLI / Scripts)**: Run any local binary, shell pipeline, or CLI tool via a secure, compiled Go native messaging host.
  - **Integrated Web Plugins**: Automates web interfaces (e.g. Google Gemini Web at `gemini.google.com/app` using your active browser session without API keys).
- **Flexible Workflow Modes**:
  - **Two-way (Request & Response)**: Sends text, waits for output, and routes the result.
  - **One-way (Send Only / Fire-and-Forget)**: Dispatches data to commands or plugins (e.g. logging to a local file with `tee`, appending to notes, or sending a prompt to an open chat) and immediately notifies you without blocking.
- **Configurable Output Formats**:
  - **Plain Text (As-is)**: Exact output returned from the command or plugin.
  - **Custom Template**: Format output with custom wrappers, markdown blockquotes, comments, or prefixes using `{{output}}`.
- **Multiple Output Destinations**:
  - **In-Place Replacement**: Replaces form fields (`textarea`, `input`, or rich-text `contenteditable` like Gmail, Slack, and GitHub) preserving `Ctrl+Z` undo and newline formatting.
  - **Floating Panel (Sidecar & Fullscreen)**: Scrollable, dark-themed overlay with `[ ]` full-page toggle and Markdown rendering.
  - **Clipboard**: Silently copies to clipboard with a brief toast notification.
- **Interactive Target Picker**: If an action needs a form field or destination, but none is currently active, a banner appears and editable fields light up on hover—just click the field you want!
- **Prompt Templating with `%%actual_text%%`**: Position `%%actual_text%%` (or `{{text}}`) anywhere inside your prompt instruction or CLI arguments.
- **Compiled Go Native Host**: Fast, single binary with zero external runtime dependencies.
- **Multi-OS Privilege Dropping (`privdrop`) & Security**:
  - **Linux**: Sets `PR_SET_NO_NEW_PRIVS` across all Go threads so child processes cannot escalate privileges; uses `PR_SET_PDEATHSIG` (`SIGKILL`) so background processes terminate immediately when the browser closes; enforces process group isolation.
  - **OpenBSD**: Implements `pledge(2)` (`stdio rpath proc exec`) and `unveil(2)` restrictions.
  - **No Shell Wrapper**: Direct process execution without `/bin/sh -c`, preventing command and shell injection.
  - **Safe Stdio Streaming**: Passes untrusted web text via `stdin` by default.

---

## Project Structure

```
.
├── mise.toml                    # Toolchain and task manager configuration
├── cmd/
│   └── send-to-anything-host-bridge/ # Go native messaging host bridge
│       ├── main.go              # CLI flags, test runner, stdio message loop
│       ├── protocol.go          # Chromium 32-bit LE length-prefixed JSON framing
│       ├── runner.go            # Safe process executor (stdin, args, timeouts)
│       ├── privdrop_linux.go    # Linux NoNewPrivs & Pdeathsig sandboxing
│       ├── privdrop_openbsd.go  # OpenBSD pledge & unveil integration
│       ├── privdrop_other.go    # Portable POSIX fallbacks
│       ├── install.go           # Automatic host manifest installer
│       └── runner_test.go       # Comprehensive unit tests
├── extension/                   # Chromium Extension (Manifest V3)
│   ├── manifest.json            # Extension manifest with permissions & commands
│   ├── background.js            # Service worker (shortcuts, menus, native messaging)
│   ├── content.js               # Form detection, in-place replacer, floating panel
│   ├── content.css              # Styling for status toasts, panel & target picker
│   ├── gemini_bridge.js         # Web plugin content script for gemini.google.com
│   ├── popup.html / popup.js    # Quick command palette
│   ├── options.html / options.js# Profile management & setup UI
│   └── icons/                   # Extension icons (16, 48, 128)
├── bin/                         # Compiled Go binary
├── LICENSE.md                   # MIT License
└── README.md
```

---

## Quickstart & Installation

### 1. Build & Install the Host Bridge
Ensure [mise](https://mise.jdx.dev/) or Go is installed.

```bash
# Build the native messaging host binary
mise run build

# Install send-to-anything-host-bridge into your PATH (GOBIN)
mise run install   # or: go install ./cmd/send-to-anything-host-bridge

# Run unit tests
mise run test
```

### 2. Load the Extension into Chromium / Chrome / Brave
1. Open Chromium or Google Chrome and navigate to `chrome://extensions/`.
2. Toggle **Developer mode** (top-right corner).
3. Click **Load unpacked** (top-left corner).
4. Select the `extension/` folder in this repository.
5. Copy the generated **Extension ID** (e.g. `nfcfiojgldklhcnpnafndhhbpmkaeofa`).

### 3. Register the Native Messaging Host Bridge
Register the host manifest so Chromium allows communication with your local Go binary:

```bash
# Register for Chromium (default)
send-to-anything-host-bridge -install -extension-id <YOUR_EXTENSION_ID>

# Or for Google Chrome
send-to-anything-host-bridge -install -browser chrome -extension-id <YOUR_EXTENSION_ID>

# Or for Brave
send-to-anything-host-bridge -install -browser brave -extension-id <YOUR_EXTENSION_ID>
```

### 4. Verify & Configure
1. Open the extension's **Options Page** (right-click the extension icon -> *Options*).
2. Click **Test Gemini Web Session** and **Test CLI Host Bridge** to verify both backends.
3. Review and customize default profiles or add new ones.
4. Customize key shortcuts at `chrome://extensions/shortcuts`.

---

## Example Profiles

### 1. Gemini Web: Rewrite In-place (Two-way, Web Plugin)
- **Engine**: `Plugin: Google Gemini Web`
- **Workflow**: `Two-way (Wait for result and output)`
- **Output Action**: `Replace in-place`
- **Instruction**:
  ```text
  Rewrite the following text concisely and professionally. Correct spelling and grammar, improve clarity, and preserve all meaning and factual details:

  %%actual_text%%

  Return ONLY the rewritten text without greetings, conversational filler, or explanations.
  ```
- **Shortcut**: `Alt+Shift+E`

### 2. Gemini Web: Summarize to Panel (Two-way, Web Plugin)
- **Engine**: `Plugin: Google Gemini Web`
- **Workflow**: `Two-way (Wait for result and output)`
- **Output Action**: `Floating Panel`
- **Instruction**:
  ```text
  Summarize the following discussion into bullet points, key decisions, and open questions:

  %%actual_text%%

  Return ONLY the summary without introductory remarks.
  ```
- **Shortcut**: `Alt+Shift+S`

### 3. Send to Gemini Web (One-way / Fire-and-forget)
- **Engine**: `Plugin: Google Gemini Web`
- **Workflow**: `One-way (Send only / Fire-and-forget)`
- **Instruction**:
  ```text
  Please analyze the following text:

  %%actual_text%%
  ```

### 4. CLI: JQ Format (Two-way, Host Bridge)
- **Engine**: `Host Bridge: Local Command / Script`
- **Workflow**: `Two-way`
- **Command**: `jq`
- **Input Delivery**: `Both stdin and argument`
- **Arguments**: `.`
- **Output Action**: `Replace in-place`
- **Shortcut**: `Alt+Shift+D`

### 5. CLI: Log Selection to Local File (One-way, Host Bridge)
- **Engine**: `Host Bridge: Local Command / Script`
- **Workflow**: `One-way (Send only)`
- **Command**: `tee`
- **Input Delivery**: `Both stdin and argument`
- **Arguments**: `-a ~/send-to-anything.log`

---

## Troubleshooting Guide

### 1. "The message port closed before a response was received"
- **Cause**: In Chromium Manifest V3, message channels between extension pages and service workers can close if a background operation takes too long or encounters an unhandled rejection.
- **Fix**: The latest version uses direct tab querying and modern `await chrome.tabs.sendMessage` wrapped in `try / catch` blocks. If you see this error, ensure you have clicked the circular **Reload (🔄)** button on the Text Proxy / Send-to-anything card in `chrome://extensions/` and refreshed the Options tab (`Ctrl+R`).

### 2. "Specified native messaging host not found"
- **Cause**: Chromium cannot find the JSON manifest in `~/.config/chromium/NativeMessagingHosts/` or the manifest contains invalid JSON (such as a missing comma).
- **Fix**: Run:
  ```bash
  mise run install-host -- -extension-id <YOUR_EXTENSION_ID>
  ```
  Check the generated file syntax:
  ```bash
  python3 -m json.tool ~/.config/chromium/NativeMessagingHosts/com.send.to.anything.json
  ```

### 3. "Cannot create item with duplicate id"
- **Cause**: A race condition during initial extension loading where `onInstalled` and `storage.onChanged` both attempt to register context menus simultaneously.
- **Fix**: This is handled with a mutex in `background.js`. Click **Clear all** on the Errors page in `chrome://extensions/` and reload the extension.

### 4. CLI Tool Not Found in $PATH (`exec: "tool": executable file not found in $PATH`)
- **Cause**: When Chromium is launched from a desktop environment (GNOME, desktop launcher, systemd user session), its environment only receives a minimal system `PATH` (such as `/usr/bin:/bin`). It does not source interactive shell profiles (`~/.bashrc`, `mise activate`).
- **Fix**: The Go host bridge (`runner.go`) automatically enriches its lookup `PATH` on startup by adding:
  - `~/.local/share/mise/shims` *(all mise-managed CLI tools)*
  - `~/.local/bin`
  - `~/bin`
  - `~/.cargo/bin`
  - `~/go/bin`
  - `/usr/local/bin`
  If you install a new tool via mise, ensure shims are rehashed (`mise reshim`).

### 5. Gemini Web: "Please provide the text you would like rewritten"
- **Cause**: Multi-paragraph text with newlines was previously truncated by single-line DOM `insertText` commands.
- **Fix**: The bridge uses synthetic `ClipboardEvent('paste')` carrying full multiline text and explicit `[Draft to rewrite]` sections.

### 6. Inspecting Browser Logs (DevTools)
- **Options Page Console**: Press `F12` on the Options page -> switch to **Console**.
- **Service Worker Console**: Go to `chrome://extensions/` -> click the blue **service worker** link on the card.
- **Extension Errors**: Go to `chrome://extensions/` -> check if a red **Errors** button appears on the card.

---

## Development & mise Tasks

| Command | Description |
| :--- | :--- |
| `mise run build` | Builds `bin/send-to-anything-host-bridge` with stripped symbols (`-s -w`) |
| `mise run install` | Installs `send-to-anything-host-bridge` into your GOBIN / PATH |
| `mise run test` | Runs all unit and integration tests |
| `mise run clean` | Cleans up build artifacts in `bin/` |

---

## License

MIT License. See [LICENSE.md](LICENSE.md) for details.
