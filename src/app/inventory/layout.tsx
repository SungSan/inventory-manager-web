import type { ReactNode } from "react";
import "./inventory-ui.css";

export default function InventoryLayout({ children }: { children: ReactNode }) {
  return <div className="inventory-route-shell">{children}</div>;
}
