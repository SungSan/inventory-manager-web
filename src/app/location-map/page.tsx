"use client";

import { PermissionGuard } from "@/components/permission-guard";
import { LocationMapView } from "@/components/location-map-view";

export default function LocationMapPage() {
  return (
    <PermissionGuard permission="view_inventory">
      <LocationMapView />
    </PermissionGuard>
  );
}
