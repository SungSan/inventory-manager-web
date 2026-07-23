"use client";

import { useCallback, useEffect, useState } from "react";
import { listAllInventoryRows } from "@/lib/full-data-api";
import { listLocations } from "@/lib/inventory-api";
import { listLocationMapStates, type LocationMapState } from "@/lib/location-map-api";

function overlayFor(state?: LocationMapState): { kind: string; label: string } {
  if (!state) return { kind: "", label: "" };
  if (state.activeStocktakeCount > 0) return { kind: "working", label: "실사 중" };
  if (state.activeTransferCount > 0) return { kind: "working", label: "이관 중" };
  if (state.inventoryCountStatus === "DUE") return { kind: "due", label: "재실사" };
  if (state.transferMovementCountSinceCount > 0) return { kind: "verify", label: "확인 필요" };
  if (state.movementCountSinceCount > 0) return { kind: "changed", label: "실사 후 변동" };
  if (state.inventoryCountStatus === "DUE_SOON") return { kind: "soon", label: "실사 임박" };
  if (state.inventoryCountStatus === "NEVER") return { kind: "never", label: "미실사" };
  if (state.inventoryCountStatus === "PLANNED") return { kind: "planned", label: "실사 예정" };
  return { kind: "", label: "" };
}

export function LocationMapDomEnhancer({ active }: { active: boolean }) {
  const [states, setStates] = useState<LocationMapState[]>([]);
  const [stockById, setStockById] = useState<Map<string, { qty: number; sku: number }>>(new Map());
  const [codeById, setCodeById] = useState<Map<string, string>>(new Map());
  const [excludedCount, setExcludedCount] = useState(0);

  const load = useCallback(async () => {
    if (!active) return;
    const [stateRows, inventory, locations] = await Promise.all([
      listLocationMapStates(),
      listAllInventoryRows(),
      listLocations("", true),
    ]);
    const totals = new Map<string, { qty: number; products: Set<string> }>();
    for (const item of inventory) {
      if (item.qty <= 0) continue;
      const current = totals.get(item.locationId) ?? { qty: 0, products: new Set<string>() };
      current.qty += item.qty;
      current.products.add(item.productId);
      totals.set(item.locationId, current);
    }
    setStates(stateRows);
    setCodeById(new Map(locations.map((location) => [location.id, location.locationCode.toUpperCase()])));
    setExcludedCount(locations.filter((location) => !location.active).length);
    setStockById(new Map(Array.from(totals, ([id, value]) => [id, { qty: value.qty, sku: value.products.size }])));
  }, [active]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!active || states.length === 0) return;
    let applying = false;
    const apply = () => {
      if (applying) return;
      applying = true;
      try {
        const stateByCode = new Map(
          states.map((state) => [codeById.get(state.locationId) || "", state] as const).filter(([code]) => code),
        );
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".location-map-cell"));
        const counts = { occupied: 0, empty: 0, working: 0, review: 0, unavailable: 0 };

        buttons.forEach((button) => {
          const code = (button.title.split(" · ")[0] || "").trim().toUpperCase();
          const state = stateByCode.get(code);
          if (!state) return;

          button.dataset.locationId = state.locationId;
          const stock = stockById.get(state.locationId) ?? { qty: 0, sku: 0 };
          const base = state.unavailable ? "unavailable" : stock.qty > 0 ? "occupied" : "empty";
          const overlay = overlayFor(state);

          if (base === "occupied") counts.occupied += 1;
          else if (base === "empty") counts.empty += 1;
          else counts.unavailable += 1;
          if (state.activeStocktakeCount > 0 || state.activeTransferCount > 0) counts.working += 1;
          if (state.transferMovementCountSinceCount > 0) counts.review += 1;

          button.classList.remove(
            "working", "occupied", "empty", "unavailable", "working-overlay", "overlay-verify",
            "overlay-changed", "overlay-due", "overlay-soon", "overlay-never", "overlay-planned",
          );
          button.classList.add(base);
          if (overlay.kind === "working") button.classList.add("working-overlay");
          else if (overlay.kind) button.classList.add(`overlay-${overlay.kind}`);

          const small = button.querySelector("small");
          const smallText = base === "unavailable" ? "사용불가" : stock.qty > 0 ? `${stock.sku} SKU` : "EMPTY";
          if (small && small.textContent !== smallText) small.textContent = smallText;

          let badge = button.querySelector<HTMLElement>(".location-cell-overlay-badge");
          if (!badge && overlay.label) {
            badge = document.createElement("em");
            button.appendChild(badge);
          }
          if (badge) {
            const badgeClass = `location-cell-overlay-badge ${overlay.kind}`;
            if (badge.className !== badgeClass) badge.className = badgeClass;
            if (badge.textContent !== overlay.label) badge.textContent = overlay.label;
            const display = overlay.label ? "inline-flex" : "none";
            if (badge.style.display !== display) badge.style.display = display;
          }
        });

        const metrics = document.querySelector(".location-map-metrics");
        if (metrics) {
          metrics.classList.remove("six");
          metrics.classList.add("seven");
          const values: Array<[string, number]> = [
            ["표시 LOC", buttons.length],
            ["점유 LOC", counts.occupied],
            ["빈 LOC", counts.empty],
            ["작업 중", counts.working],
            ["확인 필요", counts.review],
            ["사용불가", counts.unavailable],
            ["제외 LOC", excludedCount],
          ];
          const cards = Array.from(metrics.querySelectorAll<HTMLElement>("article"));
          values.forEach(([label, value], index) => {
            let card = cards[index];
            if (!card) {
              card = document.createElement("article");
              metrics.appendChild(card);
            }
            const span = card.querySelector("span") ?? card.appendChild(document.createElement("span"));
            const strong = card.querySelector("strong") ?? card.appendChild(document.createElement("strong"));
            const text = value.toLocaleString();
            if (span.textContent !== label) span.textContent = label;
            if (strong.textContent !== text) strong.textContent = text;
          });
          cards.slice(values.length).forEach((card) => card.remove());
        }
      } finally {
        applying = false;
      }
    };

    apply();
    const observer = new MutationObserver(() => window.setTimeout(apply, 0));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [active, codeById, excludedCount, states, stockById]);

  return null;
}
