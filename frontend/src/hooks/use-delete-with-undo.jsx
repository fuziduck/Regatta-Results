import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// How long the "Undo" affordance stays up before the delete is actually sent
// to the server. The row is hidden the moment the officer confirms, so this
// doubles as the window in which a mis-tap can still be walked back.
export const UNDO_WINDOW_MS = 8000;

// Pending deletes are tracked outside React on purpose. Unmounting the tab (or
// navigating away) must not strand one — otherwise a record the officer
// watched disappear would silently come back on the next load, and the delete
// they confirmed would never happen.
let nextToken = 0;
const timers = new Map();

let undoWindowMs = UNDO_WINDOW_MS;
// Tests shrink the grace period so they don't have to wait eight seconds.
export function setUndoWindowMs(ms) {
  undoWindowMs = ms;
}

/**
 * Delete confirmation with a short, reversible window.
 *
 * There is no "undelete" endpoint, and re-creating a record would hand it a
 * new id — orphaning the race results, series links and subscriptions that
 * point at the old one. So the delete is held back instead of performed and
 * reversed: the row is hidden at once, and the server is only told once the
 * undo window has closed.
 *
 * Returns `askDelete(opts)`, `isPending(key)` for filtering the row out, and
 * `dialog` which the caller must render.
 */
export function useDeleteWithUndo() {
  const [request, setRequest] = useState(null);
  const [pending, setPending] = useState(() => new Set());
  const requestRef = useRef(null);
  requestRef.current = request;

  const isPending = useCallback((key) => pending.has(key), [pending]);

  const askDelete = useCallback((opts) => setRequest(opts), []);

  const release = useCallback((key) => {
    if (key == null) return;
    setPending((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const confirm = useCallback(() => {
    const opts = requestRef.current;
    setRequest(null);
    if (!opts) return;

    const { key, commit, undo, successMessage, undoneMessage, errorMessage } = opts;
    if (key != null) setPending((prev) => new Set(prev).add(key));

    const token = ++nextToken;
    const settle = async () => {
      timers.delete(token);
      try {
        await commit?.();
        release(key);
      } catch (err) {
        // Put the row back: the server still has the record.
        release(key);
        toast.error(err?.response?.data?.detail || errorMessage || "Could not delete this item");
        undo?.();
      }
    };
    timers.set(token, setTimeout(settle, undoWindowMs));

    toast.success(successMessage || "Deleted", {
      duration: undoWindowMs,
      action: {
        label: "Undo",
        onClick: () => {
          const timer = timers.get(token);
          if (timer) {
            clearTimeout(timer);
            timers.delete(token);
          }
          release(key);
          undo?.();
          toast.success(undoneMessage || "Restored");
        },
      },
    });
  }, [release]);

  const dialog = (
    <AlertDialog open={!!request} onOpenChange={(open) => { if (!open) setRequest(null); }}>
      <AlertDialogContent data-testid="confirm-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle data-testid="confirm-delete-title">
            {request?.title || "Delete this item?"}
          </AlertDialogTitle>
          {request?.description ? (
            <AlertDialogDescription>{request.description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="confirm-delete-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="confirm-delete-confirm"
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={confirm}
          >
            {request?.confirmLabel || "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { askDelete, isPending, dialog };
}
