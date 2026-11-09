import { Request } from "express";
import { ServerApiScope } from "./server-api-scopes";

export interface AuthenticatedServerApiClient {
  id: string;
  scopes: string[];
  allowedApIds: string[] | null;
}

export interface ServerApiRequest extends Request {
  serverApiClient?: AuthenticatedServerApiClient;
}

export interface AuthenticatedServerApiRequest extends Request {
  serverApiClient: AuthenticatedServerApiClient;
}

export interface ServerApiCapabilities {
  clientId: string;
  scopes: string[];
  capabilities: Record<ServerApiScope, boolean>;
  allowedApIds: string[] | null;
}
