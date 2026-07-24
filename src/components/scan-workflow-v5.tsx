"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BarcodeField } from "@/components/barcode-field";
import { Feedback, type FeedbackKind } from "@/components/feedback";
import {
  MultiProductBarcodePicker,
  type MultiProductBarcodeSelection,
} from "@/components/multi-product-barcode-picker";
import { ScanWorkflowV4 } from "@/components/scan-workflow-v4";
import { createIdempotencyKey } from "@/lib/barcode";
import { resolveBarcodeCandidates } from "@/lib/inventory-api";
import { listLocationInventory, postLocationInventoryBatch } from "@/lib/scan-operation-api";
import type { Location, Product, ResolvedBarcode } from "@/types/domain";

const NOTE_PRESETS = ["국내 출고", "일반 출고", "글로비 출고", "위챗 출고", "유통 출고"];

interface LocationAddDraft {
  product: Product;
  qty: number;
  currentQty: number;
}

function productFromResolved(item: ResolvedBarcode): Product | null {
  return item.target.type === "product" && "product" in item.target
    ? item.target.product
    : null;
}

function locationFromResolved(item: ResolvedBarcode): Location | null {
  return item.target.type === "location" && "location" in item.target
    ? item.target.location
    : null;
}

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

function LocationFirstInboundProductAdder() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [locationCode, setLocationCode] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [drafts, setDrafts] = useState<LocationAddDraft[]>([]);
  const [candidateMatches, setCandidateMatches] = useState<ResolvedBarcode[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [resetToken, setResetToken] = useState(0);
  const [feedback, setFeedback] = useState<{
    kind: FeedbackKind;
    title: string;
    body?: string;
  } | null>(null);

  useEffect(() => {
    let previousCode = "";

    const detect = () => {
      const sections = [...document.querySelectorAll<HTMLElement>("section")];
      const locationSection = sections.find((section) =>
        section.querySelector<HTMLElement>(".eyebrow")?.textContent?.trim() === "LOCATION FIRST",
      ) ?? null;
      const heading = locationSection?.querySelector("h3")?.textContent?.trim() ?? "";
      const nextCode = heading.replace(/\s+재고 선택$/, "").trim();
      const activeOperation = document.querySelector<HTMLButtonElement>(".operation-switch button.active");
      const nextEnabled = Boolean(locationSection && nextCode && activeOperation?.textContent?.includes("입고"));

      setTarget((current) => current === locationSection ? current : locationSection);
      setLocationCode((current) => current === nextCode ? current : nextCode);
      setEnabled((current) => current === nextEnabled ? current : nextEnabled);

      if (previousCode && previousCode !== nextCode) {
        setDrafts([]);
        setCandidateMatches([]);
        setBarcode("");
        setNote("");
        setFeedback(null);
        setResetToken((value) => value + 1);
      }
      previousCode = nextCode;
    };

    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const resolveCurrentLocation = useCallback(async (): Promise<Location> => {
    if (!locationCode) throw new Error("현재 로케이션을 확인하지 못했습니다.");
    const matches = await resolveBarcodeCandidates(
      locationCode,
      "location",
      "LOCATION_FIRST_IB_LOCATION_RESOLVE",
    );
    if (matches.length === 0) throw new Error(`${locationCode} 로케이션 바코드를 확인하지 못했습니다.`);
    if (matches.length > 1) throw new Error("같은 로케이션 코드가 여러 위치에 연결되어 있습니다.");
    const resolvedLocation = locationFromResolved(matches[0]);
    if (!resolvedLocation) throw new Error("로케이션 정보를 읽지 못했습니다.");
    return resolvedLocation;
  }, [locationCode]);

  const addProducts = useCallback(async (products: Product[]) => {
    if (products.length === 0) return;
    const resolvedLocation = await resolveCurrentLocation();
    const rows = await listLocationInventory(resolvedLocation.id);
    const stockByProduct = new Map(rows.map((row) => [row.productId, row.qty]));

    setDrafts((current) => {
      const next = [...current];
      for (const product of products) {
        const currentQty = stockByProduct.get(product.id) ?? 0;
        const index = next.findIndex((item) => item.product.id === product.id);
        if (index >= 0) {
          next[index] = { ...next[index], currentQty };
        } else {
          next.push({ product, qty: 1, currentQty });
        }
      }
      return next;
    });

    const newCount = products.filter((product) => (stockByProduct.get(product.id) ?? 0) === 0).length;
    setFeedback({
      kind: "success",
      title: newCount > 0 ? "신규 LOC 상품 추가 준비" : "기존 LOC 상품 선택 완료",
      body: newCount > 0
        ? `${products.length} SKU 중 ${newCount} SKU는 ${locationCode}에 없던 상품입니다. 입고 수량을 입력한 뒤 확정하세요.`
        : `${products.length} SKU를 입고 대상으로 선택했습니다.`,
    });
    setBarcode("");
    setResetToken((value) => value + 1);
  }, [locationCode, resolveCurrentLocation]);

  const handleProductScan = useCallback(async (value: string): Promise<boolean> => {
    if (!enabled || busy) return false;
    setBusy(true);
    setFeedback({ kind: "info", title: "상품 바코드 확인 중", body: value });
    try {
      const matches = await resolveBarcodeCandidates(
        value,
        "product",
        "LOCATION_FIRST_IB_PRODUCT_ADD",
      );
      const productMatches = matches.filter((item) => productFromResolved(item)?.id);
      if (productMatches.length === 0) throw new Error("등록되지 않은 상품 바코드입니다.");
      if (productMatches.length > 1) {
        setCandidateMatches(productMatches);
        setFeedback({
          kind: "info",
          title: "공통 상품 바코드",
          body: `${productMatches.length}개 상품이 연결되어 있습니다. 입고할 상품을 선택하세요.`,
        });
        return true;
      }
      const product = productFromResolved(productMatches[0]);
      if (!product) throw new Error("상품 정보를 읽지 못했습니다.");
      await addProducts([product]);
      return true;
    } catch (cause) {
      setFeedback({
        kind: "error",
        title: "상품 추가 실패",
        body: cause instanceof Error ? cause.message : "상품 바코드를 확인하지 못했습니다.",
      });
      return false;
    } finally {
      setBusy(false);
    }
  }, [addProducts, busy, enabled]);

  async function handleCommonSelection(items: MultiProductBarcodeSelection[]) {
    setBusy(true);
    try {
      await addProducts(items.map((item) => item.product));
      setCandidateMatches([]);
    } catch (cause) {
      setFeedback({
        kind: "error",
        title: "상품 추가 실패",
        body: cause instanceof Error ? cause.message : "선택 상품을 추가하지 못했습니다.",
      });
    } finally {
      setBusy(false);
    }
  }

  function changeQty(productId: string, raw: string) {
    const parsed = Number(raw);
    const qty = Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : 1;
    setDrafts((current) => current.map((item) => item.product.id === productId ? { ...item, qty } : item));
  }

  async function confirmAdd() {
    if (drafts.length === 0 || busy) return;
    const totalQty = drafts.reduce((sum, item) => sum + item.qty, 0);
    if (!window.confirm(
      `${locationCode}에 ${drafts.length} SKU / ${totalQty.toLocaleString()}개를 입고할까요?\n현재 LOC에 없던 상품도 신규 재고로 추가됩니다.`,
    )) return;

    setBusy(true);
    setFeedback(null);
    try {
      const resolvedLocation = await resolveCurrentLocation();
      const result = await postLocationInventoryBatch({
        operation: "IB",
        locationId: resolvedLocation.id,
        items: drafts.map((item) => ({ productId: item.product.id, qty: item.qty })),
        note: note.trim() || "LOC 우선 스캔 신규 상품 입고",
        idempotencyKey: createIdempotencyKey(),
      });
      setDrafts([]);
      setNote("");
      setBarcode("");
      setResetToken((value) => value + 1);
      setFeedback({
        kind: "success",
        title: "LOC 상품 입고 완료",
        body: `${result.locationCode} · ${result.itemCount} SKU / ${result.totalQty.toLocaleString()}개가 반영됐습니다. 계속 상품 바코드를 촬영할 수 있습니다.`,
      });
    } catch (cause) {
      setFeedback({
        kind: "error",
        title: "LOC 상품 입고 실패",
        body: cause instanceof Error ? cause.message : "입고 처리 중 오류가 발생했습니다.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!target || !enabled || !locationCode) return null;

  const totalQty = drafts.reduce((sum, item) => sum + item.qty, 0);
  const newSkuCount = drafts.filter((item) => item.currentQty === 0).length;

  return createPortal(
    <div style={{ marginTop: 18, padding: 18, border: "1px solid var(--line)", borderRadius: 14, background: "var(--surface-2)" }}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">ADD PRODUCT TO LOC</p>
          <h3>상품 바코드로 LOC 상품 추가</h3>
          <p className="muted">{locationCode}에 없는 상품을 촬영하면 현재 재고 0인 신규 품목으로 추가하고 바로 입고할 수 있습니다.</p>
        </div>
        <span className="status-badge primary">입고 전용</span>
      </div>

      <BarcodeField
        label="추가할 상품 바코드"
        placeholder="상품 바코드를 스캔하거나 입력하세요"
        value={barcode}
        onSubmit={handleProductScan}
        autoFocus={drafts.length === 0 && candidateMatches.length === 0}
        disabled={busy || candidateMatches.length > 0}
        resetToken={resetToken}
      />

      {drafts.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>상태</th><th>상품</th><th>현재 LOC 재고</th><th>입고 수량</th><th>관리</th></tr></thead>
              <tbody>
                {drafts.map((item) => (
                  <tr key={item.product.id}>
                    <td><span className={`status-badge ${item.currentQty === 0 ? "primary" : "active"}`}>{item.currentQty === 0 ? "신규 LOC 상품" : "기존 상품"}</span></td>
                    <td><strong>{item.product.artist || "아티스트 없음"}</strong><br/><span>{item.product.nameVer || "상품명/버전 없음"}</span><br/><small className="muted">{item.product.pCodeNo || "-"} · {item.product.codeNo || "-"}</small></td>
                    <td><strong>{item.currentQty.toLocaleString()}</strong></td>
                    <td><input style={{ width: 120 }} type="number" min={1} value={item.qty} onChange={(event) => changeQty(item.product.id, event.target.value)} disabled={busy} /></td>
                    <td><button className="button button-danger button-compact" onClick={() => setDrafts((current) => current.filter((draft) => draft.product.id !== item.product.id))} disabled={busy}>제외</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-grid" style={{ marginTop: 14 }}>
            <label>메모(선택)<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="작업 사유 또는 메모" disabled={busy} /></label>
            <div className="resolved-card"><span>입고 예정</span><strong>{drafts.length} SKU / {totalQty.toLocaleString()}개</strong><small>신규 LOC 상품 {newSkuCount} SKU</small></div>
          </div>
          <button className="button button-primary button-full" onClick={() => void confirmAdd()} disabled={busy || drafts.length === 0}>{busy ? "처리 중..." : `${drafts.length} SKU / ${totalQty.toLocaleString()}개 LOC 입고 확정`}</button>
        </div>
      ) : null}

      {feedback ? <div style={{ marginTop: 14 }}><Feedback kind={feedback.kind} title={feedback.title}>{feedback.body}</Feedback></div> : null}

      {candidateMatches.length > 1 ? (
        <MultiProductBarcodePicker
          matches={candidateMatches}
          title="공통 바코드 상품 선택"
          description="이 LOC에 입고할 상품을 복수로 선택하세요. LOC에 없는 상품도 신규 품목으로 추가됩니다."
          confirmLabel="선택 상품 추가"
          busy={busy}
          onConfirm={handleCommonSelection}
          onClose={() => {
            setCandidateMatches([]);
            setBarcode("");
            setResetToken((value) => value + 1);
          }}
        />
      ) : null}
    </div>,
    target,
  );
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

  return (
    <>
      <ScanWorkflowV4 />
      <LocationFirstInboundProductAdder />
    </>
  );
}
