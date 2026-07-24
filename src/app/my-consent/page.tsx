"use client";

import { useCallback, useEffect, useState } from "react";
import { getMyTermsAcceptances, type TermsAcceptanceReceipt } from "@/lib/identity-api";

export default function MyConsentPage() {
  const [items, setItems] = useState<TermsAcceptanceReceipt[]>([]);
  const [selected, setSelected] = useState<TermsAcceptanceReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getMyTermsAcceptances();
      setItems(next);
      setSelected((current) => current ?? next[0] ?? null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "동의 내역을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="page-stack">
      <section>
        <p className="eyebrow">MY CONSENT RECORDS</p>
        <h2>내 동의 내역</h2>
        <p className="muted">본인이 동의한 이용조건 제목, 버전, 동의 일시, 전문 및 동의 확인번호를 확인합니다.</p>
      </section>

      {error ? <p className="inline-error">{error}</p> : null}
      <section className="panel">
        <div className="section-heading">
          <div><p className="eyebrow">RECEIPTS</p><h3>동의 확인증</h3></div>
          <button className="button button-secondary button-compact" onClick={() => void load()}>새로고침</button>
        </div>
        {loading ? <p className="empty-state">동의 내역을 불러오는 중입니다.</p> : null}
        {!loading && items.length === 0 ? <p className="empty-state">저장된 동의 내역이 없습니다.</p> : null}
        {items.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>동의 일시</th><th>이용조건</th><th>버전</th><th>동의 확인번호</th><th>전문</th></tr></thead>
              <tbody>{items.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.acceptedAt).toLocaleString("ko-KR")}</td>
                  <td>{item.termsTitle}</td>
                  <td>{item.termsVersion}</td>
                  <td><strong>{item.confirmationNo}</strong></td>
                  <td><button className="button button-secondary button-compact" onClick={() => setSelected(item)}>조회</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : null}
      </section>

      {selected ? (
        <section className="panel page-stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">CONSENT CERTIFICATE</p>
              <h3>{selected.termsTitle}</h3>
              <p className="muted">확인번호 {selected.confirmationNo} · 버전 {selected.termsVersion} · {new Date(selected.acceptedAt).toLocaleString("ko-KR")}</p>
            </div>
            <button className="button button-secondary button-compact" onClick={() => window.print()}>확인증 인쇄</button>
          </div>
          <div className="metric-grid">
            <article className="metric-card"><span>이용조건 해시</span><strong style={{fontSize:12,wordBreak:"break-all"}}>{selected.termsHash}</strong></article>
            <article className="metric-card"><span>개인정보 안내 버전</span><strong>{selected.privacyNoticeVersion}</strong></article>
            <article className="metric-card"><span>인증 방식</span><strong style={{fontSize:14}}>{selected.authenticationMethod}</strong></article>
          </div>
          <article>
            <h4>{selected.termsTitle}</h4>
            <pre style={{whiteSpace:"pre-wrap",lineHeight:1.65,padding:16,border:"1px solid #dce2e8",borderRadius:12,background:"#fbfcfd"}}>{selected.termsContent}</pre>
          </article>
          <article>
            <h4>{selected.privacyNoticeTitle}</h4>
            <pre style={{whiteSpace:"pre-wrap",lineHeight:1.65,padding:16,border:"1px solid #dce2e8",borderRadius:12,background:"#fbfcfd"}}>{selected.privacyNoticeContent}</pre>
          </article>
        </section>
      ) : null}
    </div>
  );
}
