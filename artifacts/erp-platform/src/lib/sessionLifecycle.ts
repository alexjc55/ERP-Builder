/** Remove only the credentials used by the failed request. A response arriving
 * after login or impersonation must never invalidate the replacement session. */
export function invalidateCurrentSession(
  storage: Pick<Storage, "getItem" | "removeItem">,
  failedToken: string,
  onInvalidated: () => void,
): boolean {
  if (storage.getItem("erp_token") !== failedToken) return false;
  storage.removeItem("erp_token");
  onInvalidated();
  return true;
}
