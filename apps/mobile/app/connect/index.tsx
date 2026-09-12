// FILE: index.tsx
// Purpose: "Add connection" / re-pair modal.
// Layer: Mobile screens
//
// Shares its body with the first-run screen (`app/index.tsx` renders the same
// `ConnectView` when nothing is paired); only the chrome differs.

import { router } from "expo-router";
import { useCallback } from "react";

import { ConnectView } from "@/features/connections/ConnectView";

export default function ConnectModal() {
  const dismiss = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, []);

  return <ConnectView variant="modal" onConnected={dismiss} onCancel={dismiss} />;
}
