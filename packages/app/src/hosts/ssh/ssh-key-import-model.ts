import { createRemoteSshHostConnection } from "@/types/host-connection";

export interface SshImportTarget {
  host: string;
  sshPort?: number;
  daemonPort?: number;
}
export interface SshKeyImportBridge {
  inspect(target: SshImportTarget, privateKey: string, passphrase: string): Promise<string>;
  stage(
    id: string,
    target: SshImportTarget,
    privateKey: string,
    passphrase: string,
    fingerprint: string,
  ): Promise<void>;
  commit(id: string): Promise<void>;
  discard(id: string): Promise<void>;
}

export interface ApprovedSshKey {
  target: SshImportTarget;
  privateKey: string;
  passphrase: string;
  fingerprint: string;
}

/** Stage approved credentials for the probe, commit before saving, and discard failed imports. */
export async function saveImportedSshHost<T>(
  bridge: SshKeyImportBridge,
  approved: ApprovedSshKey,
  saveHost: (beforeSave: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const id = createRemoteSshHostConnection(approved.target).id;
  await bridge.stage(
    id,
    approved.target,
    approved.privateKey,
    approved.passphrase,
    approved.fingerprint,
  );
  try {
    return await saveHost(() => bridge.commit(id));
  } finally {
    await bridge.discard(id);
  }
}
