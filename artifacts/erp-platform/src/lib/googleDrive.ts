import {
  useGetGoogleDriveStatus,
  getGetGoogleDriveStatusQueryKey,
  type GoogleDriveStatus,
} from "@workspace/api-client-react";

/**
 * Whether Google Drive is available as a file source: the module is toggled on
 * in the registry, a refresh token is stored, and a target folder is configured.
 * Health is shown to administrators but transient provider failures do not hide
 * the upload option; the upload itself remains the authoritative operation.
 * When the module is off, only the normal server upload remains. Drives the
 * gdrive source availability in the file-field chooser.
 */
export function useGoogleDriveReady(): boolean {
  const { data } = useGetGoogleDriveStatus({
    query: { staleTime: 60_000, retry: false, queryKey: getGetGoogleDriveStatusQueryKey() },
  });
  const status = data as GoogleDriveStatus | undefined;
  return Boolean(status?.enabled && status.configured && status.folderConfigured);
}
