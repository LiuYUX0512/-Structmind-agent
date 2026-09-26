// 用于本地验证的 lark toolkit mock（node 环境无浏览器 API）
export const scopedStorage = {
  _data: {} as Record<string, string>,
  getItem(k: string): string | null {
    return this._data[k] ?? null;
  },
  setItem(k: string, v: string): void {
    this._data[k] = v;
  },
  removeItem(k: string): void {
    delete this._data[k];
  },
};

export const logger = {
  info(): void {},
  warn(): void {},
  error(): void {},
  debug(): void {},
};

export const copyToClipboard = async (): Promise<void> => {};

export const capabilityClient = {
  get: async () => null,
  post: async () => null,
};

export const AppContainer = (props: unknown) => null;
export const ErrorRender = () => null;
