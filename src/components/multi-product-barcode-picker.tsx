"use client";

import { useEffect, useMemo, useState } from "react";
import type { Product, ResolvedBarcode } from "@/types/domain";

const EMPTY_QUANTITIES: Record<string, number> = {};

export interface MultiProductBarcodeSelection {
  match: ResolvedBarcode;
  product: Product;
  qty: number;
}

interface MultiProductBarcodePickerProps {
  matches: ResolvedBarcode[];
  title?: string;
  description?: string;
  confirmLabel?: string;
  initialQuantities?: Record<string, number>;
  maxQuantities?: Record<string, number>;
  busy?: boolean;
  onConfirm: (items: MultiProductBarcodeSelection[]) => void | Promise<void>;
  onClose: () => void;
}

function productFromMatch(match: ResolvedBarcode): Product | null {
  return match.target.type === "product" && "product" in match.target
    ? match.target.product
    : null;
}

export function MultiProductBarcodePicker({
  matches,
  title = "상품을 복수 선택하세요",
  description = "같은 바코드에 연결된 상품 중 작업할 품목을 체크하세요. 수량은 선택 후 품목 목록에서 변경할 수 있습니다.",
  confirmLabel = "선택 상품 적용",
  initialQuantities = EMPTY_QUANTITIES,
  busy = false,
  onConfirm,
  onClose,
}: MultiProductBarcodePickerProps) {
  const products = useMemo(() => {
    const unique = new Map<string, { match: ResolvedBarcode; product: Product }>();
    for (const match of matches) {
      const product = productFromMatch(match);
      if (product?.id && !unique.has(product.id)) unique.set(product.id, { match, product });
    }
    return Array.from(unique.values());
  }, [matches]);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    setSelected(Object.fromEntries(products.map(({ product }) => [product.id, true])));
    setError("");
  }, [products]);

  const selectedCount = products.filter(({ product }) => selected[product.id]).length;

  function setAll(value: boolean) {
    setSelected(Object.fromEntries(products.map(({ product }) => [product.id, value])));
  }

  async function confirm() {
    const items = products
      .filter(({ product }) => selected[product.id])
      .map(({ match, product }) => ({
        match,
        product,
        qty: Math.max(1, Math.trunc(initialQuantities[product.id] ?? 1)),
      }));

    if (items.length === 0) {
      setError("상품을 하나 이상 선택하세요.");
      return;
    }

    setError("");
    await onConfirm(items);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="공통 바코드 상품 복수 선택">
      <section className="selection-modal multi-product-picker">
        <div className="section-heading">
          <div>
            <p className="eyebrow">MULTIPLE PRODUCTS</p>
            <h3>{title}</h3>
            <p className="muted">{description}</p>
          </div>
          <button className="button button-ghost" onClick={onClose} disabled={busy}>닫기</button>
        </div>

        <div className="multi-product-picker-toolbar">
          <div className="row-actions">
            <button className="button button-secondary button-compact" onClick={() => setAll(true)} disabled={busy}>전체 선택</button>
            <button className="button button-ghost button-compact" onClick={() => setAll(false)} disabled={busy}>전체 해제</button>
          </div>
          <strong>{selectedCount} SKU 선택</strong>
        </div>

        <div className="multi-product-picker-list">
          {products.map(({ product }) => {
            const checked = Boolean(selected[product.id]);
            return (
              <article key={product.id} className={`multi-product-picker-row ${checked ? "selected" : ""}`}>
                <label className="multi-product-picker-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => setSelected((current) => ({ ...current, [product.id]: event.target.checked }))}
                    disabled={busy}
                  />
                  <span>
                    <strong>{product.artist || "아티스트 없음"}</strong>
                    <b>{product.nameVer || "상품명/버전 없음"}</b>
                    <small>{product.pCodeNo || "-"} · {product.codeNo || "-"}</small>
                  </span>
                </label>
              </article>
            );
          })}
        </div>

        {error ? <p className="inline-error">{error}</p> : null}
        <button className="button button-primary button-full" onClick={() => void confirm()} disabled={busy || selectedCount === 0}>
          {busy ? "적용 중..." : confirmLabel}
        </button>
      </section>
    </div>
  );
}
