import type { ApCompatibilityRequest } from "../common/ap-compatibility.middleware";
import { ServerApiScope } from "./server-api-scopes";

export interface AuthenticatedServerApiClient {
  id: string;
  scopes: string[];
  allowedApIds: string[] | null;
}

export interface ServerApiRequest extends ApCompatibilityRequest {
  serverApiClient?: AuthenticatedServerApiClient;
}

export interface AuthenticatedServerApiRequest extends ApCompatibilityRequest {
  serverApiClient: AuthenticatedServerApiClient;
}

export interface ServerApiCapabilities {
  clientId: string;
  scopes: string[];
  capabilities: Record<ServerApiScope, boolean>;
  allowedApIds: string[] | null;
}
