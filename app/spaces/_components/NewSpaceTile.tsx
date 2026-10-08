"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { SpaceForms } from "./SpaceForms";

// Last tile in the spaces gallery: create a space or join one with an invite code.
export function NewSpaceTile({ first = false }: { first?: boolean }) {
  const [open, setOpen] = useState(false);
  // The hero's "Create a space" link targets #create-space.
  useEffect(() => {
    const check = () => { if (window.location.hash === "#create-space") setOpen(true); };
    check(); window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);
  return (
    <>
      <button type="button" id="create-space" className="sp-new" onClick={() => setOpen(true)} data-tour="create-space">
        <span className="sp-new-ico" aria-hidden="true"><Plus size={22} /></span>
        <strong>{first ? "Create your first space" : "New space"}</strong>
        <span>One per module. Or join a classmate&apos;s with their invite code.</span>
      </button>
      {open && (
        <Dialog title="Create or join a space" onClose={() => { setOpen(false); if (window.location.hash) history.replaceState(null, "", " "); }} width={520}>
          <SpaceForms />
        </Dialog>
      )}
    </>
  );
}
