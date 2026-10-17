import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { DeliveredAgentToast } from "./viewed-agent-notifications.js";

interface WindowsToastHistoryOwner {
  executable: string;
  isPackagedFork: boolean;
}

interface WindowsToastHistoryOperation {
  operation: "list" | "remove";
  toasts: DeliveredAgentToast[];
}

const execFileAsync = promisify(execFile);
const historySchema = z.array(
  z.object({ tag: z.string(), group: z.string(), arguments: z.string() }),
);

// This is static code, not an interpolation target for provider-controlled text.
// Electron 44.5.1 derives its toast identity from PE ProductName when no explicit
// process AUMID was set. Its EnsureShortcut verifies the product-name shortcut
// against that identity. NSIS's configured appId alone does not prove toast ownership.
const script = String.raw`
$ErrorActionPreference = 'Stop'
$inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
$exe = [IO.Path]::GetFullPath($inputData.executable)
$product = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe).ProductName
if ($product -ne 'Paseo++') { throw 'Only the packaged Paseo++ fork identity may inspect toast history' }
$expectedId = 'electron.app.' + $product
$linkPath = Join-Path ([Environment]::GetFolderPath('StartMenu')) ('Programs\' + $product + '.lnk')
$wsh = New-Object -ComObject WScript.Shell
$link = $wsh.CreateShortcut($linkPath)
$stub = Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($exe))) ([IO.Path]::GetFileName($exe))
$ownsShortcut = ($link.TargetPath -eq $exe) -or ((Test-Path $stub) -and ($link.TargetPath -eq $stub))
if (-not $ownsShortcut) { throw 'Cannot verify the notification shortcut belongs to this executable' }
$shell = New-Object -ComObject Shell.Application
$item = $shell.NameSpace([IO.Path]::GetDirectoryName($linkPath)).ParseName([IO.Path]::GetFileName($linkPath))
$appId = $item.ExtendedProperty('System.AppUserModel.ID')
if ($appId -ne $expectedId) { throw 'Notification AUMID differs from the audited Electron fallback; history left untouched' }
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$history = [Windows.UI.Notifications.ToastNotificationManager]::History
if ($inputData.operation -eq 'list') {
  $entries = @($history.GetHistory($appId) | ForEach-Object {
    [PSCustomObject]@{ tag = $_.Tag; group = $_.Group; arguments = $_.Content.DocumentElement.GetAttribute('launch') }
  })
  ConvertTo-Json -InputObject $entries -Compress -Depth 4
} elseif ($inputData.operation -eq 'remove') {
  foreach ($toast in $inputData.toasts) {
    if ([string]::IsNullOrEmpty($toast.tag)) { throw 'A toast tag is required' }
    $history.Remove([string]$toast.tag, [string]$toast.group, [string]$appId)
  }
} else { throw 'Unsupported toast operation' }
`;

/** Inspect only the executable-owned, verified fork shortcut; never change the process AUMID. */
export function createWindowsToastHistory(owner: WindowsToastHistoryOwner) {
  async function run(request: WindowsToastHistoryOperation): Promise<string> {
    if (!owner.isPackagedFork)
      throw new Error("Durable notification history requires the packaged fork identity");
    const child = execFileAsync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    child.child.stdin?.end(
      JSON.stringify({
        executable: owner.executable,
        operation: request.operation,
        toasts: request.toasts,
      }),
    );
    const { stdout } = await child;
    return stdout.replace(/^\uFEFF/, "").trim();
  }
  return {
    async list(): Promise<DeliveredAgentToast[]> {
      return historySchema.parse(JSON.parse(await run({ operation: "list", toasts: [] })));
    },
    async remove(toasts: DeliveredAgentToast[]): Promise<void> {
      await run({ operation: "remove", toasts });
    },
  };
}
