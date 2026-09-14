import { useMemo, useSyncExternalStore } from "react";
import { subscribeStudioPreview, getStudioPreview } from "@/utils/studioPreview";
import { useQuery } from "@tanstack/react-query";
import { getPublic } from "@/services/api";
import type { PublicConfig } from "@/types/komari";

export function usePublicConfig() {
  const preview = useSyncExternalStore(subscribeStudioPreview, getStudioPreview, () => null);
  const query = useQuery<PublicConfig>({
    queryKey: ["public"],
    queryFn: getPublic,
    staleTime: 60_000,
  });
  const data = useMemo(() => query.data && preview ? { ...query.data, theme_settings: { ...query.data.theme_settings, ...preview } } : query.data, [query.data, preview]);
  return { ...query, data };
}
