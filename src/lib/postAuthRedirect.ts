const STORAGE_KEY = "postAuthRedirect";

/** Only same-origin relative paths are allowed as a post-login destination. */
export const isSafeRelativePath = (path: string | null): path is string =>
  !!path && path.startsWith("/") && !path.startsWith("//");

export const storePostAuthRedirect = (path: string | null) => {
  if (isSafeRelativePath(path)) sessionStorage.setItem(STORAGE_KEY, path);
};

export const consumePostAuthRedirect = (): string | null => {
  const path = sessionStorage.getItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  return isSafeRelativePath(path) ? path : null;
};
