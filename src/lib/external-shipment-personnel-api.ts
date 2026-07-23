import { getSupabaseClient, isDemoMode } from "@/lib/supabase";

export interface ExternalShipmentPersonnel {
  writerName: string;
  shipmentManagerName: string;
}

function client() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 연결 설정을 확인하세요.");
  return supabase;
}

function ensureLiveMode(): void {
  if (isDemoMode()) throw new Error("출고명세서 담당자 설정은 LIVE 모드에서만 사용할 수 있습니다.");
}

function mapPersonnel(value: unknown): ExternalShipmentPersonnel {
  const row = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    writerName: String(row.writer_name ?? row.writerName ?? ""),
    shipmentManagerName: String(row.shipment_manager_name ?? row.shipmentManagerName ?? ""),
  };
}

export async function getExternalShipmentPersonnel(
  documentId: string,
): Promise<ExternalShipmentPersonnel> {
  ensureLiveMode();
  const { data, error } = await client().rpc("get_external_shipment_personnel", {
    p_document_id: documentId,
  });
  if (error) throw new Error(error.message);
  return mapPersonnel(data);
}

export async function updateExternalShipmentPersonnel(
  documentId: string,
  writerName: string,
  shipmentManagerName: string,
): Promise<ExternalShipmentPersonnel> {
  ensureLiveMode();
  const { data, error } = await client().rpc("update_external_shipment_personnel", {
    p_document_id: documentId,
    p_writer_name: writerName.trim(),
    p_shipment_manager_name: shipmentManagerName.trim(),
  });
  if (error) throw new Error(error.message);
  return mapPersonnel(data);
}
