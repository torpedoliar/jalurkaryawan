const mem = new Map<string, string>();

export async function getItemAsync(key: string): Promise<string | null> {
  return mem.get(key) ?? null;
}
export async function setItemAsync(key: string, value: string): Promise<void> {
  mem.set(key, value);
}
export async function deleteItemAsync(key: string): Promise<void> {
  mem.delete(key);
}
export function __resetSecureStore(): void {
  mem.clear();
}
export function __readSecureStore(key: string): string | null {
  return mem.get(key) ?? null;
}
