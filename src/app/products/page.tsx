"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CameraSearchField } from "@/components/camera-search-field";
import { Feedback, type FeedbackKind } from "@/components/feedback";
import { PermissionGuard } from "@/components/permission-guard";
import { useUser } from "@/components/user-provider";
import {
  createProduct,
  listProducts,
  subscribeToInventory,
  updateProduct,
} from "@/lib/inventory-api";
import { deleteUnusedProduct } from "@/lib/product-delete-api";
import {
  productCategoryLabel,
  readRememberedCategory,
  rememberCategory,
} from "@/lib/work-scope";
import type { Product, ProductInput } from "@/types/domain";

const emptyForm: ProductInput = {
  pCodeNo: "",
  codeNo: "",
  masterCodeNo: "",
  artist: "",
  nameVer: "",
  productCategory: "ALBUM",
  primaryBarcode: "",
  barcodeSource: "manufacturer",
};

function ProductsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useUser();
  const canDelete = user?.role === "admin" || user?.role === "manager";
  const [rows, setRows] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<ProductInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: FeedbackKind;
    title: string;
    body?: string;
  } | null>(null);
  const returnTo = searchParams.get("returnTo") || "";

  const load = useCallback(
    async () => setRows(await listProducts(search, true)),
    [search],
  );
  useEffect(() => {
    const requestedCategory = searchParams.get("category");
    setForm((value) => ({
      ...value,
      productCategory:
        requestedCategory === "MD"
          ? "MD"
          : requestedCategory === "ALBUM"
            ? "ALBUM"
            : readRememberedCategory("san-wms:product-category"),
    }));
    const barcode = searchParams.get("barcode");
    if (barcode) {
      setForm((value) => ({ ...value, codeNo: barcode, primaryBarcode: barcode }));
    }
  }, [searchParams]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 150);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(
    () =>
      subscribeToInventory(load, { scope: "products", fallbackMs: 120_000 }),
    [load],
  );

  function startEdit(product: Product) {
    setEditingId(product.id);
    setForm({
      pCodeNo: product.pCodeNo,
      codeNo: product.codeNo,
      masterCodeNo: product.masterCodeNo,
      artist: product.artist,
      nameVer: product.nameVer,
      productCategory: product.productCategory ?? "ALBUM",
      primaryBarcode: "",
      barcodeSource: "manufacturer",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    setBusy(true);
    setFeedback(null);
    try {
      if (editingId) {
        await updateProduct(editingId, {
          pCodeNo: form.pCodeNo,
          codeNo: form.codeNo,
          masterCodeNo: form.masterCodeNo,
          artist: form.artist,
          nameVer: form.nameVer,
          productCategory: form.productCategory,
        });
        setFeedback({ kind: "success", title: "상품 수정 완료" });
      } else {
        const codeNo = form.codeNo.trim();
        await createProduct({ ...form, codeNo, primaryBarcode: codeNo });
        if (returnTo) {
          router.push(returnTo);
          return;
        }
        setFeedback({
          kind: "success",
          title: "신규 상품 등록 완료",
          body: `${form.artist} · ${form.nameVer}`,
        });
      }
      rememberCategory("san-wms:product-category", form.productCategory);
      setForm({ ...emptyForm, productCategory: form.productCategory });
      setEditingId(null);
      await load();
    } catch (cause) {
      setFeedback({
        kind: "error",
        title: "상품 저장 실패",
        body: cause instanceof Error ? cause.message : "오류",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeProduct(product: Product) {
    const label = `${product.artist || "아티스트 미등록"} · ${product.nameVer || product.codeNo}`;
    if (
      !window.confirm(
        `${label}\n\n이 상품을 완전히 삭제할까요?\n현재 재고·입출고 이력·재고이관 기록이 있으면 삭제되지 않습니다.`,
      )
    )
      return;
    setDeletingId(product.id);
    setFeedback(null);
    try {
      await deleteUnusedProduct(product.id);
      if (editingId === product.id) {
        setEditingId(null);
        setForm(emptyForm);
      }
      setFeedback({ kind: "success", title: "상품 삭제 완료", body: label });
      await load();
    } catch (cause) {
      setFeedback({
        kind: "error",
        title: "상품 삭제 실패",
        body:
          cause instanceof Error
            ? cause.message
            : "상품을 삭제하지 못했습니다.",
      });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div>
          <p className="eyebrow">PRODUCT MASTER</p>
          <h2>상품 관리</h2>
          <p className="muted">
            신규 상품은 CODE_NO를 대표 상품 바코드로 동시에 등록합니다. 동일한
            CODE_NO·상품 바코드를 여러 세부 버전에 사용할 수 있으며
            상품명/버전으로 구분됩니다.
          </p>
        </div>
        {canDelete ? (
          <Link className="button button-secondary" href="/products/merge">
            중복·오타 상품 병합
          </Link>
        ) : null}
      </section>
      {returnTo ? (
        <div className="feedback feedback-info">
          <strong>재고실사에서 발견한 신규 바코드입니다.</strong>
          <p>상품 등록이 끝나면 원래 실사 화면으로 돌아가 자동 검증합니다.</p>
        </div>
      ) : null}
      <section className="panel">
        <div className="section-heading">
          <div>
            <h3>{editingId ? "상품 정보 수정" : "신규 상품 즉시 등록"}</h3>
          </div>
          {editingId ? (
            <button
              className="button button-secondary button-compact"
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm);
              }}
            >
              수정 취소
            </button>
          ) : null}
        </div>
        <div className="form-grid">
          <label className="span-two">
            상품 구분 *
            <select
              value={form.productCategory}
              onChange={(e) => {
                const value = e.target.value as "ALBUM" | "MD";
                setForm({ ...form, productCategory: value });
                rememberCategory("san-wms:product-category", value);
              }}
            >
              <option value="ALBUM">앨범</option>
              <option value="MD">MD</option>
            </select>
            <small className="muted">
              직접 변경하기 전까지 이 기기에 선택값을 기억합니다.
            </small>
          </label>
          <label>
            P_CODE_NO
            <input
              value={form.pCodeNo}
              onChange={(e) => setForm({ ...form, pCodeNo: e.target.value })}
            />
          </label>
          <label>
            CODE_NO *
            <input
              value={form.codeNo}
              onChange={(e) =>
                setForm({ ...form, codeNo: e.target.value, primaryBarcode: e.target.value })
              }
              autoFocus={Boolean(form.codeNo)}
            />
            {!editingId ? <small className="muted">대표 상품 바코드로 자동 등록됩니다.</small> : null}
          </label>
          <label>
            MASTER_CODE_NO
            <input
              value={form.masterCodeNo}
              onChange={(e) =>
                setForm({ ...form, masterCodeNo: e.target.value })
              }
            />
          </label>
          <label>
            아티스트 *
            <input
              value={form.artist}
              onChange={(e) => setForm({ ...form, artist: e.target.value })}
            />
          </label>
          <label className="span-two">
            상품명 / 버전 *
            <input
              value={form.nameVer}
              onChange={(e) => setForm({ ...form, nameVer: e.target.value })}
            />
          </label>
          <button
            className="button button-primary span-two"
            disabled={
              busy ||
              !form.codeNo.trim() ||
              !form.artist.trim() ||
              !form.nameVer.trim()
            }
            onClick={() => void save()}
          >
            {busy
              ? "저장 중..."
              : editingId
                ? "수정 저장"
                : returnTo
                  ? "상품 등록 후 실사로 돌아가기"
                  : "상품 등록"}
          </button>
        </div>
      </section>
      {feedback ? (
        <Feedback kind={feedback.kind} title={feedback.title}>
          {feedback.body}
        </Feedback>
      ) : null}
      <section className="panel">
        <div className="section-heading">
          <h3>등록 상품</h3>
          <CameraSearchField
            label="검색"
            value={search}
            onChange={setSearch}
            placeholder="바코드, 코드, 아티스트, 상품명"
          />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>상태</th>
                <th>구분</th>
                <th>아티스트</th>
                <th>상품명/버전</th>
                <th>P_CODE</th>
                <th>CODE_NO</th>
                <th>MASTER</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((product) => (
                <tr key={product.id}>
                  <td>
                    <span
                      className={`status-badge ${product.active ? "active" : "inactive"}`}
                    >
                      {product.active ? "사용" : "중지"}
                    </span>
                  </td>
                  <td>
                    <span className="status-badge">
                    {productCategoryLabel[product.productCategory ?? "ALBUM"]}
                    </span>
                  </td>
                  <td>{product.artist}</td>
                  <td>{product.nameVer}</td>
                  <td>{product.pCodeNo}</td>
                  <td>{product.codeNo}</td>
                  <td>{product.masterCodeNo}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="button button-secondary button-compact"
                        onClick={() => startEdit(product)}
                      >
                        수정
                      </button>
                      <button
                        className="button button-ghost button-compact"
                        onClick={() =>
                          void updateProduct(product.id, {
                            active: !product.active,
                          }).then(load)
                        }
                      >
                        {product.active ? "비활성화" : "활성화"}
                      </button>
                      {canDelete ? (
                        <button
                          className="button button-danger button-compact"
                          disabled={deletingId === product.id}
                          onClick={() => void removeProduct(product)}
                        >
                          {deletingId === product.id ? "삭제 중..." : "삭제"}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? (
          <p className="empty-state">등록된 상품이 없습니다.</p>
        ) : null}
      </section>
    </div>
  );
}

export default function ProductsPage() {
  return (
    <PermissionGuard permission="manage_products">
      <ProductsContent />
    </PermissionGuard>
  );
}
