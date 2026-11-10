const joinPath = /^\/join\/[A-Za-z0-9_-]+$/;
const groupPath =
  /^\/groups\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function safeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if (value.includes("?") || value.includes("#")) return null;
  if (value === "/groups/new") return value;
  if (joinPath.test(value) || groupPath.test(value)) return value;
  return null;
}

export function readPublicOrigin(value: string | undefined | null): string | null {
  if (!value?.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  return url.origin;
}

export function joinLink(pageOrigin: string, publicOrigin: string | null, token: string): string {
  const chosen = publicOrigin && publicOrigin.trim() ? publicOrigin : pageOrigin;
  return `${chosen.replace(/\/$/, "")}/join/${token}`;
}
