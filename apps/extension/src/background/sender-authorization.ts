export type ExtensionMessageSender = Pick<
  chrome.runtime.MessageSender,
  "id" | "url" | "origin" | "frameId" | "documentLifecycle"
> & {
  tab?: unknown;
};

export function createSidePanelAuthorizer(extensionId: string) {
  const origin = `chrome-extension://${extensionId}`;
  const sidePanelUrl = `${origin}/src/sidepanel/index.html`;

  return function isAllowed(sender: ExtensionMessageSender): boolean {
    return (
      sender.id === extensionId &&
      sender.url === sidePanelUrl &&
      sender.origin === origin &&
      sender.tab === undefined &&
      (sender.frameId === undefined || sender.frameId === 0) &&
      (sender.documentLifecycle === undefined ||
        sender.documentLifecycle === "active")
    );
  };
}
