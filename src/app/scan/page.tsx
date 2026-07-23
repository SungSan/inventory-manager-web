"use client";

import { PermissionGuard } from "@/components/permission-guard";
import { ScanWorkflowV3 } from "@/components/scan-workflow-v3";

export default function ScanPage() {
  return (
    <PermissionGuard permission="scan_inventory">
      <ScanWorkflowV3 />
    </PermissionGuard>
  );
}
