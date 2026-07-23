"use client";

import { usePathname } from "next/navigation";
import { LocationMapDomEnhancer } from "@/components/location-map-dom-enhancer";
import { StocktakeAdminEnhancer, StocktakeSessionSortEnhancer } from "@/components/stocktake-admin-enhancer";
import { StocktakeVerificationEnhancer } from "@/components/stocktake-verification-enhancer";

export function StocktakeLiveEnhancer() {
  const pathname = usePathname();
  const location = pathname.match(/^\/stocktakes\/([^/]+)\/([^/]+)$/);
  const session = pathname.match(/^\/stocktakes\/([^/]+)$/);
  return <>
    <LocationMapDomEnhancer active={pathname === "/location-map"} />
    <StocktakeAdminEnhancer active={pathname === "/stocktakes"} />
    <StocktakeSessionSortEnhancer active={Boolean(session)} />
    {location ? <StocktakeVerificationEnhancer sessionId={location[1]} locationId={location[2]} /> : null}
  </>;
}
