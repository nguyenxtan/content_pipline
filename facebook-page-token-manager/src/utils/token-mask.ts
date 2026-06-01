export function maskToken(token: string, visibleStart = 6, visibleEnd = 4): string {
  if (!token) return "";
  if (token.length <= visibleStart + visibleEnd) return `${token.slice(0, 2)}***`;
  return `${token.slice(0, visibleStart)}...${token.slice(-visibleEnd)}`;
}
