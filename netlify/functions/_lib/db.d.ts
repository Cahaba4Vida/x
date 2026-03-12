export declare const sql: any;
export declare function query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
export declare function one<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | null>;
export declare function nowPlusHours(hours: number): string;
