# Code signing (maintainers)

Unsigned builds work, but Windows SmartScreen/Smart App Control and macOS Gatekeeper warn about them, and some machines refuse to run them. Signing is **opt-in** in `.github/workflows/release.yml`. Each platform turns on as soon as its secrets exist, and without them the release is built unsigned.

> A self-signed certificate does **not** help: Windows and macOS only trust certificates issued by a recognised authority (or by Microsoft/Apple themselves).

## Windows — Azure Trusted Signing (recommended)

Microsoft's managed signing service: about **$10/month**, no hardware token, and the certificate is trusted by SmartScreen and Smart App Control.

1. Create an Azure account and a **Trusted Signing account** in a supported region (e.g. West Europe → endpoint `https://weu.codesigning.azure.net`).
2. Complete **identity validation** (individual developers are supported in many countries, including the EU). It can take a few days.
3. Create a **certificate profile** of type *Public Trust*.
4. Create an **app registration** (service principal) and give it the role *Trusted Signing Certificate Profile Signer* on the account.
5. Add these **repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `AZURE_TRUSTED_SIGNING_ENDPOINT` | e.g. `https://weu.codesigning.azure.net` |
| `AZURE_TRUSTED_SIGNING_ACCOUNT` | Trusted Signing account name |
| `AZURE_TRUSTED_SIGNING_PROFILE` | certificate profile name |
| `AZURE_CLIENT_ID` | app registration (client) ID |
| `AZURE_CLIENT_SECRET` | a client secret of that app registration |
| `AZURE_TENANT_ID` | your Entra ID tenant ID |

On the next tagged release, the Windows job installs `trusted-signing-cli`, then writes a Tauri config overlay with `scripts/signing/windows-sign-config.mjs` (a `bundle.windows.signCommand` built as an argument array). Tauri then signs the app, the sidecar and the installers.

**Alternative:** an OV/EV code-signing certificate from a commercial CA (about $200–400/year, usually on a hardware token or a cloud HSM). Put its signing tool in `signCommand` the same way.

## macOS — Developer ID + notarisation

1. Join the **Apple Developer Program** ($99/year).
2. Create a **Developer ID Application** certificate and export it as `.p12` with a password.
3. Create an **app-specific password** for your Apple ID (appleid.apple.com).
4. Add the secrets:

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | the `.p12` file, base64-encoded (`base64 -i cert.p12`) |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | your Apple ID e-mail |
| `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password |
| `APPLE_TEAM_ID` | your 10-character team ID |

The Tauri bundler signs the app and the sidecar, then submits the build for notarisation and staples the ticket.

## Updater key (both platforms)

Auto-updates need their own **minisign** key, independent from code signing. Generate it with `pnpm --filter @jarvis/desktop tauri signer generate`. Then:
- put the public key in `plugins.updater.pubkey` (`apps/desktop/src-tauri/tauri.conf.json`);
- add the private key as the secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`;
- set `bundle.createUpdaterArtifacts` to `true`.

## Testing unsigned builds locally

If your own machine blocks fresh unsigned binaries (Smart App Control), use the scripts in `scripts/`:
- `node scripts/windows-xbuild/build-windows.mjs` builds `dist-windows/` from Docker, using `cargo-xwin`. That tool downloads Microsoft's CRT/SDK, which means accepting Microsoft's licence terms.
- `powershell -File scripts/sandbox/start-sandbox.ps1` runs that build inside **Windows Sandbox** and collects the self-test output, logs and screenshots in `dist-sandbox/`.
