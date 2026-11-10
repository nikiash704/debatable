import type { PointerEvent as ReactPointerEvent } from "react";

/** Drag and drop on the board (M4). Cards, thesis headers and points report pointer-downs here. */
export interface DragApi {
  /** Card being dragged (shown as the landing placeholder). */
  draggingId: string | null;
  onCardPointerDown(e: ReactPointerEvent, cardId: string): void;
  onThesisPointerDown(e: ReactPointerEvent, thesisId: string, speech: string): void;
  onPointPointerDown(e: ReactPointerEvent, cardId: string, pointId: string): void;
  /** True once after a drag ended: the click that follows must not select / edit. */
  consumeClick(): boolean;
}
