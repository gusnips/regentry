import {
  MessageScroller as Scroller,
  useMessageScroller,
  useMessageScrollerScrollable,
} from "@shadcn/react/message-scroller";
import type { ComponentProps } from "react";

/** Styled shells over @shadcn/react's headless message scroller (shadcn's chat
 *  primitives, June 2026), house tokens: the Provider owns follow-the-live-edge,
 *  turn anchoring and saved-transcript restoration; the viewport is the scroll
 *  region; items are the measurable rows anchoring works on. */
export function MessageScrollerProvider(props: ComponentProps<typeof Scroller.Provider>) {
  return <Scroller.Provider {...props} />;
}

export function MessageScroller({
  className = "",
  ...props
}: ComponentProps<typeof Scroller.Root>) {
  return (
    <Scroller.Root
      data-slot="message-scroller"
      className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${className}`}
      {...props}
    />
  );
}

export function MessageScrollerViewport({
  className = "",
  ...props
}: ComponentProps<typeof Scroller.Viewport>) {
  return (
    <Scroller.Viewport
      data-slot="message-scroller-viewport"
      className={`min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 ${className}`}
      {...props}
    />
  );
}

export function MessageScrollerContent({
  className = "",
  ...props
}: ComponentProps<typeof Scroller.Content>) {
  return (
    <Scroller.Content
      data-slot="message-scroller-content"
      className={`flex h-max min-h-full flex-col gap-2 ${className}`}
      {...props}
    />
  );
}

export function MessageScrollerItem({
  className = "",
  ...props
}: ComponentProps<typeof Scroller.Item>) {
  return (
    <Scroller.Item
      data-slot="message-scroller-item"
      className={`flex min-w-0 shrink-0 flex-col ${className}`}
      {...props}
    />
  );
}

export { useMessageScroller, useMessageScrollerScrollable };
