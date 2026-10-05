export interface BrowserWorkspaceRegistration {
  browserId: string;
  workspaceId: string;
}

export interface BrowserWebContentsRegistration {
  browserId: string;
  hostWebContentsId: number;
}

export type BrowserWebviewRegistryEvent =
  | ({
      type: "registered" | "unregistered";
      webContentsId: number;
    } & BrowserWebContentsRegistration)
  | {
      type: "active-changed";
      hostWebContentsId: number;
      previousWebContentsId: number | null;
      webContentsId: number | null;
    };

export class PaseoBrowserWebviewRegistry {
  private readonly listeners = new Set<(event: BrowserWebviewRegistryEvent) => void>();

  /** Observe committed identity/selection changes; repeated renderer announcements produce no events. */
  public subscribe(listener: (event: BrowserWebviewRegistryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: BrowserWebviewRegistryEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private getActiveWebContentsId(hostWebContentsId: number): number | null {
    const browserId = this.getActiveBrowserIdForHostWindow(hostWebContentsId);
    return browserId === null
      ? null
      : this.getWebContentsIdForBrowserInHostWindow(hostWebContentsId, browserId);
  }

  private emitActiveChange(hostWebContentsId: number, previousWebContentsId: number | null): void {
    const webContentsId = this.getActiveWebContentsId(hostWebContentsId);
    if (webContentsId !== previousWebContentsId) {
      this.emit({
        type: "active-changed",
        hostWebContentsId,
        previousWebContentsId,
        webContentsId,
      });
    }
  }

  private readonly pendingRegistrations = new Map<
    number,
    Set<(registration: BrowserWebContentsRegistration | null) => void>
  >();
  private readonly registrationsByWebContentsId = new Map<number, BrowserWebContentsRegistration>();
  private readonly webContentsIdsByHostAndBrowserId = new Map<string, number>();
  private readonly workspaceIdsByBrowserId = new Map<string, string>();
  private readonly activeBrowserIdsByHostWindow = new Map<number, Map<string, string>>();

  public registerWebContents(input: {
    webContentsId: number;
    browserId: string;
    hostWebContentsId: number;
  }): void {
    const previousActive = this.getActiveWebContentsId(input.hostWebContentsId);
    const hostBrowserKey = this.hostBrowserKey(input.hostWebContentsId, input.browserId);
    const replacedWebContentsId = this.webContentsIdsByHostAndBrowserId.get(hostBrowserKey);
    const existingRegistration = this.registrationsByWebContentsId.get(input.webContentsId);
    if (
      replacedWebContentsId === input.webContentsId &&
      existingRegistration?.browserId === input.browserId &&
      existingRegistration.hostWebContentsId === input.hostWebContentsId
    ) {
      return;
    }
    if (replacedWebContentsId !== undefined && replacedWebContentsId !== input.webContentsId) {
      this.removeWebContents(replacedWebContentsId, { preserveActiveBrowser: true });
    }
    if (this.registrationsByWebContentsId.has(input.webContentsId)) {
      this.removeWebContents(input.webContentsId);
    }

    this.registrationsByWebContentsId.set(input.webContentsId, {
      browserId: input.browserId,
      hostWebContentsId: input.hostWebContentsId,
    });
    this.webContentsIdsByHostAndBrowserId.set(hostBrowserKey, input.webContentsId);
    this.resolvePendingRegistration(
      input.webContentsId,
      this.getRegistrationForWebContents(input.webContentsId),
    );
    this.emit({ type: "registered", ...input });
    this.emitActiveChange(input.hostWebContentsId, previousActive);
  }

  /** Wait for the actual renderer identity; cancellation resolves null when a guest disappears. */
  public waitForRegistration(
    webContentsId: number,
  ): Promise<BrowserWebContentsRegistration | null> {
    const registration = this.getRegistrationForWebContents(webContentsId);
    if (registration) {
      return Promise.resolve(registration);
    }
    return new Promise((resolve) => {
      const callbacks = this.pendingRegistrations.get(webContentsId) ?? new Set();
      callbacks.add(resolve);
      this.pendingRegistrations.set(webContentsId, callbacks);
    });
  }

  private resolvePendingRegistration(
    webContentsId: number,
    registration: BrowserWebContentsRegistration | null,
  ): void {
    const callbacks = this.pendingRegistrations.get(webContentsId);
    this.pendingRegistrations.delete(webContentsId);
    callbacks?.forEach((resolve) => resolve(registration));
  }

  public unregisterWebContents(webContentsId: number): void {
    this.resolvePendingRegistration(webContentsId, null);
    if (!this.registrationsByWebContentsId.has(webContentsId)) {
      return;
    }

    this.removeWebContents(webContentsId);
  }

  public getBrowserIdForWebContents(webContentsId: number): string | null {
    return this.registrationsByWebContentsId.get(webContentsId)?.browserId ?? null;
  }

  public getRegistrationForWebContents(
    webContentsId: number,
  ): BrowserWebContentsRegistration | null {
    return this.registrationsByWebContentsId.get(webContentsId) ?? null;
  }

  public getWebContentsIdForBrowserInHostWindow(
    hostWebContentsId: number,
    browserId: string,
  ): number | null {
    return (
      this.webContentsIdsByHostAndBrowserId.get(
        this.hostBrowserKey(hostWebContentsId, browserId),
      ) ?? null
    );
  }

  public listBrowserIds(): string[] {
    return Array.from(
      new Set(Array.from(this.registrationsByWebContentsId.values(), ({ browserId }) => browserId)),
    ).sort();
  }

  public registerWorkspace(input: BrowserWorkspaceRegistration): void {
    this.workspaceIdsByBrowserId.set(input.browserId, input.workspaceId);
  }

  public unregisterBrowser(browserId: string): void {
    for (const [webContentsId, registration] of this.registrationsByWebContentsId) {
      if (registration.browserId === browserId) {
        this.unregisterWebContents(webContentsId);
      }
    }
    this.workspaceIdsByBrowserId.delete(browserId);
    this.deleteActiveBrowserReferences(browserId);
  }

  public unregisterBrowserFromHost(hostWebContentsId: number, browserId: string): void {
    const webContentsId = this.getWebContentsIdForBrowserInHostWindow(hostWebContentsId, browserId);
    if (webContentsId !== null) {
      this.unregisterWebContents(webContentsId);
    }
  }

  public getWorkspaceId(browserId: string): string | null {
    return this.workspaceIdsByBrowserId.get(browserId) ?? null;
  }

  public hasBrowserInOtherHostWindow(hostWebContentsId: number, browserId: string): boolean {
    for (const registration of this.registrationsByWebContentsId.values()) {
      if (
        registration.browserId === browserId &&
        registration.hostWebContentsId !== hostWebContentsId
      ) {
        return true;
      }
    }
    return false;
  }

  public unregisterHostWebContents(hostWebContentsId: number): void {
    for (const [webContentsId, registration] of this.registrationsByWebContentsId) {
      if (registration.hostWebContentsId === hostWebContentsId) {
        this.unregisterWebContents(webContentsId);
      }
    }
    this.activeBrowserIdsByHostWindow.delete(hostWebContentsId);
  }

  public listBrowserIdsForWorkspace(workspaceId: string): string[] {
    return this.listBrowserIds().filter(
      (browserId) => this.workspaceIdsByBrowserId.get(browserId) === workspaceId,
    );
  }

  public setWorkspaceActiveBrowser(input: {
    hostWebContentsId: number;
    workspaceId: string;
    browserId: string | null;
  }): void {
    const previousActive = this.getActiveWebContentsId(input.hostWebContentsId);
    if (input.browserId === null) {
      const activeBrowserIdsByWorkspace = this.activeBrowserIdsByHostWindow.get(
        input.hostWebContentsId,
      );
      if (!activeBrowserIdsByWorkspace) {
        return;
      }
      activeBrowserIdsByWorkspace.delete(input.workspaceId);
      if (activeBrowserIdsByWorkspace.size === 0) {
        this.activeBrowserIdsByHostWindow.delete(input.hostWebContentsId);
      }
      this.emitActiveChange(input.hostWebContentsId, previousActive);
      return;
    }
    if (this.hasBrowser(input.browserId)) {
      this.workspaceIdsByBrowserId.set(input.browserId, input.workspaceId);
    }
    const activeBrowserIdsByWorkspace =
      this.activeBrowserIdsByHostWindow.get(input.hostWebContentsId) ?? new Map<string, string>();
    activeBrowserIdsByWorkspace.delete(input.workspaceId);
    activeBrowserIdsByWorkspace.set(input.workspaceId, input.browserId);
    this.activeBrowserIdsByHostWindow.delete(input.hostWebContentsId);
    this.activeBrowserIdsByHostWindow.set(input.hostWebContentsId, activeBrowserIdsByWorkspace);
    this.emitActiveChange(input.hostWebContentsId, previousActive);
  }

  public getActiveBrowserIdForHostWindow(hostWebContentsId: number): string | null {
    return (
      Array.from(this.activeBrowserIdsByHostWindow.get(hostWebContentsId)?.values() ?? []).at(-1) ??
      null
    );
  }

  public getActiveBrowserIdForWorkspaceInHostWindow(
    hostWebContentsId: number,
    workspaceId: string,
  ): string | null {
    return this.activeBrowserIdsByHostWindow.get(hostWebContentsId)?.get(workspaceId) ?? null;
  }

  public getMostRecentActiveBrowserIdForWorkspace(workspaceId: string): string | null {
    const activeBrowserIdsByHostWindow = Array.from(this.activeBrowserIdsByHostWindow.values());
    for (let index = activeBrowserIdsByHostWindow.length - 1; index >= 0; index -= 1) {
      const browserId = activeBrowserIdsByHostWindow[index].get(workspaceId);
      if (browserId) {
        return browserId;
      }
    }
    return null;
  }

  private deleteActiveBrowserReferences(browserId: string): void {
    for (const [hostWebContentsId, activeBrowserIdsByWorkspace] of this
      .activeBrowserIdsByHostWindow) {
      for (const [workspaceId, activeBrowserId] of activeBrowserIdsByWorkspace) {
        if (activeBrowserId === browserId) {
          activeBrowserIdsByWorkspace.delete(workspaceId);
        }
      }
      if (activeBrowserIdsByWorkspace.size === 0) {
        this.activeBrowserIdsByHostWindow.delete(hostWebContentsId);
      }
    }
  }

  private deleteActiveBrowserReferencesInHostWindow(
    browserId: string,
    hostWebContentsId: number,
  ): void {
    const activeBrowserIdsByWorkspace = this.activeBrowserIdsByHostWindow.get(hostWebContentsId);
    if (!activeBrowserIdsByWorkspace) {
      return;
    }
    for (const [workspaceId, activeBrowserId] of activeBrowserIdsByWorkspace) {
      if (activeBrowserId === browserId) {
        activeBrowserIdsByWorkspace.delete(workspaceId);
      }
    }
    if (activeBrowserIdsByWorkspace.size === 0) {
      this.activeBrowserIdsByHostWindow.delete(hostWebContentsId);
    }
  }

  private removeWebContents(
    webContentsId: number,
    options: { preserveActiveBrowser?: boolean } = {},
  ): void {
    const registration = this.registrationsByWebContentsId.get(webContentsId);
    if (!registration) {
      return;
    }
    const { browserId, hostWebContentsId } = registration;
    const previousActive = this.getActiveWebContentsId(hostWebContentsId);

    this.registrationsByWebContentsId.delete(webContentsId);
    this.webContentsIdsByHostAndBrowserId.delete(this.hostBrowserKey(hostWebContentsId, browserId));

    if (
      !options.preserveActiveBrowser &&
      !this.hasBrowserInHostWindow(browserId, hostWebContentsId)
    ) {
      this.deleteActiveBrowserReferencesInHostWindow(browserId, hostWebContentsId);
    }
    this.emit({ type: "unregistered", webContentsId, ...registration });
    if (!options.preserveActiveBrowser) {
      this.emitActiveChange(hostWebContentsId, previousActive);
    }
  }

  private hasBrowser(browserId: string): boolean {
    return Array.from(this.registrationsByWebContentsId.values()).some(
      (registration) => registration.browserId === browserId,
    );
  }

  private hasBrowserInHostWindow(browserId: string, hostWebContentsId: number): boolean {
    return this.webContentsIdsByHostAndBrowserId.has(
      this.hostBrowserKey(hostWebContentsId, browserId),
    );
  }

  private hostBrowserKey(hostWebContentsId: number, browserId: string): string {
    return `${hostWebContentsId}:${browserId}`;
  }
}
