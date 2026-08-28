"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getDashboardFlowStats,
  getDashboardMetrics,
  getFacilityDashboardMetrics,
  getFacilityFlowSummaries,
  type DashboardFlowPeriod,
  type DashboardFlowStats,
  type DashboardMetrics,
  type FacilityDashboardMetrics,
  type FacilityFlowSummaries,
} from "@/lib/dashboard-api";
import { listScanEvents, subscribeToInventory } from "@/lib/inventory-api";
import type { ScanEvent } from "@/types/domain";
import styles from "./dashboard.module.css";

const emptyMetrics: DashboardMetrics = {
  totalQty: 0,
  skuCount: 0,
  locationCount: 0,
  lowStock: 0,
};
const emptyFacilityMetrics: FacilityDashboardMetrics = {
  DAEJA: { ...emptyMetrics },
  GWANSAN: { ...emptyMetrics },
  UNASSIGNED: { ...emptyMetrics },
};
const emptyFacilityFlow: FacilityFlowSummaries = {
  DAEJA: { inboundQty: 0, outboundQty: 0, inboundCount: 0, outboundCount: 0 },
  GWANSAN: { inboundQty: 0, outboundQty: 0, inboundCount: 0, outboundCount: 0 },
  UNASSIGNED: {
    inboundQty: 0,
    outboundQty: 0,
    inboundCount: 0,
    outboundCount: 0,
  },
};

const periodOptions: Array<{ value: DashboardFlowPeriod; label: string }> = [
  { value: "DAY", label: "일간" },
  { value: "WEEK", label: "주간" },
  { value: "MONTH", label: "월간" },
  { value: "YEAR", label: "연간" },
];

function kstToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftAnchor(
  anchor: string,
  period: DashboardFlowPeriod,
  amount: number,
): string {
  const [year, month, day] = anchor.split("-").map(Number);
  const date = new Date(Date.UTC(year, Math.max(0, month - 1), day || 1));

  if (period === "DAY") date.setUTCDate(date.getUTCDate() + amount);
  if (period === "WEEK") date.setUTCDate(date.getUTCDate() + amount * 7);
  if (period === "MONTH") {
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + amount);
  }
  if (period === "YEAR") {
    date.setUTCMonth(0, 1);
    date.setUTCFullYear(date.getUTCFullYear() + amount);
  }

  return date.toISOString().slice(0, 10);
}

function currentPeriodLabel(period: DashboardFlowPeriod): string {
  if (period === "DAY") return "오늘";
  if (period === "WEEK") return "이번 주";
  if (period === "MONTH") return "이번 달";
  return "올해";
}

function fallbackPeriodLabel(
  period: DashboardFlowPeriod,
  anchor: string,
): string {
  if (period === "MONTH") return anchor.slice(0, 7);
  if (period === "YEAR") return anchor.slice(0, 4);
  return anchor;
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<DashboardMetrics>(emptyMetrics);
  const [facilityOverview, setFacilityOverview] =
    useState<FacilityDashboardMetrics>(emptyFacilityMetrics);
  const [facilityFlow, setFacilityFlow] =
    useState<FacilityFlowSummaries>(emptyFacilityFlow);
  const [scans, setScans] = useState<ScanEvent[]>([]);
  const [overviewError, setOverviewError] = useState("");
  const [period, setPeriod] = useState<DashboardFlowPeriod>("DAY");
  const [anchorDate, setAnchorDate] = useState(kstToday);
  const [flow, setFlow] = useState<DashboardFlowStats | null>(null);
  const [flowError, setFlowError] = useState("");
  const [flowLoading, setFlowLoading] = useState(true);
  const flowRequestId = useRef(0);

  const loadOverview = useCallback(async () => {
    try {
      const [metrics, facilityMetrics, scanRows] = await Promise.all([
        getDashboardMetrics(),
        getFacilityDashboardMetrics(),
        listScanEvents("", "ALL", 100),
      ]);
      setOverview(metrics);
      setFacilityOverview(facilityMetrics);
      setScans(scanRows);
      setOverviewError("");
    } catch (cause) {
      setOverviewError(
        cause instanceof Error
          ? cause.message
          : "재고 현황을 불러오지 못했습니다.",
      );
    }
  }, []);

  const loadFlow = useCallback(async () => {
    const requestId = ++flowRequestId.current;
    setFlowLoading(true);
    try {
      const result = await getDashboardFlowStats(period, anchorDate);
      if (requestId !== flowRequestId.current) return;
      setFlow(result);
      setFacilityFlow(
        await getFacilityFlowSummaries(result.startDate, result.endDate),
      );
      setFlowError("");
    } catch (cause) {
      if (requestId !== flowRequestId.current) return;
      setFlowError(
        cause instanceof Error
          ? cause.message
          : "입출고 현황을 불러오지 못했습니다.",
      );
    } finally {
      if (requestId === flowRequestId.current) setFlowLoading(false);
    }
  }, [anchorDate, period]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);
  useEffect(() => {
    void loadFlow();
  }, [loadFlow]);

  useEffect(
    () =>
      subscribeToInventory(
        () => {
          void loadOverview();
          void loadFlow();
        },
        { scope: "dashboard", fallbackMs: 60_000 },
      ),
    [loadFlow, loadOverview],
  );

  const metrics = useMemo(
    () => ({
      ...overview,
      scanFailures: scans.filter((item) => item.result !== "SUCCESS").length,
    }),
    [overview, scans],
  );

  const maxFlowQty = useMemo(
    () =>
      Math.max(
        1,
        ...(flow?.series.flatMap((item) => [
          item.inboundQty,
          item.outboundQty,
        ]) ?? [0]),
      ),
    [flow],
  );

  const periodLabel =
    flow?.periodLabel ?? fallbackPeriodLabel(period, anchorDate);

  function selectPeriod(next: DashboardFlowPeriod) {
    setPeriod(next);
  }

  function movePeriod(amount: number) {
    setAnchorDate((current) => shiftAnchor(current, period, amount));
  }

  function resetPeriod() {
    setAnchorDate(kstToday());
  }

  return (
    <div className="page-stack">
      <section>
        <p className="eyebrow">OVERVIEW</p>
        <h2>실시간 재고 현황</h2>
      </section>
      {overviewError ? <p className="inline-error">{overviewError}</p> : null}
      <section className={styles.facilityGrid}>
        {(
          [
            ["DAEJA", "대자동"],
            ["GWANSAN", "관산동"],
          ] as const
        ).map(([key, label]) => (
          <article className={`panel ${styles.facilityPanel}`} key={key}>
            <h3>{label}</h3>
            <div className={styles.facilityMetricGrid}>
              <div>
                <span>총 재고</span>
                <strong>
                  {facilityOverview[key].totalQty.toLocaleString()}
                </strong>
              </div>
              <div>
                <span>활성 상품</span>
                <strong>
                  {facilityOverview[key].skuCount.toLocaleString()}
                </strong>
              </div>
              <div>
                <span>활성 로케이션</span>
                <strong>
                  {facilityOverview[key].locationCount.toLocaleString()}
                </strong>
              </div>
              <div>
                <span>5개 이하</span>
                <strong>
                  {facilityOverview[key].lowStock.toLocaleString()}
                </strong>
              </div>
            </div>
          </article>
        ))}
      </section>
      {facilityOverview.UNASSIGNED.locationCount > 0 ? (
        <p className="inline-error">
          사업장 미지정 로케이션{" "}
          {facilityOverview.UNASSIGNED.locationCount.toLocaleString()}개가
          집계에서 제외되어 있습니다.
        </p>
      ) : null}

      <section className={`panel ${styles.flowPanel}`}>
        <div className={styles.flowHeader}>
          <div>
            <p className="eyebrow">LIVE FLOW</p>
            <h3>실시간 입출고 현황</h3>
            <p className="muted">
              한국시간 기준 · 유효한 입고/출고 거래를 기간별로 집계합니다.
            </p>
          </div>
          <span className={styles.liveBadge}>
            <span className={styles.liveDot} />
            실시간 갱신
          </span>
        </div>

        <div
          className={styles.periodTabs}
          role="tablist"
          aria-label="입출고 조회 기간"
        >
          {periodOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={period === option.value}
              className={`${styles.periodTab} ${period === option.value ? styles.periodTabActive : ""}`}
              onClick={() => selectPeriod(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className={styles.periodControls}>
          <div className={styles.periodNavigation}>
            <button
              type="button"
              className="button button-secondary button-compact"
              onClick={() => movePeriod(-1)}
            >
              ← 이전
            </button>
            <strong className={styles.periodLabel}>{periodLabel}</strong>
            <button
              type="button"
              className="button button-secondary button-compact"
              onClick={() => movePeriod(1)}
            >
              다음 →
            </button>
            <button
              type="button"
              className="button button-ghost button-compact"
              onClick={resetPeriod}
            >
              {currentPeriodLabel(period)}
            </button>
          </div>

          <div className={styles.directPicker}>
            {period === "DAY" ? (
              <>
                <label htmlFor="dashboard-day">날짜 선택</label>
                <input
                  id="dashboard-day"
                  type="date"
                  value={anchorDate}
                  onChange={(event) =>
                    event.target.value && setAnchorDate(event.target.value)
                  }
                />
              </>
            ) : null}
            {period === "WEEK" ? (
              <>
                <label htmlFor="dashboard-week">포함 날짜</label>
                <input
                  id="dashboard-week"
                  type="date"
                  value={anchorDate}
                  onChange={(event) =>
                    event.target.value && setAnchorDate(event.target.value)
                  }
                />
              </>
            ) : null}
            {period === "MONTH" ? (
              <>
                <label htmlFor="dashboard-month">월 선택</label>
                <input
                  id="dashboard-month"
                  type="month"
                  value={anchorDate.slice(0, 7)}
                  onChange={(event) =>
                    event.target.value &&
                    setAnchorDate(`${event.target.value}-01`)
                  }
                />
              </>
            ) : null}
            {period === "YEAR" ? (
              <>
                <label htmlFor="dashboard-year">연도</label>
                <input
                  id="dashboard-year"
                  type="number"
                  min="2020"
                  max="2100"
                  value={anchorDate.slice(0, 4)}
                  onChange={(event) => {
                    const year = Number(event.target.value);
                    if (Number.isInteger(year) && year >= 2020 && year <= 2100)
                      setAnchorDate(`${year}-01-01`);
                  }}
                />
              </>
            ) : null}
          </div>
        </div>

        {flowError ? <p className="inline-error">{flowError}</p> : null}

        <div className={styles.facilityGrid}>
          {(
            [
              ["DAEJA", "대자동"],
              ["GWANSAN", "관산동"],
            ] as const
          ).map(([key, label]) => (
            <article className={styles.facilityFlowCard} key={key}>
              <h4>{label}</h4>
              <div>
                <span>입고</span>
                <strong>{facilityFlow[key].inboundQty.toLocaleString()}</strong>
                <small>
                  {facilityFlow[key].inboundCount.toLocaleString()}건
                </small>
              </div>
              <div>
                <span>출고</span>
                <strong>
                  {facilityFlow[key].outboundQty.toLocaleString()}
                </strong>
                <small>
                  {facilityFlow[key].outboundCount.toLocaleString()}건
                </small>
              </div>
            </article>
          ))}
        </div>

        <div className={styles.summaryGrid} aria-busy={flowLoading}>
          <article className={styles.summaryCard}>
            <span>입고 수량</span>
            <strong>{(flow?.inboundQty ?? 0).toLocaleString()}</strong>
            <small>{(flow?.inboundCount ?? 0).toLocaleString()}건 처리</small>
          </article>
          <article className={styles.summaryCard}>
            <span>출고 수량</span>
            <strong>{(flow?.outboundQty ?? 0).toLocaleString()}</strong>
            <small>{(flow?.outboundCount ?? 0).toLocaleString()}건 처리</small>
          </article>
          <article className={styles.summaryCard}>
            <span>총 처리 수량</span>
            <strong>
              {(
                (flow?.inboundQty ?? 0) + (flow?.outboundQty ?? 0)
              ).toLocaleString()}
            </strong>
            <small>입고 + 출고</small>
          </article>
          <article className={styles.summaryCard}>
            <span>총 처리 건수</span>
            <strong>
              {(
                (flow?.inboundCount ?? 0) + (flow?.outboundCount ?? 0)
              ).toLocaleString()}
            </strong>
            <small>유효 거래 기준</small>
          </article>
        </div>

        <div className={styles.seriesWrap}>
          <div className={styles.seriesHeader}>
            <span>구간</span>
            <span>입고</span>
            <span>입고 수량</span>
            <span>출고</span>
            <span>출고 수량</span>
          </div>
          {flowLoading && !flow ? (
            <div className={styles.emptySeries}>
              입출고 현황을 불러오는 중입니다.
            </div>
          ) : null}
          {!flowLoading && flow && flow.series.length === 0 ? (
            <div className={styles.emptySeries}>
              선택한 기간의 입출고 데이터가 없습니다.
            </div>
          ) : null}
          {flow?.series.map((point) => (
            <div className={styles.seriesRow} key={point.bucket}>
              <span className={styles.bucketLabel}>{point.label}</span>
              <div
                className={styles.barTrack}
                title={`입고 ${point.inboundQty.toLocaleString()}개`}
              >
                <div
                  className={styles.barInbound}
                  style={{ width: `${(point.inboundQty / maxFlowQty) * 100}%` }}
                />
              </div>
              <strong className={styles.qtyValue}>
                {point.inboundQty.toLocaleString()}
                <small>{point.inboundCount.toLocaleString()}건</small>
              </strong>
              <div
                className={styles.barTrack}
                title={`출고 ${point.outboundQty.toLocaleString()}개`}
              >
                <div
                  className={styles.barOutbound}
                  style={{
                    width: `${(point.outboundQty / maxFlowQty) * 100}%`,
                  }}
                />
              </div>
              <strong className={styles.qtyValue}>
                {point.outboundQty.toLocaleString()}
                <small>{point.outboundCount.toLocaleString()}건</small>
              </strong>
            </div>
          ))}
        </div>

        {flow?.generatedAt ? (
          <p className="small muted">
            마지막 집계:{" "}
            {new Date(flow.generatedAt).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
            })}
          </p>
        ) : null}
      </section>
    </div>
  );
}
