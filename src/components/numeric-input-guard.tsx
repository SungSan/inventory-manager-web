"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * 숫자 입력은 편집 중 공란을 허용한다.
 * 외부이관의 다음 단계 버튼은 로컬 수량 초안이 공란이면 서버에 남아 있는
 * 이전 수량으로 진행하지 않도록 클릭 단계에서 추가로 차단한다.
 */
export function NumericInputGuard() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/external-transfers/")) return;

    const handleClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button");
      if (!button || button.textContent?.trim() !== "상품·수량 확인") return;

      const page = button.closest<HTMLElement>(".page-stack");
      const blankInput = [...(page?.querySelectorAll<HTMLInputElement>('input[type="number"]') ?? [])]
        .find((input) => !input.disabled && input.value.trim() === "");

      if (!blankInput) return;

      event.preventDefault();
      event.stopPropagation();
      window.alert("모든 상품의 출고 수량을 입력하세요.");
      blankInput.focus();
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [pathname]);

  return null;
}
