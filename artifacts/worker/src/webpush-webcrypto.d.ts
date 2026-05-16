declare module "webpush-webcrypto" {
  export class ApplicationServerKeys {
    publicKey: CryptoKey;
    privateKey: CryptoKey;
    constructor(publicKey: CryptoKey, privateKey: CryptoKey);
    static fromJSON(keys: { publicKey: string; privateKey: string }): Promise<ApplicationServerKeys>;
    static generate(): Promise<ApplicationServerKeys>;
    toJSON(): Promise<{ publicKey: string; privateKey: string }>;
  }

  export interface PushTarget {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }

  export interface PushHTTPRequestOptions {
    applicationServerKeys: ApplicationServerKeys;
    payload: string | Uint8Array;
    target: PushTarget;
    adminContact: string;
    ttl: number;
    topic?: string;
    urgency?: "very-low" | "low" | "normal" | "high";
  }

  export interface PushHTTPRequest {
    headers: Record<string, string>;
    body: Uint8Array;
    endpoint: string;
  }

  export function generatePushHTTPRequest(opts: PushHTTPRequestOptions): Promise<PushHTTPRequest>;
  export function setWebCrypto(webCrypto: Crypto): void;
}
