"use client";

import { useCallback, useEffect, useState } from "react";
import { Feedback, type FeedbackKind } from "@/components/feedback";
import { PermissionGuard } from "@/components/permission-guard";
import { createLocation, listLocations, subscribeToInventory, updateLocation } from "@/lib/inventory-api";
import type { Location, LocationInput } from "@/types/domain";

const emptyForm: LocationInput = { locationCode: "", zone: "", barcodeValue: "" };

function LocationsContent() {
  const [rows, setRows] = useState<Location[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<LocationInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; title: string; body?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setRows(await listLocations(search, true)), [search]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 150); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => subscribeToInventory(() => void load()), [load]);

  function startEdit(location: Location) {
    setEditingId(location.id);
    setForm({ locationCode: location.locationCode, zone: location.zone, barcodeValue: "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    setBusy(true); setFeedback(null);
    try {
      if (editingId) {
        await updateLocation(editingId, { locationCode: form.locationCode, zone: form.zone });
        setFeedback({ kind: "success", title: "로케이션 수정 완료" });
      } else {
        await createLocation(form);
        setFeedback({ kind: "success", title: "로케이션 등록 완료", body: form.locationCode.toUpperCase() });
      }
      setForm(emptyForm); setEditingId(null); await load();
    } catch (cause) {
      setFeedback({ kind: "error", title: "로케이션 저장 실패", body: cause instanceof Error ? cause.message : "오류" });
    } finally { setBusy(false); }
  }

  return <div className="page-stack">
    <section><p className="eyebrow">LOCATION MASTER</p><h2>로케이션 관리</h2><p className="muted">로케이션 코드 자체를 기본 바코드로 사용하거나 별도의 지정 번호를 연결할 수 있습니다.</p></section>
    <section className="panel"><div className="section-heading"><h3>{editingId ? "로케이션 수정" : "신규 로케이션 등록"}</h3>{editingId ? <button className="button button-secondary button-compact" onClick={() => { setEditingId(null); setForm(emptyForm); }}>수정 취소</button> : null}</div>
      <div className="form-grid"><label>로케이션 코드 *<input value={form.locationCode} onChange={(e) => setForm({ ...form, locationCode: e.target.value.toUpperCase() })} placeholder="D1A-01-02-03" /></label><label>구역<input value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value.toUpperCase() })} placeholder="D1A" /></label>
      {!editingId ? <label className="span-two">로케이션 바코드 번호<input value={form.barcodeValue ?? ""} onChange={(e) => setForm({ ...form, barcodeValue: e.target.value })} placeholder="비워두면 로케이션 코드를 사용" /></label> : null}
      <button className="button button-primary span-two" disabled={busy || !form.locationCode.trim()} onClick={() => void save()}>{busy ? "저장 중..." : editingId ? "수정 저장" : "로케이션 등록"}</button></div>
    </section>
    {feedback ? <Feedback kind={feedback.kind} title={feedback.title}>{feedback.body}</Feedback> : null}
    <section className="panel"><div className="section-heading"><h3>등록 로케이션</h3><label className="compact-search">검색<input value={search} onChange={(e) => setSearch(e.target.value)} /></label></div><div className="table-wrap"><table><thead><tr><th>상태</th><th>로케이션</th><th>구역</th><th>관리</th></tr></thead><tbody>{rows.map((location) => <tr key={location.id}><td><span className={`status-badge ${location.active ? "active" : "inactive"}`}>{location.active ? "사용" : "중지"}</span></td><td><strong>{location.locationCode}</strong></td><td>{location.zone}</td><td><div className="row-actions"><button className="button button-secondary button-compact" onClick={() => startEdit(location)}>수정</button><button className="button button-ghost button-compact" onClick={() => void updateLocation(location.id, { active: !location.active }).then(load)}>{location.active ? "비활성화" : "활성화"}</button></div></td></tr>)}</tbody></table></div>{rows.length === 0 ? <p className="empty-state">등록된 로케이션이 없습니다.</p> : null}</section>
  </div>;
}

export default function LocationsPage() { return <PermissionGuard permission="manage_locations"><LocationsContent /></PermissionGuard>; }
