"use client";

import { useEffect } from "react";
import { ScanWorkflowV4 } from "@/components/scan-workflow-v4";

const NOTE_PRESETS = ["국내 출고", "일반 출고", "글로비 출고", "위챗 출고", "유통 출고"];

function quantityInputFrom(target: Element | null): HTMLInputElement | null {
  return target?.closest("article")?.querySelector<HTMLInputElement>('input[type="number"]') ?? null;
}

function markBlank(input: HTMLInputElement | null) {
  if (!input) return;
  input.dataset.scanQtyInitialized = "true";
  input.dataset.scanQtyBlank = "true";
  input.value = "";
}

function isCheckedLocationRow(input: HTMLInputElement): boolean {
  return Boolean(input.closest("article")?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked);
}

function isProductRow(input: HTMLInputElement): boolean {
  return Boolean(input.closest("article")) && !input.closest("article")?.querySelector<HTMLInputElement>('input[type="checkbox"]');
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function injectNotePreset(label: HTMLLabelElement) {
  if (label.dataset.notePresetReady === "true") return;
  const input = label.querySelector<HTMLInputElement>('input:not([type="number"]):not([type="checkbox"])');
  if (!input) return;

  const ownText = [...label.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent?.trim() ?? "")
    .join(" ")
    .trim();
  if (ownText !== "메모(선택)") return;

  label.dataset.notePresetReady = "true";
  input.placeholder = "빠른 메모를 선택하거나 직접 입력";

  const select = document.createElement("select");
  select.setAttribute("aria-label", "빠른 메모 선택");
  select.style.width = "100%";
  select.style.marginTop = "8px";
  select.style.marginBottom = "8px";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "빠른 메모 선택";
  select.appendChild(placeholder);

  for (const preset of NOTE_PRESETS) {
    const option = document.createElement("option");
    option.value = preset;
    option.textContent = preset;
    select.appendChild(option);
  }

  const custom = document.createElement("option");
  custom.value = "__custom__";
  custom.textContent = "직접 입력";
  select.appendChild(custom);

  select.addEventListener("change", () => {
    if (select.value === "__custom__") {
      input.focus();
      select.value = "";
      return;
    }
    if (select.value) {
      setControlledInputValue(input, select.value);
      input.focus();
    }
    select.value = "";
  });

  label.insertBefore(select, input);
}

export function ScanWorkflowV5() {
  useEffect(() => {
    const handleChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
      const qty = quantityInputFrom(target);
      if (!target.checked) {
        if (qty) {
          delete qty.dataset.scanQtyBlank;
          delete qty.dataset.scanQtyInitialized;
        }
        return;
      }
      window.setTimeout(() => markBlank(quantityInputFrom(target)), 0);
    };

    const handleInput = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "number") return;

      if (target.value === "" && (isCheckedLocationRow(target) || isProductRow(target))) {
        markBlank(target);
        window.setTimeout(() => markBlank(quantityInputFrom(target)), 0);
        return;
      }

      if (target.dataset.scanQtyBlank === "true" && target.value !== "") {
        delete target.dataset.scanQtyBlank;
      }
    };

    const handleClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest("button");
      if (!button) return;
      const label = button.textContent?.trim() ?? "";

      if (label.includes("검색 결과 전체 선택")) {
        window.setTimeout(() => {
          document.querySelectorAll<HTMLInputElement>('article input[type="checkbox"]:checked').forEach((checkbox) => {
            markBlank(quantityInputFrom(checkbox));
          });
        }, 0);
        return;
      }

      const isConfirm = label === "선택 상품 입고"
        || label === "선택 상품 출고"
        || label.endsWith("입고 확정")
        || label.endsWith("출고 확정");
      if (!isConfirm) return;

      const blanks = document.querySelectorAll<HTMLInputElement>('input[type="number"][data-scan-qty-blank="true"]');
      if (blanks.length === 0) return;

      event.preventDefault();
      event.stopPropagation();
      window.alert("선택한 상품의 수량을 모두 입력하세요.");
      blanks[0]?.focus();
    };

    const timer = window.setInterval(() => {
      document.querySelectorAll<HTMLInputElement>('article input[type="number"]').forEach((input) => {
        if (input.dataset.scanQtyInitialized !== "true" && (isProductRow(input) || isCheckedLocationRow(input))) {
          markBlank(input);
        }
        if (input.dataset.scanQtyBlank === "true" && input.value !== "") input.value = "";
      });

      document.querySelectorAll<HTMLLabelElement>("label").forEach(injectNotePreset);
    }, 120);

    document.addEventListener("change", handleChange);
    document.addEventListener("input", handleInput);
    document.addEventListener("click", handleClick, true);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("change", handleChange);
      document.removeEventListener("input", handleInput);
      document.removeEventListener("click", handleClick, true);
    };
  }, []);

  return <ScanWorkflowV4 />;
}
