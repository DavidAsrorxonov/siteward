chrome.sidePanel
  .setPanelBehavior({
    openPanelOnActionClick: true,
  })
  .catch((error: unknown) => {
    console.error("Failed to configure the Siteward side panel:", error);
  });
