import type { HandlerEvent, HandlerResponse } from '@netlify/functions';
type SessionClaims = {
    userId: string;
    orgId: string;
    role: string;
};
export declare function hashPassword(password: string): Promise<string>;
export declare function verifyPassword(password: string, hash: string): Promise<boolean>;
export declare function createSessionCookie(claims: SessionClaims): Promise<string>;
export declare function clearSessionCookie(): string;
export declare function getSession(event: HandlerEvent): Promise<SessionClaims | null>;
export declare function requireSession(event: HandlerEvent): Promise<SessionClaims | HandlerResponse>;
export declare function getCurrentContext(event: HandlerEvent): Promise<{
    session: SessionClaims;
    user: {
        id: string;
        email: string;
        full_name: string | null;
    };
    organization: {
        id: string;
        name: string;
    };
    membership: {
        role: string;
    };
} | null>;
export declare function isManager(role: string): boolean;
export declare function withSessionCookie(response: HandlerResponse, cookie: string): HandlerResponse;
export {};
