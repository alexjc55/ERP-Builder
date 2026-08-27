export type StatusManualEditPolicy = "allowed" | "disabled_all" | "disabled_users";

export function isManualStatusEditDisabled(
  policy: string | null | undefined,
  blockedUserIds: unknown,
  actorUserId: number,
): boolean {
  if (policy === "disabled_all") return true;
  if (policy !== "disabled_users" || !Array.isArray(blockedUserIds)) return false;
  return blockedUserIds.some((id) => id === actorUserId);
}