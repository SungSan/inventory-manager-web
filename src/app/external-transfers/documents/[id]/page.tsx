import { redirect } from "next/navigation";

export default async function ExternalShipmentDocumentLegacyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/shipment-documents/${id}`);
}
