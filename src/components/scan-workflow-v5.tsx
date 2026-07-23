"use client";

import { useEffect } from "react";
import { ScanWorkflowV4 } from "@/components/scan-workflow-v4";

function markBlank(input: HTMLInputElement | null) {
  if (!input) return;
  input.dataset.locQtyBlank = "true";
  input.value = "";
}

export function ScanWorkflowV5() {
  useEffect(() => {
    const handleChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
      const article = target.closest("article");
      const qty = article?.querySelector<HTMLInputElement>('input[type="number"]') ?? null;
      if (!target.checked) {
        if (qty) delete qty.dataset.locQtyBlank;
        return;
      }
      window.setTimeout(() => markBlank(article?.querySelector<HTMLInputElement>('input[type="number"]') ?? null), 0);
    };

    const handleInput = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "number") return;
      if (target.dataset.locQtyBlank === "true" && target.value !== "") delete target.dataset.locQtyBlank;
    };

    const handleClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest("button");
      if (!button) return;
      const label = button.textContent?.trim() ?? "";
      if (label.includes("검색 결과 전체 선택")) {
        window.setTimeout(() => {
          document.querySelectorAll<HTMLInputElement>('article input[type="checkbox"]:checked').forEach((checkbox) => {
            markBlank(checkbox.closest("article")?.querySelector<HTMLInputElement>('input[type="number"]') ?? null);
          });
        }, 0);
        return;
      }
      if (label !== "선택 상품 입고" && label !== "선택 상품 출고") return;
      const scope = button.closest("section");
      const blanks = scope?.querySelectorAll<HTMLInputElement>('input[type="number"][data-loc-qty-blank="true"]') ?? [];
      if (blanks.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      window.alert("선택한 상품의 수량을 모두 입력하세요.");
      blanks[0]?.focus();
    };

    const timer = window.setInterval(() => {
      document.querySelectorAll<HTMLInputElement>('input[type="number"][data-loc-qty-blank="true"]').forEach((input) => {
        if (input.value !== "") input.value = "";
      });
    }, 150);

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
