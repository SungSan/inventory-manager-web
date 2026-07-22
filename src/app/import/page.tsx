"use client";

import { useState } from "react";
import { Feedback, type FeedbackKind } from "@/components/feedback";
import { PermissionGuard } from "@/components/permission-guard";
import { parseInventoryCsv, type InventoryCsvLayout } from "@/lib/csv";
import { downloadDemoBackup, importInventoryRows, resetDemo } from "@/lib/inventory-api";
import { isDemoMode } from "@/lib/supabase";
import type { ImportInventoryRow, ImportResult } from "@/types/domain";

const sample = `D1A-01-02-03,P-10003,8801234567800,,IVE,3RD EP / VER.A,12`;

type CsvEncodingMode = "auto" | "utf-8" | "euc-kr";
type DetectedCsvEncoding = "UTF-8" | "CP949/EUC-KR";

function layoutLabel(layout: InventoryCsvLayout | null): string {
  if (layout === "LEGACY_7_COLUMNS") return "헤더 없는 기존 A~G 양식";
  if (layout === "HEADER") return "헤더 포함 CSV 양식";
  return "미분석";
}

function cleanDecodedText(value: string): string {
  return value.replace(/^\uFEFF/, "").replace(/\u0000/g, "");
}

function decodeCsvBuffer(
  buffer: ArrayBuffer,
  mode: CsvEncodingMode,
): { content: string; detected: DetectedCsvEncoding } {
  if (mode === "utf-8") {
    return {
      content: cleanDecodedText(new TextDecoder("utf-8").decode(buffer)),
      detected: "UTF-8",
    };
  }

  if (mode === "euc-kr") {
    return {
      content: cleanDecodedText(new TextDecoder("euc-kr").decode(buffer)),
      detected: "CP949/EUC-KR",
    };
  }

  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { content: cleanDecodedText(utf8), detected: "UTF-8" };
  } catch {
    const cp949 = new TextDecoder("euc-kr").decode(buffer);
    return { content: cleanDecodedText(cp949), detected: "CP949/EUC-KR" };
  }
}

function assertReadableCsv(content: string): void {
  const replacementCount = (content.match(/\uFFFD/g) ?? []).length;
  if (replacementCount > 0) {
    throw new Error(
      `한글이 깨진 문자(�)가 ${replacementCount}개 발견됐습니다. 깨진 내용을 붙여넣지 말고 원본 CSV 파일을 업로드한 뒤 인코딩을 자동 또는 CP949로 선택하세요.`,
    );
  }
}

function ImportContent() {
  const [text, setText] = useState(sample);
  const [rows, setRows] = useState<ImportInventoryRow[]>([]);
  const [layout, setLayout] = useState<InventoryCsvLayout | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [encodingMode, setEncodingMode] = useState<CsvEncodingMode>("auto");
  const [detectedEncoding, setDetectedEncoding] = useState<DetectedCsvEncoding | "">("");
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; title: string; body?: string } | null>(null);

  function resetParsedState(): void {
    setRows([]);
    setLayout(null);
    setResult(null);
  }

  function preview(content = text, encoding = detectedEncoding) {
    try {
      assertReadableCsv(content);
      const parsed = parseInventoryCsv(content);
      setRows(parsed.rows);
      setLayout(parsed.layout);
      setFeedback({
        kind: "success",
        title: "CSV 분석 완료",
        body: `${encoding ? `${encoding} · ` : ""}${layoutLabel(parsed.layout)} · ${parsed.rows.length}개 행`,
      });
    } catch (cause) {
      setRows([]);
      setLayout(null);
      setFeedback({ kind: "error", title: "CSV 분석 실패", body: cause instanceof Error ? cause.message : "오류" });
    }
  }

  async function loadCsvFile(file: File, mode: CsvEncodingMode): Promise<void> {
    try {
      const buffer = await file.arrayBuffer();
      const decoded = decodeCsvBuffer(buffer, mode);
      setText(decoded.content);
      setDetectedEncoding(decoded.detected);
      resetParsedState();
      preview(decoded.content, decoded.detected);
    } catch (cause) {
      resetParsedState();
      setDetectedEncoding("");
      setFeedback({
        kind: "error",
        title: "CSV 파일 읽기 실패",
        body: cause instanceof Error ? cause.message : "파일을 읽지 못했습니다.",
      });
    }
  }

  async function runImport() {
    setBusy(true);
    setResult(null);
    try {
      assertReadableCsv(text);
      const parsed = parseInventoryCsv(text);
      setRows(parsed.rows);
      setLayout(parsed.layout);
      const imported = await importInventoryRows(parsed.rows);
      setResult(imported);
      setFeedback({
        kind: "success",
        title: "데이터 이전 완료",
        body: `${imported.rowsProcessed}개 행 처리 · 상품명/버전 및 로케이션별 재고 유지`,
      });
    } catch (cause) {
      setFeedback({ kind: "error", title: "데이터 이전 실패", body: cause instanceof Error ? cause.message : "오류" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <section>
        <p className="eyebrow">MIGRATION</p>
        <h2>Google Sheets 데이터 이전</h2>
        <p className="muted">
          현재 사용 중인 헤더 없는 A~G 양식을 그대로 지원합니다. C열 CODE_NO는 상품 바코드로,
          A열 LOCATION은 로케이션 바코드로 자동 등록됩니다.
        </p>
      </section>

      <section className="panel">
        <h3>현재 사용 중인 7열 양식</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>A</th><th>B</th><th>C</th><th>D</th><th>E</th><th>F</th><th>G</th></tr></thead>
            <tbody><tr><td>LOCATION</td><td>P_CODE_NO</td><td>CODE_NO/상품바코드</td><td>MASTER_CODE_NO</td><td>ARTIST</td><td>상품명/버전</td><td>QTY</td></tr></tbody>
          </table>
        </div>
        <p className="muted small">헤더가 있어도 되고 없어도 됩니다. 같은 CODE_NO가 여러 상품명/버전에 연결되어 있으면 각각 별도 상품으로 유지됩니다.</p>
      </section>

      <section className="panel form-stack">
        <div className="field-grid two">
          <label>
            CSV 파일
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setSelectedFile(file);
                if (!file) return;
                void loadCsvFile(file, encodingMode);
              }}
            />
          </label>
          <label>
            파일 인코딩
            <select
              value={encodingMode}
              onChange={(event) => {
                const nextMode = event.target.value as CsvEncodingMode;
                setEncodingMode(nextMode);
                if (selectedFile) void loadCsvFile(selectedFile, nextMode);
              }}
            >
              <option value="auto">자동 감지 권장</option>
              <option value="utf-8">UTF-8</option>
              <option value="euc-kr">CP949 / EUC-KR</option>
            </select>
          </label>
        </div>
        <p className="muted small">
          엑셀에서 저장한 한글 CSV는 보통 CP949입니다. 자동 감지가 실패할 때만 CP949 / EUC-KR을 직접 선택하세요.
          {detectedEncoding ? ` 현재 파일: ${detectedEncoding}` : ""}
        </p>
        <label>
          CSV 내용
          <textarea
            rows={12}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setDetectedEncoding("");
              resetParsedState();
            }}
          />
        </label>
        <div className="action-row">
          <button className="button button-secondary" onClick={() => preview()}>미리보기</button>
          <button className="button button-primary" disabled={busy} onClick={() => void runImport()}>
            {busy ? "이전 중..." : "현재 재고로 가져오기"}
          </button>
        </div>
      </section>

      {feedback ? <Feedback kind={feedback.kind} title={feedback.title}>{feedback.body}</Feedback> : null}

      {layout ? (
        <section className="metric-grid">
          <article className="metric-card"><span>인식 양식</span><strong className="metric-text">{layoutLabel(layout)}</strong></article>
          <article className="metric-card"><span>문자 인코딩</span><strong className="metric-text">{detectedEncoding || "직접 입력"}</strong></article>
          <article className="metric-card"><span>미리보기 행</span><strong>{rows.length}</strong></article>
        </section>
      ) : null}

      {result ? (
        <section className="metric-grid">
          <article className="metric-card"><span>처리 행</span><strong>{result.rowsProcessed}</strong></article>
          <article className="metric-card"><span>신규 상품</span><strong>{result.productsCreated}</strong></article>
          <article className="metric-card"><span>신규 로케이션</span><strong>{result.locationsCreated}</strong></article>
          <article className="metric-card"><span>신규 바코드 연결</span><strong>{result.barcodesCreated}</strong></article>
        </section>
      ) : null}

      {rows.length ? (
        <section className="panel">
          <div className="section-heading">
            <div><h3>미리보기</h3><p className="muted small">상품명/버전과 자동 등록될 상품 바코드를 확인하세요.</p></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>LOCATION</th><th>P_CODE</th><th>CODE_NO</th><th>ARTIST</th><th>상품명/버전</th><th>QTY</th><th>상품바코드</th></tr></thead>
              <tbody>
                {rows.slice(0, 100).map((row, index) => (
                  <tr key={`${row.locationCode}-${row.codeNo}-${row.nameVer}-${index}`}>
                    <td>{row.locationCode}</td><td>{row.pCodeNo}</td><td>{row.codeNo}</td><td>{row.artist}</td>
                    <td>{row.nameVer || <span className="inline-error">비어 있음</span>}</td><td>{row.qty}</td><td><code>{row.productBarcode}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {isDemoMode() ? (
        <section className="panel danger-zone">
          <h3>데모 데이터 관리</h3>
          <p className="muted">기존 잘못된 이전 결과가 남아 있다면 데모 초기화 후 CSV를 다시 가져오는 것이 가장 정확합니다.</p>
          <div className="action-row">
            <button className="button button-secondary" onClick={downloadDemoBackup}>JSON 백업</button>
            <button className="button button-danger" onClick={() => { if (window.confirm("데모 데이터를 모두 초기화할까요?")) resetDemo(); }}>데모 초기화</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default function ImportPage() {
  return <PermissionGuard permission="import_data"><ImportContent /></PermissionGuard>;
}
