"use client";

import { useRouter } from "next/navigation";
import { resetOnboarding } from "@/app/actions";

export function RetakeTourButton() {
  const router = useRouter();
  return (
    <button
      className="btn"
      onClick={async () => { await resetOnboarding(); router.push("/spaces"); }}
    >
      Retake onboarding tour
    </button>
  );
}
