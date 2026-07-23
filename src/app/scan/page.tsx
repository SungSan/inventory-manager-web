"use client";

import { PermissionGuard } from "@/components/permission-guard";
import { ScanWorkflowV5 } from "@/components/scan-workflow-v5";

export default function ScanPage() {
  return (
    <PermissionGuard permission="scan_inventory">
      <ScanWorkflowV5 />
    </PermissionGuard>
  );
}
