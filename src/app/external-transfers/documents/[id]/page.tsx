"use client";

import { PermissionGuard } from "@/components/permission-guard";
import { ExternalShipmentDocumentV2 } from "@/components/external-shipment-document-v2";

export default function ExternalShipmentDocumentPage() {
  return (
    <PermissionGuard permission="external_transfer">
      <ExternalShipmentDocumentV2 />
    </PermissionGuard>
  );
}
