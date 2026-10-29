import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { readLocalApi } from "~/localApi";
import { useWorkReport, useWorkReportFolderDialog } from "./useWorkReport";

const DEFAULT_REPORTS_FOLDER = "~/work-reports";

/** Asks for the reports folder the first time a work report runs. */
export function WorkReportFolderDialogHost() {
  const open = useWorkReportFolderDialog((state) => state.open);
  const setOpen = useWorkReportFolderDialog((state) => state.setOpen);
  return open ? <WorkReportFolderDialog onClose={() => setOpen(false)} /> : null;
}

function WorkReportFolderDialog({ onClose }: { onClose: () => void }) {
  const { start } = useWorkReport();
  const [folder, setFolder] = useState(DEFAULT_REPORTS_FOLDER);
  const [pending, setPending] = useState(false);
  // The picker browses this machine, which is the primary environment on desktop.
  const canBrowse = typeof window !== "undefined" && window.desktopBridge !== undefined;

  const browse = async () => {
    const picked = await readLocalApi()?.dialogs.pickFolder();
    if (picked) setFolder(picked);
  };

  const submit = async () => {
    const trimmed = folder.trim();
    if (trimmed === "" || pending) return;
    setPending(true);
    const started = await start(trimmed);
    setPending(false);
    if (started) onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose a reports folder</DialogTitle>
          <DialogDescription>
            Work reports and the client list are saved in this folder on the server. T3 Code creates
            the folder if it does not exist and adds it as a project.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Input
              aria-label="Reports folder"
              autoFocus
              className="flex-1"
              disabled={pending}
              onChange={(event) => setFolder(event.target.value)}
              value={folder}
            />
            {canBrowse ? (
              <Button
                disabled={pending}
                onClick={() => void browse()}
                type="button"
                variant="outline"
              >
                Browse
              </Button>
            ) : null}
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button disabled={pending} onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button disabled={pending || folder.trim() === ""} onClick={() => void submit()}>
            Start report
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
