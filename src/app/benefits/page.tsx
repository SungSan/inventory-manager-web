"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BenefitFeatureGuard } from "@/components/benefit-feature-guard";
import { Feedback, type FeedbackKind } from "@/components/feedback";
import {
  createBenefitEvent,
  listBenefitEvents,
  listBenefitOrderImports,
  listBenefitRules,
  updateBenefitEvent,
  type BenefitEvent,
} from "@/lib/benefit-api";

interface EventStats { rules: number; rows: number; }

function BenefitsContent() {
  const [events, setEvents] = useState<BenefitEvent[]>([]);
  const [stats, setStats] = useState<Record<string, EventStats>>({});
  const [filter, setFilter] = useState<"ALL" | "ACTIVE" | "ENDED">("ACTIVE");
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; title: string; body?: string } | null>(null);
  const [form, setForm] = useState({ name: "", salesStartAt: "", salesEndAt: "", salesChannel: "", isFansign: false });

  const load = useCallback(async () => {
    const next = await listBenefitEvents();
    setEvents(next);
    const pairs = await Promise.all(next.map(async (event) => {
      const [rules, imports] = await Promise.all([listBenefitRules(event.id), listBenefitOrderImports(event.id)]);
      return [event.id, { rules: rules.length, rows: imports[0]?.rowCount ?? 0 }] as const;
    }));
    setStats(Object.fromEntries(pairs));
  }, []);

  useEffect(() => { void load().catch((cause) => setFeedback({ kind: "error", title: "행사 목록 로드 실패", body: cause instanceof Error ? cause.message : "오류" })); }, [load]);

  const visible = useMemo(() => events.filter((event) => filter === "ALL" || event.status === filter), [events, filter]);

  async function create() {
    if (!form.name.trim() || !form.salesStartAt || !form.salesEndAt || !form.salesChannel.trim()) return;
    setBusy(true); setFeedback(null);
    try {
      const created = await createBenefitEvent(form);
      setFeedback({ kind: "success", title: "행사 생성 완료", body: `${created.name} 행사를 생성했습니다.` });
      setForm({ name: "", salesStartAt: "", salesEndAt: "", salesChannel: "", isFansign: false });
      setShowCreate(false); await load();
    } catch (cause) { setFeedback({ kind: "error", title: "행사 생성 실패", body: cause instanceof Error ? cause.message : "오류" }); }
    finally { setBusy(false); }
  }

  async function toggleStatus(event: BenefitEvent) {
    setBusy(true); setFeedback(null);
    try { await updateBenefitEvent(event.id, { status: event.status === "ACTIVE" ? "ENDED" : "ACTIVE" }); await load(); }
    catch (cause) { setFeedback({ kind: "error", title: "상태 변경 실패", body: cause instanceof Error ? cause.message : "오류" }); }
    finally { setBusy(false); }
  }

  return <div className="page-stack">
    <section className="section-heading">
      <div><p className="eyebrow">BENEFIT AUTOMATION</p><h2>특전 자동계산</h2><p className="muted">주문자료와 행사 규칙만으로 특전 수량·사인회 현장수령·친사폴을 계산합니다. 이 기능은 SAN WMS 재고/LOC/상품 데이터에 접근하지 않으며 계산으로 재고가 변하지 않습니다.</p></div>
      <button className="button button-primary" onClick={() => setShowCreate((value) => !value)}>{showCreate ? "행사 생성 닫기" : "+ 행사 생성"}</button>
    </section>

    {feedback ? <Feedback kind={feedback.kind} title={feedback.title}>{feedback.body}</Feedback> : null}

    {showCreate ? <section className="panel">
      <div className="section-heading"><div><h3>행사 생성</h3><p className="muted">사인회 행사를 선택하면 상세 화면에서 당첨자 파일을 추가 업로드할 수 있습니다.</p></div></div>
      <div className="form-grid">
        <label className="span-two">행사명<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: CRAVITY 0815 영통/대면" /></label>
        <label>판매 시작일<input type="date" value={form.salesStartAt} onChange={(e) => setForm({ ...form, salesStartAt: e.target.value })} /></label>
        <label>판매 종료일<input type="date" value={form.salesEndAt} onChange={(e) => setForm({ ...form, salesEndAt: e.target.value })} /></label>
        <label className="span-two">판매채널/쇼핑몰<input value={form.salesChannel} onChange={(e) => setForm({ ...form, salesChannel: e.target.value })} placeholder="예: SOUNDWAVE" /></label>
        <label className="checkbox-label span-two"><input type="checkbox" checked={form.isFansign} onChange={(e) => setForm({ ...form, isFansign: e.target.checked })} />사인회 행사</label>
        {form.isFansign ? <div className="feedback feedback-info span-two"><strong>사인회 처리</strong><p>행사 생성 후 당첨자 파일을 업로드하면 몰 + 주문번호 + 자동 분류 행사유형 기준으로 대조합니다. 당첨 유형의 물류 출고수량만 1장 차감하며 특전 계산은 원래 구매수량을 유지합니다.</p></div> : null}
        <button className="button button-primary span-two" disabled={busy || !form.name.trim() || !form.salesStartAt || !form.salesEndAt || !form.salesChannel.trim()} onClick={() => void create()}>{busy ? "생성 중..." : "행사 생성"}</button>
      </div>
    </section> : null}

    <section className="panel">
      <div className="section-heading"><h3>행사 목록</h3><div className="row-actions">
        {(["ACTIVE","ENDED","ALL"] as const).map((value) => <button key={value} className={`button button-compact ${filter === value ? "button-primary" : "button-secondary"}`} onClick={() => setFilter(value)}>{value === "ACTIVE" ? "진행 중" : value === "ENDED" ? "종료" : "전체"}</button>)}
      </div></div>
      <div className="table-wrap"><table><thead><tr><th>상태</th><th>행사명</th><th>판매기간</th><th>판매채널</th><th>행사 유형</th><th>특전 조건</th><th>업로드 주문</th><th>관리</th></tr></thead>
        <tbody>{visible.map((event) => <tr key={event.id}>
          <td><span className={`status-badge ${event.status === "ACTIVE" ? "active" : "inactive"}`}>{event.status === "ACTIVE" ? "진행 중" : "종료"}</span></td>
          <td><strong>{event.name}</strong></td><td>{event.salesStartAt} ~ {event.salesEndAt}</td><td>{event.salesChannel}</td><td>{event.isFansign ? "사인회" : "일반"}</td>
          <td>{stats[event.id]?.rules ?? 0}개</td><td>{(stats[event.id]?.rows ?? 0).toLocaleString()}행</td>
          <td><div className="row-actions"><Link className="button button-primary button-compact" href={`/benefits/${event.id}`}>상세</Link><button className="button button-secondary button-compact" disabled={busy} onClick={() => void toggleStatus(event)}>{event.status === "ACTIVE" ? "종료 처리" : "진행 재개"}</button></div></td>
        </tr>)}</tbody></table></div>
      {visible.length === 0 ? <p className="empty-state">표시할 행사가 없습니다.</p> : null}
    </section>
  </div>;
}

export default function BenefitsPage() { return <BenefitFeatureGuard><BenefitsContent /></BenefitFeatureGuard>; }
