import { ipcMain } from "electron";
import type { NativeBrowserViewOwner } from "./owner.js";
import {
  BrowserViewOverlaySchema,
  BrowserViewOverlayCaptureSchema,
  BrowserViewOverlayCommitSchema,
  CreateBrowserViewSchema,
  BrowserViewIdentitySchema,
  BrowserViewPresentationSchema,
  BrowserViewNavigationSchema,
  BrowserViewControlSchema,
  BrowserViewScriptSchema,
} from "./contracts.js";

/** Expose native operations through trusted host identity, never last-focused page.
 * Schema failures reject before mutation. Native ownership is checked by the owner.
 */
export function registerNativeBrowserViewIpc(owner: NativeBrowserViewOwner): void {
  ipcMain.handle("paseo:browser-view:overlay-prepare", (event, input: unknown) => {
    const { token } = BrowserViewOverlaySchema.parse(input);
    return owner.prepareOverlay(event.sender.id, token);
  });
  ipcMain.handle("paseo:browser-view:overlay-commit", (event, input: unknown) => {
    const { token, frames } = BrowserViewOverlayCommitSchema.parse(input);
    return owner.commitOverlay(event.sender.id, token, frames);
  });
  ipcMain.handle("paseo:browser-view:overlay-frame", (event, input: unknown) => {
    const { token, ...target } = BrowserViewOverlayCaptureSchema.parse(input);
    return owner.captureOverlay(event.sender.id, token, target);
  });
  ipcMain.handle("paseo:browser-view:overlay-end", (event, input: unknown) => {
    const { token } = BrowserViewOverlaySchema.parse(input);
    owner.endOverlay(event.sender.id, token);
  });
  ipcMain.handle("paseo:browser-view:execute-script", (event, input: unknown) => {
    const request = BrowserViewScriptSchema.parse(input);
    owner.assertTarget(event.sender.id, request.browserId, request.webContentsId);
    return owner.executeScript(event.sender.id, request.browserId, request.code);
  });
  ipcMain.handle("paseo:browser-view:create", (event, input: unknown) =>
    owner.create(event.sender.id, CreateBrowserViewSchema.parse(input)),
  );
  ipcMain.handle("paseo:browser-view:present", (event, input: unknown) => {
    const request = BrowserViewPresentationSchema.parse(input);
    owner.assertTarget(event.sender.id, request.browserId, request.webContentsId);
    return owner.present(event.sender.id, request);
  });
  ipcMain.handle("paseo:browser-view:navigate", async (event, input: unknown) => {
    const request = BrowserViewNavigationSchema.parse(input);
    owner.assertTarget(event.sender.id, request.browserId, request.webContentsId);
    await owner.navigate(event.sender.id, request.browserId, request.url);
  });
  ipcMain.handle("paseo:browser-view:control", (event, input: unknown) => {
    const request = BrowserViewControlSchema.parse(input);
    owner.assertTarget(event.sender.id, request.browserId, request.webContentsId);
    return owner.control(event.sender.id, request.browserId, request.command);
  });
  ipcMain.handle("paseo:browser-view:state", (event, input: unknown) => {
    const request = BrowserViewIdentitySchema.parse(input);
    owner.assertTarget(event.sender.id, request.browserId, request.webContentsId);
    return owner.snapshot(event.sender.id, request.browserId);
  });
  ipcMain.handle("paseo:browser-view:focus", (event, input: unknown) => {
    const request = BrowserViewIdentitySchema.parse(input);
    owner.assertTarget(event.sender.id, request.browserId, request.webContentsId);
    return owner.focus(event.sender.id, request.browserId);
  });
  ipcMain.handle("paseo:browser-view:close", (event, input: unknown) => {
    const request = BrowserViewIdentitySchema.parse(input);
    owner.assertTarget(event.sender.id, request.browserId, request.webContentsId);
    return owner.close(event.sender.id, request.browserId);
  });
}
