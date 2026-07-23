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
  description = "같은 바코드에 연결된 상품 중 필요한 품목을 체크하고 수량을 각각 입력하세요.",
  confirmLabel = "선택 상품 적용",
  initialQuantities = EMPTY_QUANTITIES,
  maxQuantities = EMPTY_QUANTITIES,
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
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    const nextSelected: Record<string, boolean> = {};
    const nextQuantities: Record<string, number> = {};
    for (const { product } of products) {
      nextSelected[product.id] = true;
      const initial = Math.max(1, Math.trunc(initialQuantities[product.id] ?? 1));
      const max = maxQuantities[product.id];
      nextQuantities[product.id] = max === undefined ? initial : Math.min(Math.max(1, max), initial);
    }
    setSelected(nextSelected);
    setQuantities(nextQuantities);
    setError("");
  }, [initialQuantities, maxQuantities, products]);

  const selectedCount = products.filter(({ product }) => selected[product.id]).length;
  const selectedQty = products.reduce(
    (sum, { product }) => sum + (selected[product.id] ? quantities[product.id] ?? 0 : 0),
    0,
  );

  function setAll(value: boolean) {
    setSelected(Object.fromEntries(products.map(({ product }) => [product.id, value])));
  }

  function changeQuantity(productId: string, raw: string) {
    const parsed = Number(raw);
    const max = maxQuantities[productId];
    let qty = Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : 1;
    if (max !== undefined) qty = Math.min(Math.max(1, max), qty);
    setQuantities((current) => ({ ...current, [productId]: qty }));
  }

  async function confirm() {
    const items = products
      .filter(({ product }) => selected[product.id])
      .map(({ match, product }) => ({
        match,
        product,
        qty: Math.max(1, Math.trunc(quantities[product.id] ?? 1)),
      }));

    if (items.length === 0) {
      setError("상품을 하나 이상 선택하세요.");
      return;
    }

    const invalid = items.find(({ product, qty }) => {
      const max = maxQuantities[product.id];
      return qty < 1 || (max !== undefined && qty > max);
    });
    if (invalid) {
      setError(`${invalid.product.artist} · ${invalid.product.nameVer}의 수량을 확인하세요.`);
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
          <strong>{selectedCount} SKU / {selectedQty.toLocaleString()}개</strong>
        </div>

        <div className="multi-product-picker-list">
          {products.map(({ product }) => {
            const checked = Boolean(selected[product.id]);
            const max = maxQuantities[product.id];
            return (
              <article key={product.id} className={`multi-product-picker-row ${checked ? "selected" : ""}`}>
                <label className="multi-product-picker-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => setSelected((current) => ({ ...current, [product.id]: event.target.checked }))}
                    disabled={busy || max === 0}
                  />
                  <span>
                    <strong>{product.artist || "아티스트 없음"}</strong>
                    <b>{product.nameVer || "상품명/버전 없음"}</b>
                    <small>{product.pCodeNo || "-"} · {product.codeNo || "-"}</small>
                  </span>
                </label>
                <label className="multi-product-picker-qty">
                  수량
                  <input
                    type="number"
                    min={1}
                    max={max}
                    value={quantities[product.id] ?? 1}
                    onChange={(event) => changeQuantity(product.id, event.target.value)}
                    disabled={!checked || busy || max === 0}
                  />
                  {max !== undefined ? <small>최대 {max.toLocaleString()}개</small> : null}
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
