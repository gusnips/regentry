/**
 * The one overlay recipe — dialogs (ConfirmDialog, AddProviderDialog), the
 * anchored Popover, and the settings menu all float the same card over the
 * same scrim. Call sites add only what their role changes (width, padding,
 * centering vs anchoring). ZoomableImage's lightbox is the sanctioned
 * exception: a photo scrim goes darker on purpose.
 */
export const scrim = "fixed inset-0 z-50 bg-black/30 dark:bg-black/60";

export const overlayCard =
  "rounded-xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900";
