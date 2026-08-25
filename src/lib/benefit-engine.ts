import type {
  BenefitEvent,
  BenefitEventClass,
  BenefitOrderRow,
  BenefitRule,
  BenefitWinnerRow,
  BenefitCalculationResultRecord,
} from "@/lib/benefit-api";

export interface ProductClassification {
  classificationRaw: string;
  eventMarker: string;
  eventType: string;
}

export interface BenefitAward {
  ruleId: string;
  name: string;
  quantity: number;
  unit: string;
  representativeSourceRowId: string;
  eventTypes: string[];
}

export interface BenefitRowOutcome {
  sourceRowId: string;
  sourceRowNumber: number;
  mixedOrder: boolean;
  purchaseQty: number;
  onsitePickupQty: number;
  warehouseShipQty: number;
  isWinner: boolean;
  isPhotoBenefit: boolean;
  benefits: BenefitAward[];
  calculationStatus: "OK" | "EXCLUDED" | "REVIEW";
  reviewMessage?: string;
}

export interface BenefitWinnerOutcome {
  winnerRowId: string;
  status: "MATCHED" | "EXCLUDED" | "REVIEW";
  message?: string;
  matchedOrderRowId?: string;
}

export interface BenefitCalculationSummary {
  shippingCount: number;
  orderCount: number;
  purchaseQty: number;
  warehouseShipQty: number;
  benefitBasisQty: number;
  eventTypeQty: Record<string, number>;
  winnerCount: number;
  onsitePickupQty: number;
  photoBenefitCount: number;
  benefitTotals: Record<string, { quantity: number; unit: string }>;
  reviewCount: number;
}

export interface BenefitCalculationOutput {
  summary: BenefitCalculationSummary;
  rowOutcomes: Record<string, BenefitRowOutcome>;
  winnerOutcomes: BenefitWinnerOutcome[];
  results: BenefitCalculationResultRecord[];
  reviewRequired: boolean;
}

function normalized(value: unknown): string {
  return String(value ?? "").trim();
}

function comparable(value: unknown): string {
  return normalized(value).replace(/\s+/g, " ").toUpperCase();
}

function keyPart(value: unknown): string {
  return comparable(value);
}

export function classifyBenefitProductName(productName: string): ProductClassification | null {
  const match = String(productName ?? "").match(/^\s*\[([^\]]+)\]/);
  if (!match) return null;
  const classificationRaw = match[1].trim();
  const markerMatch = classificationRaw.match(/^(\S+)(?:\s+(.+))?$/);
  if (!markerMatch) return null;
  const eventMarker = (markerMatch[1] ?? "").trim();
  const eventType = (markerMatch[2] ?? "").trim();
  if (!eventMarker || !eventType) return null;
  return { classificationRaw, eventMarker, eventType };
}

export function isPhotoBenefitValue(value: unknown): boolean {
  return normalized(value).toUpperCase() === "O";
}

function listContains(values: string[], value: string): boolean {
  const target = comparable(value);
  return values.some((item) => comparable(item) === target);
}

export function getCancelDisposition(event: BenefitEvent, value: string): "NORMAL" | "CANCELLED" | "REVIEW" {
  if (listContains(event.cancelExcludeValues, value)) return "CANCELLED";
  if (listContains(event.cancelNormalValues, value)) return "NORMAL";
  return "REVIEW";
}

export function describeBenefitRule(rule: BenefitRule): string {
  const threshold = rule.thresholdValue.toLocaleString("ko-KR");
  const reward = rule.rewardQuantity.toLocaleString("ko-KR");
  if (rule.ruleType === "PER_ORDER") return `주문번호당 ${rule.name} ${reward}${rule.rewardUnit} 지급`;
  if (rule.ruleType === "PER_SHIPMENT") return `배송번호당 ${rule.name} ${reward}${rule.rewardUnit} 지급`;
  const basis = rule.ruleType === "AMOUNT" ? `${threshold}원` : `${threshold}장`;
  return rule.oneTimeOnly || !rule.repeatEnabled
    ? `${basis} 이상 구매하면 ${rule.name} ${reward}${rule.rewardUnit} 1회 지급`
    : `${basis} 구매할 때마다 ${rule.name} ${reward}${rule.rewardUnit} 지급`;
}

function rewardFor(rule: BenefitRule, basis: number): number {
  let reward = 0;
  if (rule.ruleType === "PER_ORDER" || rule.ruleType === "PER_SHIPMENT") {
    reward = basis > 0 ? rule.rewardQuantity : 0;
  } else if (basis >= rule.thresholdValue) {
    reward = rule.oneTimeOnly || !rule.repeatEnabled
      ? rule.rewardQuantity
      : Math.floor(basis / rule.thresholdValue) * rule.rewardQuantity;
  }
  if (rule.maximumRewardQuantity != null) reward = Math.min(reward, rule.maximumRewardQuantity);
  return reward;
}

interface Partition {
  key: string;
  mall: string;
  shippingNo: string;
  orderNo: string;
  eventType: string;
  rows: BenefitOrderRow[];
  purchaseQty: number;
  purchaseAmount: number;
  onsitePickupQty: number;
  warehouseShipQty: number;
  isWinner: boolean;
  isPhotoBenefit: boolean;
  benefits: BenefitAward[];
}

function partitionKey(row: Pick<BenefitOrderRow, "mall" | "shippingNo" | "orderNo" | "eventType">): string {
  return `${keyPart(row.mall)}::${keyPart(row.shippingNo)}::${keyPart(row.orderNo)}::${keyPart(row.eventType)}`;
}

function winnerKey(mall: string, orderNo: string, eventType: string): string {
  return `${keyPart(mall)}::${keyPart(orderNo)}::${keyPart(eventType)}`;
}

function firstRow(rows: BenefitOrderRow[]): BenefitOrderRow {
  return [...rows].sort((a, b) => a.sourceRowNumber - b.sourceRowNumber)[0];
}

export function calculateBenefits(input: {
  event: BenefitEvent;
  classes: BenefitEventClass[];
  rules: BenefitRule[];
  orderRows: BenefitOrderRow[];
  winnerRows?: BenefitWinnerRow[];
}): BenefitCalculationOutput {
  const classByRaw = new Map(input.classes.map((item) => [item.classificationRaw, item]));
  const classById = new Map(input.classes.map((item) => [item.id, item]));
  const selectedTypes = new Set(input.classes.filter((item) => item.isSelected).map((item) => item.eventType));
  const rowOutcomes: Record<string, BenefitRowOutcome> = {};
  const activeRows: BenefitOrderRow[] = [];
  const reviewMessages = new Set<string>();

  const orderTypeSet = new Map<string, Set<string>>();
  for (const row of input.orderRows) {
    if (!row.eventType) continue;
    const key = `${keyPart(row.mall)}::${keyPart(row.orderNo)}`;
    const set = orderTypeSet.get(key) ?? new Set<string>();
    set.add(row.eventType);
    orderTypeSet.set(key, set);
  }

  for (const row of input.orderRows) {
    const orderKey = `${keyPart(row.mall)}::${keyPart(row.orderNo)}`;
    const mixedOrder = (orderTypeSet.get(orderKey)?.size ?? 0) > 1;
    const cancelDisposition = getCancelDisposition(input.event, row.cancelStatus);
    const rowClass = row.classificationRaw ? classByRaw.get(row.classificationRaw) : undefined;
    let status: BenefitRowOutcome["calculationStatus"] = "OK";
    let message = "";

    if (cancelDisposition === "CANCELLED") {
      status = "EXCLUDED";
      message = `취소구분 '${row.cancelStatus || "(빈 값)"}'에 따라 계산 제외`;
    } else if (cancelDisposition === "REVIEW") {
      status = "REVIEW";
      message = `알 수 없는 취소구분 '${row.cancelStatus || "(빈 값)"}'`;
    } else if (row.classificationStatus === "REVIEW" || !row.eventType || !row.classificationRaw) {
      status = "REVIEW";
      message = row.reviewMessage || "행사 유형 분류 확인 필요";
    } else if (!rowClass) {
      status = "REVIEW";
      message = "현재 행사에 연결된 분류 정보를 찾을 수 없습니다.";
    } else if (!rowClass.isSelected) {
      status = "EXCLUDED";
      message = `이번 계산에서 '[${row.classificationRaw}]' 분류 선택 해제`;
    }

    rowOutcomes[row.id] = {
      sourceRowId: row.id,
      sourceRowNumber: row.sourceRowNumber,
      mixedOrder,
      purchaseQty: row.quantity,
      onsitePickupQty: 0,
      warehouseShipQty: row.quantity,
      isWinner: false,
      isPhotoBenefit: false,
      benefits: [],
      calculationStatus: status,
      reviewMessage: message || undefined,
    };

    if (status === "OK") activeRows.push(row);
    if (status === "REVIEW") reviewMessages.add(`order:${row.id}:${message}`);
  }

  const partitions = new Map<string, Partition>();
  for (const row of activeRows) {
    const key = partitionKey(row);
    const partition = partitions.get(key) ?? {
      key,
      mall: row.mall,
      shippingNo: row.shippingNo,
      orderNo: row.orderNo,
      eventType: row.eventType || "",
      rows: [],
      purchaseQty: 0,
      purchaseAmount: 0,
      onsitePickupQty: 0,
      warehouseShipQty: 0,
      isWinner: false,
      isPhotoBenefit: false,
      benefits: [],
    };
    partition.rows.push(row);
    partition.purchaseQty += row.quantity;
    partition.purchaseAmount += row.itemAmount;
    partition.warehouseShipQty += row.quantity;
    partitions.set(key, partition);
  }

  const activeRules = input.rules.filter((rule) => rule.isActive);
  const benefitTotals: Record<string, { quantity: number; unit: string }> = {};

  for (const rule of activeRules) {
    const allowedClassIds = new Set(rule.classIds);
    const matchingRows = activeRows.filter((row) => {
      const classId = row.classificationRaw ? classByRaw.get(row.classificationRaw)?.id : undefined;
      return Boolean(classId && allowedClassIds.has(classId));
    });
    if (!matchingRows.length) continue;

    const distinctRuleTypes = new Set(rule.classIds.map((classId) => classById.get(classId)?.eventType).filter(Boolean));
    const groups = new Map<string, BenefitOrderRow[]>();
    for (const row of matchingRows) {
      let groupKey: string;
      if (rule.ruleType === "PER_SHIPMENT") {
        groupKey = `SHIP::${keyPart(row.mall)}::${keyPart(row.shippingNo)}`;
      } else if (rule.ruleType === "PER_ORDER") {
        groupKey = `ORDER::${keyPart(row.mall)}::${keyPart(row.orderNo)}`;
      } else if (distinctRuleTypes.size > 1) {
        groupKey = `COMMON::${keyPart(row.mall)}::${keyPart(row.shippingNo)}::${keyPart(row.orderNo)}`;
      } else {
        groupKey = `TYPE::${partitionKey(row)}`;
      }
      groups.set(groupKey, [...(groups.get(groupKey) ?? []), row]);
    }

    for (const rows of groups.values()) {
      const purchaseQty = rows.reduce((sum, row) => sum + row.quantity, 0);
      const purchaseAmount = rows.reduce((sum, row) => sum + row.itemAmount, 0);
      const basis = rule.ruleType === "AMOUNT" ? purchaseAmount : purchaseQty;
      const reward = rewardFor(rule, basis);
      if (reward <= 0) continue;
      const representative = firstRow(rows);
      const award: BenefitAward = {
        ruleId: rule.id,
        name: rule.name,
        quantity: reward,
        unit: rule.rewardUnit,
        representativeSourceRowId: representative.id,
        eventTypes: [...rule.eventTypes],
      };
      rowOutcomes[representative.id].benefits.push(award);
      const partition = partitions.get(partitionKey(representative));
      if (partition) partition.benefits.push(award);
      const total = benefitTotals[rule.id] ?? { quantity: 0, unit: rule.rewardUnit };
      total.quantity += reward;
      benefitTotals[rule.id] = total;
    }
  }

  const winnerOutcomes: BenefitWinnerOutcome[] = [];
  if (input.event.isFansign && input.winnerRows?.length) {
    const winnersByKey = new Map<string, BenefitWinnerRow[]>();
    for (const winner of input.winnerRows) {
      const type = winner.eventType || "";
      const key = winnerKey(winner.mall, winner.orderNo, type);
      winnersByKey.set(key, [...(winnersByKey.get(key) ?? []), winner]);
    }

    for (const winner of input.winnerRows) {
      const type = winner.eventType || "";
      if (!type) {
        const message = "당첨자 주문상품명에서 행사 유형을 추출할 수 없습니다.";
        winnerOutcomes.push({ winnerRowId: winner.id, status: "REVIEW", message });
        reviewMessages.add(`winner:${winner.id}:${message}`);
        continue;
      }

      const winnerClass = winner.classificationRaw ? classByRaw.get(winner.classificationRaw) : undefined;
      const winnerTypeSelected = winnerClass ? winnerClass.isSelected : selectedTypes.has(type);
      if (!winnerTypeSelected) {
        winnerOutcomes.push({ winnerRowId: winner.id, status: "EXCLUDED", message: `이번 계산에서 '${type}' 유형 선택 해제` });
        continue;
      }

      const key = winnerKey(winner.mall, winner.orderNo, type);
      if ((winnersByKey.get(key)?.length ?? 0) > 1) {
        const message = "동일 몰 + 주문번호 + 행사유형의 중복 당첨자 행입니다.";
        winnerOutcomes.push({ winnerRowId: winner.id, status: "REVIEW", message });
        reviewMessages.add(`winner:${winner.id}:${message}`);
        continue;
      }

      const candidatePartitions = [...partitions.values()].filter((partition) =>
        keyPart(partition.mall) === keyPart(winner.mall)
        && keyPart(partition.orderNo) === keyPart(winner.orderNo)
        && keyPart(partition.eventType) === keyPart(type),
      );
      if (candidatePartitions.length !== 1) {
        const message = candidatePartitions.length === 0
          ? "몰 + 주문번호 + 행사유형에 일치하는 주문을 찾지 못했습니다."
          : "당첨 유형이 여러 배송 묶음에 걸쳐 있어 하나로 특정할 수 없습니다.";
        winnerOutcomes.push({ winnerRowId: winner.id, status: "REVIEW", message });
        reviewMessages.add(`winner:${winner.id}:${message}`);
        continue;
      }

      const partition = candidatePartitions[0];
      const representative = firstRow(partition.rows);
      const nameMismatch = normalized(winner.ordererName)
        && normalized(representative.ordererName)
        && comparable(winner.ordererName) !== comparable(representative.ordererName);
      if (nameMismatch) {
        const message = "당첨자 정보 불일치 · 주문자명";
        winnerOutcomes.push({ winnerRowId: winner.id, status: "REVIEW", message, matchedOrderRowId: representative.id });
        reviewMessages.add(`winner:${winner.id}:${message}`);
        continue;
      }

      if (partition.purchaseQty < 1) {
        const message = "현장수령 차감 후 물류 출고수량이 음수가 될 수 있습니다.";
        winnerOutcomes.push({ winnerRowId: winner.id, status: "REVIEW", message, matchedOrderRowId: representative.id });
        reviewMessages.add(`winner:${winner.id}:${message}`);
        continue;
      }

      partition.onsitePickupQty += 1;
      partition.warehouseShipQty = Math.max(0, partition.purchaseQty - partition.onsitePickupQty);
      partition.isWinner = true;
      partition.isPhotoBenefit = partition.isPhotoBenefit || winner.isPhotoBenefit;

      const deductionRow = [...partition.rows]
        .sort((a, b) => a.sourceRowNumber - b.sourceRowNumber)
        .find((row) => rowOutcomes[row.id].warehouseShipQty > 0);
      if (deductionRow) {
        rowOutcomes[deductionRow.id].onsitePickupQty += 1;
        rowOutcomes[deductionRow.id].warehouseShipQty = Math.max(0, rowOutcomes[deductionRow.id].warehouseShipQty - 1);
      }
      rowOutcomes[representative.id].isWinner = true;
      rowOutcomes[representative.id].isPhotoBenefit = rowOutcomes[representative.id].isPhotoBenefit || winner.isPhotoBenefit;
      winnerOutcomes.push({ winnerRowId: winner.id, status: "MATCHED", matchedOrderRowId: representative.id });
    }
  }

  const results: BenefitCalculationResultRecord[] = [...partitions.values()].map((partition) => {
    const representative = firstRow(partition.rows);
    return {
      shippingNo: partition.shippingNo,
      orderNo: partition.orderNo,
      eventType: partition.eventType,
      purchaseQty: partition.purchaseQty,
      benefitBasisQty: partition.purchaseQty,
      onsitePickupQty: partition.onsitePickupQty,
      warehouseShipQty: partition.warehouseShipQty,
      isWinner: partition.isWinner,
      isPhotoBenefit: partition.isPhotoBenefit,
      benefits: partition.benefits,
      calculationStatus: "OK",
      representativeSourceRowId: representative.id,
    };
  });

  const activeRowIds = new Set(activeRows.map((row) => row.id));
  const shippingSet = new Set(activeRows.map((row) => `${keyPart(row.mall)}::${keyPart(row.shippingNo)}`).filter(Boolean));
  const orderSet = new Set(activeRows.map((row) => `${keyPart(row.mall)}::${keyPart(row.orderNo)}`).filter(Boolean));
  const eventTypeQty: Record<string, number> = {};
  for (const row of activeRows) eventTypeQty[row.eventType || "미분류"] = (eventTypeQty[row.eventType || "미분류"] ?? 0) + row.quantity;
  const winnerMatched = winnerOutcomes.filter((item) => item.status === "MATCHED");
  const summary: BenefitCalculationSummary = {
    shippingCount: shippingSet.size,
    orderCount: orderSet.size,
    purchaseQty: activeRows.reduce((sum, row) => sum + row.quantity, 0),
    warehouseShipQty: Object.values(rowOutcomes).filter((row) => activeRowIds.has(row.sourceRowId)).reduce((sum, row) => sum + row.warehouseShipQty, 0),
    benefitBasisQty: activeRows.reduce((sum, row) => sum + row.quantity, 0),
    eventTypeQty,
    winnerCount: winnerMatched.length,
    onsitePickupQty: Object.values(rowOutcomes).reduce((sum, row) => sum + row.onsitePickupQty, 0),
    photoBenefitCount: winnerMatched.filter((item) => input.winnerRows?.find((row) => row.id === item.winnerRowId)?.isPhotoBenefit).length,
    benefitTotals,
    reviewCount: reviewMessages.size,
  };

  return {
    summary,
    rowOutcomes,
    winnerOutcomes,
    results,
    reviewRequired: reviewMessages.size > 0,
  };
}
