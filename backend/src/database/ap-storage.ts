import { ValueTransformer } from "typeorm";
import {
  legacyApAction,
  normalizeApAction,
  normalizeApRole,
  normalizeApScope,
  translateApContract,
} from "../common/ap-contract";

/** Preserve the deployed storage contract, including compatibility with rollback. */
export const apRoleStorage: ValueTransformer = {
  to: (role: string) => (role === "AP_MANAGER" ? "ACP_MANAGER" : role),
  from: (role: string) => normalizeApRole(role),
};

export const apScopeStorage: ValueTransformer = {
  to: (scopes: string[]) =>
    scopes.map((scope) => (scope === "ap.read" ? "acp.read" : scope)),
  from: (scopes: string[]) =>
    Array.isArray(scopes) ? scopes.map(normalizeApScope) : scopes,
};

export const apActionStorage: ValueTransformer = {
  to: legacyApAction,
  from: normalizeApAction,
};

export const apAuditDetailsStorage: ValueTransformer = {
  to: (value: unknown) => translateApContract(value, true),
  from: (value: unknown) => translateApContract(value),
};
