"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (isLocal || process.env.NODE_ENV === "development") {
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      );
      if ("caches" in window) {
        void caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
      }
      return;
    }

    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
