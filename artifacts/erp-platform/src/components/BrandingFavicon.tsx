import { useEffect } from "react";
import { useGetSettings } from "@workspace/api-client-react";

/** Branding is public and must apply outside the authenticated app shell too. */
export function BrandingFavicon() {
  const { data: settings } = useGetSettings();

  useEffect(() => {
    if (!settings) return;
    const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) return;
    if (settings.logoObjectPath) {
      link.removeAttribute("type");
      link.href = `/api/storage/branding-logo?v=${encodeURIComponent(settings.updatedAt)}`;
    } else {
      link.type = "image/svg+xml";
      link.href = `${import.meta.env.BASE_URL}favicon.svg`;
    }
  }, [settings]);

  return null;
}