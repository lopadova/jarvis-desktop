#!/usr/bin/env node
/**
 * Prints a Tauri config overlay that signs every Windows binary (app, sidecar, installers) with
 * Azure Trusted Signing via `trusted-signing-cli`. Values come from env (CI secrets); nothing is committed.
 * The command is an argv array (no shell string): Tauri substitutes %1 with the file to sign.
 */
const { AZURE_TS_ENDPOINT: endpoint, AZURE_TS_ACCOUNT: account, AZURE_TS_PROFILE: profile } = process.env;
if (!endpoint || !account || !profile) {
  console.error('AZURE_TS_ENDPOINT, AZURE_TS_ACCOUNT and AZURE_TS_PROFILE are required');
  process.exit(1);
}
if (!/^https:\/\/[a-z0-9.-]+\.codesigning\.azure\.net\/?$/i.test(endpoint)) {
  console.error('AZURE_TS_ENDPOINT must look like https://<region>.codesigning.azure.net');
  process.exit(1);
}
const overlay = {
  bundle: {
    windows: {
      signCommand: {
        cmd: 'trusted-signing-cli',
        args: ['-e', endpoint, '-a', account, '-c', profile, '-d', 'Jarvis', '%1'],
      },
    },
  },
};
process.stdout.write(`${JSON.stringify(overlay, null, 2)}\n`);
