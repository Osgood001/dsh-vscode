# DeepSeek Harness Sidebar

Run your locally installed DeepSeek Harness (`dsh`) inside a VS Code activity-bar sidebar.

This is an independent VS Code integration. It does not bundle DeepSeek Harness or provide an API subscription.

## Requirements

- VS Code 1.80 or newer on a desktop extension host.
- A separately installed `dsh` executable with a working web-serving profile.
- A trusted workspace. The extension starts a local process with your user permissions.

## Use

1. Install the extension and open a trusted workspace.
2. Select **DeepSeek Harness** in the activity bar.
3. If automatic executable detection fails, set `dsh.path` to the full executable path.

Use **DSH: Focus Sidebar** (`Cmd+Alt+D` on macOS, `Ctrl+Alt+D` elsewhere), **DSH: Restart Server**, or **DSH: Open in Browser** from the command palette.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `dsh.path` | empty | Executable path; otherwise checks common installation paths and PATH. |
| `dsh.profile` | `web` | Web-serving profile to start. |
| `dsh.extraArgs` | `[]` | Additional arguments passed directly to `dsh`. |

The process starts in the first workspace folder, or your home directory when no folder is open. Closing the extension host stops the process.

## Privacy and local access

The extension has no telemetry and makes no direct model API requests. DeepSeek Harness manages its own providers, credentials, and network traffic. The sidebar uses a loopback proxy with a random bootstrap URL and an HttpOnly session cookie. Harness authentication tokens are redacted from extension output. Treat bootstrap and browser URLs as private.

The embedded view requires loopback cookies. If your VS Code environment blocks them, use **DSH: Open in Browser**. Remote SSH, containers, Windows, and browser-based VS Code have not been verified.

## Development

```sh
npm ci
npm test
npm run package
```

Install the resulting `.vsix` with VS Code's **Extensions: Install from VSIX** command.

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Free noncommercial use, modification, and redistribution under its terms. Preserve the author and license attribution in [NOTICE](NOTICE). Commercial use outside its permitted purposes requires prior written permission from [Osgood001](https://github.com/Osgood001).

The Marketplace publisher ID is provisional until registration completes.
