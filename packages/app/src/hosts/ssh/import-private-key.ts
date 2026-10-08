/** Key import is owned by Android; desktop uses the user's OpenSSH installation. */
export async function importPrivateKey(): Promise<{ name: string; text: string } | null> {
  throw new Error("SSH key import is only available on Android.");
}
