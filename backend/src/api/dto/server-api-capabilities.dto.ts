import { ApiProperty } from "@nestjs/swagger";
import { ALL_SERVER_API_SCOPES, ServerApiScope } from "../server-api-scopes";
import { ServerApiCapabilities } from "../server-api.types";

export class ServerApiCapabilitiesDto implements ServerApiCapabilities {
  @ApiProperty({ example: "coding-box" })
  clientId!: string;

  @ApiProperty({ enum: ALL_SERVER_API_SCOPES, isArray: true })
  scopes!: string[];

  @ApiProperty({
    type: "object",
    additionalProperties: { type: "boolean" },
  })
  capabilities!: Record<ServerApiScope, boolean>;

  @ApiProperty({
    type: "array",
    items: { type: "string", format: "uuid" },
    nullable: true,
  })
  allowedApIds!: string[] | null;
}
