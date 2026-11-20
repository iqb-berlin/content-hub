import { SetMetadata } from "@nestjs/common";

export const AP_RESPONSE_ENVELOPES = "ap:response-envelopes";

/** Traverse only declared application envelopes; content fields remain opaque. */
export const ApResponseEnvelopes = (...fields: string[]) =>
  SetMetadata(AP_RESPONSE_ENVELOPES, fields);

/** Dictionary keys and values belong to the caller, not to the API contract. */
export const RawApResponse = () => SetMetadata(AP_RESPONSE_ENVELOPES, false);
