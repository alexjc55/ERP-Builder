import {
  useGetGoogleDriveStatus,
  getGetGoogleDriveStatusQueryKey,
  type GoogleDriveStatus,
} from "@workspace/api-client-react";

/**
 * Whether Google Drive is connected and ready to receive uploads (a refresh
 * token is stored and a target folder is configured). Drives the gdrive source
 * availability in the file-field chooser.
 */
export function useGoogleDriveReady(): boolean {
  const { data } = useGetGoogleDriveStatus({
    query: { staleTime: 60_000, retry: false, queryKey: getGetGoogleDriveStatusQueryKey() },
  });
  const status = data as GoogleDriveStatus | undefined;
  return Boolean(status?.connected && status.folderConfigured);
}
