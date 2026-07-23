"use client";

import { useEffect } from "react";

function isNumericInput(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement
    && (target.type === "number" || target.inputMode === "numeric" || target.inputMode === "decimal");
}

export function NumericInputBehavior() {
  useEffect(() => {
    const handleFocus = (event: FocusEvent) => {
      if (!isNumericInput(event.target)) return;
      if (event.target.value === "0") {
        window.setTimeout(() => event.target.select(), 0);
      }
    };

    const handleBeforeInput = (event: InputEvent) => {
      if (!isNumericInput(event.target)) return;
      if (event.target.value !== "0") return;
      if (!event.inputType.startsWith("insert")) return;
      if (!event.data || !/^\d+$/.test(event.data)) return;

      event.preventDefault();
      event.target.value = event.data.replace(/^0+(?=\d)/, "");
      event.target.dispatchEvent(new Event("input", { bubbles: true }));
    };

    document.addEventListener("focusin", handleFocus);
    document.addEventListener("beforeinput", handleBeforeInput as EventListener);

    return () => {
      document.removeEventListener("focusin", handleFocus);
      document.removeEventListener("beforeinput", handleBeforeInput as EventListener);
    };
  }, []);

  return null;
}
