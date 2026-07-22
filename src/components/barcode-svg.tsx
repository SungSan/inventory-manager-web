"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

export function BarcodeSvg({ value, height = 44 }: { value: string; height?: number }) {
  const ref = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        displayValue: false,
        margin: 0,
        height,
        width: 1.5,
      });
    } catch {
      ref.current.innerHTML = "";
    }
  }, [height, value]);
  return <svg ref={ref} aria-label={`바코드 ${value}`} className="barcode-svg" />;
}
