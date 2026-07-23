"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BarcodeField } from "@/components/barcode-field";
import { MultiProductBarcodePicker, type MultiProductBarcodeSelection } from "@/components/multi-product-barcode-picker";
import { resolveBarcodeCandidates } from "@/lib/inventory-api";
import { getSupabaseClient } from "@/lib/supabase";
import type { Product, ResolvedBarcode } from "@/types/domain";

interface CountItem {
  productId: string;
  artist: string;
  nameVer: string;
  codeNo: string;
  systemQty: number;
  countedQty: number | null;
  verifiedAt?: string;
}
interface CountDetail {
  locationCode: string;
  status: string;
  items: CountItem[];
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(object) : []; }
function string(value: unknown): string { return value == null ? "" : String(value); }
function number(value: unknown): number { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; }
function product(match: ResolvedBarcode): Product | null { return match.target.type === "product" && "product" in match.target ? match.target.product : null; }

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase 연결 설정을 확인하세요.");
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
function mapDetail(value: unknown): CountDetail {
  const data = object(value);
  return {
    locationCode: string(data.location_code), status: string(data.status),
    items: array(data.items).map((item) => ({
      productId: string(item.product_id), artist: string(item.artist), nameVer: string(item.name_ver), codeNo: string(item.code_no),
      systemQty: number(item.system_qty), countedQty: item.counted_qty == null ? null : number(item.counted_qty), verifiedAt: item.verified_at ? string(item.verified_at) : undefined,
    })),
  };
}

export function StocktakeVerificationEnhancer({ sessionId, locationId }: { sessionId: string; locationId: string }) {
  const router = useRouter();
  const [target, setTarget] = useState<Element | null>(null);
  const [detail, setDetail] = useState<CountDetail | null>(null);
  const [barcode, setBarcode] = useState("");
  const [resetToken, setResetToken] = useState(0);
  const [matches, setMatches] = useState<ResolvedBarcode[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const data = await rpc<unknown>("get_inventory_count_location", { p_session_id: sessionId, p_location_id: locationId });
    setDetail(mapDetail(data));
  }, [locationId, sessionId]);

  useEffect(() => {
    setTarget(document.querySelector(".page-stack"));
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "실사 검증 정보를 불러오지 못했습니다."));
  }, [load]);

  async function verifySelections(selections: MultiProductBarcodeSelection[], scanned: string) {
    if (!detail) return;
    setBusy(true); setError(""); setMessage("");
    try {
      let added = false;
      for (const selection of selections) {
        const item = selection.product;
        if (!detail.items.some((row) => row.productId === item.id)) {
          if (!window.confirm(`${item.artist || "아티스트 없음"} · ${item.nameVer || item.codeNo}\n\n현재 ${detail.locationCode} 전산 재고에는 없는 상품입니다. 실사 목록에 추가할까요?`)) continue;
          await rpc("add_inventory_count_product", { p_session_id: sessionId, p_location_id: locationId, p_product_id: item.id });
          added = true;
        }
        await rpc("verify_inventory_count_product", { p_session_id: sessionId, p_location_id: locationId, p_product_id: item.id, p_barcode_value: scanned });
      }
      await load();
      setMessage("상품 바코드 실물 검증을 완료했습니다.");
      setBarcode(""); setMatches([]); setResetToken((value) => value + 1);
      if (added) window.setTimeout(() => window.location.reload(), 350);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "바코드 검증에 실패했습니다."); }
    finally { setBusy(false); }
  }

  const scan = useCallback(async (value: string): Promise<boolean> => {
    if (!detail) return false;
    setBusy(true); setError(""); setMessage("");
    try {
      const candidates = (await resolveBarcodeCandidates(value, "product", "STOCKTAKE_PHYSICAL_VERIFY")).filter((match) => product(match));
      if (candidates.length === 0) {
        if (window.confirm(`등록되지 않은 바코드입니다.\n\n${value}\n\n신규 상품 등록 화면으로 이동할까요?`)) router.push(`/products?barcode=${encodeURIComponent(value)}`);
        return true;
      }
      if (candidates.length > 1) { setMatches(candidates); setBarcode(value); return true; }
      const selected = product(candidates[0]);
      if (!selected) throw new Error("상품 정보를 읽지 못했습니다.");
      await verifySelections([{ match: candidates[0], product: selected, qty: 1 }], value);
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "상품 바코드를 확인하지 못했습니다."); return false; }
    finally { setBusy(false); }
  }, [detail, router]);

  const verified = detail?.items.filter((item) => item.verifiedAt).length ?? 0;
  const unverified = detail?.items.filter((item) => (item.countedQty ?? item.systemQty) > 0 && !item.verifiedAt) ?? [];

  useEffect(() => {
    const apply = () => {
      document.querySelectorAll<HTMLElement>("section.panel").forEach((section) => {
        if (section.textContent?.includes("전산에 없는 실물 상품 추가")) section.style.display = "none";
      });
      const complete = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("로케이션 실사 완료"));
      if (complete && unverified.length > 0) complete.title = `바코드 미검증 상품 ${unverified.length}개가 남아 있습니다.`;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [unverified.length]);

  if (!target || !detail) return null;
  return createPortal(<>
    <section className="panel stocktake-verification-panel">
      <div className="section-heading"><div><p className="eyebrow">PHYSICAL BARCODE CHECK</p><h3>상품 바코드 실물 검증</h3><p className="muted">실제 상품 바코드를 먼저 스캔한 뒤 수량을 입력하세요. 실제 수량이 0인 품목은 검증하지 않아도 됩니다.</p></div><strong>{verified}/{detail.items.length} 검증</strong></div>
      {error ? <p className="inline-error">{error}</p> : null}{message ? <p className="feedback feedback-success">{message}</p> : null}
      <BarcodeField label="실물 상품 바코드" placeholder="상품을 하나씩 스캔하세요" value={barcode} onSubmit={scan} disabled={busy || detail.status !== "IN_PROGRESS"} resetToken={resetToken} />
      {unverified.length > 0 ? <div className="stocktake-unverified-list"><strong>미검증 {unverified.length}개</strong>{unverified.slice(0, 12).map((item) => <span key={item.productId}>{item.artist || "아티스트 없음"} · {item.nameVer || item.codeNo}</span>)}{unverified.length > 12 ? <small>외 {unverified.length - 12}개</small> : null}</div> : <p className="feedback feedback-success">현재 품목의 바코드 검증이 완료되었습니다.</p>}
    </section>
    {matches.length > 1 ? <MultiProductBarcodePicker matches={matches} title="실사할 상품 선택" description="스캔한 공통 바코드에 연결된 실제 상품을 선택하세요." confirmLabel="선택 상품 검증" busy={busy} onConfirm={(items) => verifySelections(items, barcode)} onClose={() => { setMatches([]); setBarcode(""); setResetToken((value) => value + 1); }} /> : null}
  </>, target);
}
