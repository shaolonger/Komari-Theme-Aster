import { useRef, useState, type DragEvent } from "react";

export type ReorderId = string | number;

export function reorderById<T extends ReorderId>(items: T[], draggedId: T, targetId: T) {
  const from = items.indexOf(draggedId);
  const to = items.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return items;
  const next = [...items];
  const [dragged] = next.splice(from, 1);
  next.splice(to, 0, dragged);
  return next;
}

export function useDragReorder<T extends ReorderId>(
  items: T[],
  onChange: (items: T[]) => void,
  getLabel: (id: T) => string,
) {
  const draggedRef = useRef<T | null>(null);
  const [draggedId, setDraggedId] = useState<T | null>(null);
  const [targetId, setTargetId] = useState<T | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const clear = () => {
    draggedRef.current = null;
    setDraggedId(null);
    setTargetId(null);
  };

  const getHandleProps = (id: T) => ({
    draggable: true,
    onDragStart: (event: DragEvent<HTMLButtonElement>) => {
      draggedRef.current = id;
      setDraggedId(id);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(id));
    },
    onDragEnd: clear,
    "aria-label": `拖拽调整 ${getLabel(id)} 的顺序`,
    title: `拖拽调整 ${getLabel(id)} 的顺序`,
  });

  const getItemProps = (id: T) => ({
    "data-reorder-id": String(id),
    "data-dragging": draggedId === id ? "true" : "false",
    "data-drag-over": targetId === id && draggedId !== id ? "true" : "false",
    onDragEnter: (event: DragEvent<HTMLElement>) => {
      if (draggedRef.current == null || draggedRef.current === id) return;
      event.preventDefault();
      setTargetId(id);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (draggedRef.current == null || draggedRef.current === id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setTargetId(id);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      const sourceId = draggedRef.current;
      if (sourceId == null) return clear();
      const next = reorderById(items, sourceId, id);
      if (next !== items) {
        onChange(next);
        setAnnouncement(`${getLabel(sourceId)} 已移至第 ${next.indexOf(sourceId) + 1} 位`);
      }
      clear();
    },
  });

  return { getHandleProps, getItemProps, announcement };
}
