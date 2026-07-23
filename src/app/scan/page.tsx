"use client";

import { PermissionGuard } from "@/components/permission-guard";
import { ScanWorkflowV4 } from "@/components/scan-workflow-v4";

export default function ScanPage() {
  return (
    <PermissionGuard permission="scan_inventory">
      <ScanWorkflowV4 />
    </PermissionGuard>
  );
}
