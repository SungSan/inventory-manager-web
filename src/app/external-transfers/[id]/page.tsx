"use client";

import { PermissionGuard } from "@/components/permission-guard";
import { ExternalTransferDetailV2 } from "@/components/external-transfer-detail-v2";

export default function ExternalTransferDetailPage() {
  return (
    <PermissionGuard permission="external_transfer">
      <ExternalTransferDetailV2 />
    </PermissionGuard>
  );
}
