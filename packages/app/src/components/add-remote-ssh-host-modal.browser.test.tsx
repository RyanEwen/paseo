import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { within } from "@testing-library/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n as testI18n } from "@/i18n/i18next";
import { RemoteSshHostForm } from "./remote-ssh-host-form";

void testI18n;
// The browser cannot execute Android Keystore or the native picker. Keep those boundaries
// injectable here; the real form, editing primitives, and approval interaction run in Chromium.
const native = vi.hoisted(() => ({
  inspect: vi.fn(),
  stage: vi.fn(),
  commit: vi.fn(),
  discard: vi.fn(),
}));
const save = vi.hoisted(() => vi.fn());
vi.mock("@/hosts/ssh/ssh-transport", () => ({
  supportsSshKeyImport: true,
  getSshKeyImportBridge: () => native,
}));
vi.mock("@/hosts/ssh/import-private-key", () => ({
  importPrivateKey: async () => ({ name: "id_ed25519", text: "test-private-key" }),
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React);
  native.inspect.mockReset().mockResolvedValue("SHA256:test-server");
  native.stage.mockReset().mockResolvedValue(undefined);
  native.commit.mockReset().mockResolvedValue(undefined);
  native.discard.mockReset().mockResolvedValue(undefined);
  save.mockReset().mockImplementation(async (input) => {
    await input.beforeSave();
    return { profile: { serverId: "srv_ssh" }, serverId: "srv_ssh", hostname: "server" };
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Edit through the real uncontrolled input rather than assigning component state. */
function typeTarget(text: string) {
  const input = within(document.body).getByLabelText("SSH host") as HTMLInputElement;
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!valueSetter) throw new Error("HTML input value setter is unavailable");
  act(() => {
    valueSetter.call(input, text);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
  });
}
async function click(label: string) {
  await act(async () => within(document.body).getByRole("button", { name: label }).click());
}
function mount() {
  const onSaved = vi.fn();
  act(() =>
    root.render(
      <RemoteSshHostForm
        hosts={[]}
        probeAndUpsertRemoteSshConnection={save}
        visible
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    ),
  );
  return onSaved;
}

describe("Android SSH key import form", () => {
  it("requires fingerprint approval before connecting and clears credentials after success", async () => {
    const onSaved = mount();
    typeTarget("ssh://deploy@example.com");
    await click("Import private key");
    await click("Connect");
    expect(within(document.body).getByTestId("ssh-server-fingerprint").textContent).toBe(
      "SHA256:test-server",
    );
    expect(save).toHaveBeenCalledTimes(0);
    await click("Trust and connect");
    expect(save).toHaveBeenCalledTimes(1);
    expect(native.commit).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith({
      profile: { serverId: "srv_ssh" },
      serverId: "srv_ssh",
      hostname: "server",
      isNewHost: true,
    });
    expect(
      within(document.body).getByRole("button", { name: "Import private key" }).textContent,
    ).toBe("Import private key");
    expect((within(document.body).getByLabelText("SSH host") as HTMLInputElement).value).toBe("");
  });
  it("shows import errors in the form and lets the user retry without losing the target", async () => {
    native.inspect.mockRejectedValueOnce(
      new Error("Unable to read the private key. Check its format and passphrase."),
    );
    mount();
    typeTarget("ssh://deploy@example.com");
    await click("Import private key");
    await click("Connect");
    expect(
      within(document.body).getByText(
        "Unable to connect over SSH. Unable to read the private key. Check its format and passphrase.",
      ).textContent,
    ).toBe(
      "Unable to connect over SSH. Unable to read the private key. Check its format and passphrase.",
    );
    expect((within(document.body).getByLabelText("SSH host") as HTMLInputElement).value).toBe(
      "ssh://deploy@example.com",
    );
    await click("Connect");
    expect(within(document.body).getByTestId("ssh-server-fingerprint").textContent).toBe(
      "SHA256:test-server",
    );
  });
  it("requires fingerprint approval again when the destination changes", async () => {
    mount();
    typeTarget("ssh://deploy@example.com");
    await click("Import private key");
    await click("Connect");
    typeTarget("ssh://deploy@other.example.com");
    expect(within(document.body).queryByTestId("ssh-server-fingerprint")).toBeNull();
    await click("Connect");
    expect(native.inspect).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(0);
  });
});
