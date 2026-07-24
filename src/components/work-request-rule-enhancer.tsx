"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getSupabaseClient, isDemoMode } from "@/lib/supabase";

const NOTICE = "12시 이전에 등록하면 당일이 영업일인 경우 당일 출고를 요청할 수 있습니다. 12시부터 17시까지는 다음 영업일부터, 17시를 초과하면 두 번째 영업일부터 요청할 수 있습니다. 토·일요일, 공휴일 및 관리자 지정 휴무일은 출고 요청일로 선택할 수 없습니다. 작업자는 요청 출고일과 관계없이 배정된 업무를 즉시 시작할 수 있습니다.";

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function findRequestedDateInput(): HTMLInputElement | null {
  return [...document.querySelectorAll<HTMLLabelElement>("label")]
    .find((label) => label.textContent?.replace(/\s+/g, " ").trim().startsWith("요청 출고일"))
    ?.querySelector<HTMLInputElement>('input[type="date"]') ?? null;
}

function replaceNotice() {
  document.querySelectorAll<HTMLParagraphElement>("p").forEach((paragraph) => {
    const text = paragraph.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (
      text.startsWith("당일 출고는 불가능합니다.")
      || text.includes("두 번째 영업일부터 요청")
      || text.includes("15시 이전에 등록하면")
    ) {
      paragraph.textContent = NOTICE;
    }
  });
}

export function WorkRequestRuleEnhancer() {
  const pathname = usePathname();
  const appliedRef = useRef(false);

  useEffect(() => {
    if (!pathname.startsWith("/work-requests")) return;

    let cancelled = false;
    let earliestDate = "";
    let retries = 0;
    let touched = false;

    const loadEarliestDate = async () => {
      if (isDemoMode()) return;
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { data, error } = await supabase.rpc("earliest_work_request_ship_date", {
        p_requested_at: new Date().toISOString(),
      });
      if (!error && typeof data === "string") earliestDate = data;
    };

    void loadEarliestDate();

    const interval = window.setInterval(() => {
      if (cancelled) return;
      replaceNotice();

      const input = findRequestedDateInput();
      if (!input || appliedRef.current) return;

      if (input.dataset.requestRuleBound !== "true") {
        input.dataset.requestRuleBound = "true";
        input.addEventListener("pointerdown", () => { touched = true; }, { once: true });
        input.addEventListener("keydown", () => { touched = true; }, { once: true });
      }

      if (!earliestDate || touched) return;
      setControlledInputValue(input, earliestDate);
      retries += 1;
      if (retries >= 8) appliedRef.current = true;
    }, 250);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [pathname]);

  return null;
}
