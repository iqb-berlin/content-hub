import { IsBoolean, IsString, Matches, MaxLength } from "class-validator";

export class PreviewPublicTaskDto {
  @IsString() @Matches(/\S/) @MaxLength(255) unitId!: string;
  @IsString() @Matches(/\S/) @MaxLength(10000) copyrightNotice!: string;
  @IsString() @MaxLength(20000) publicComments!: string;
}

export class CreatePublicTaskDto extends PreviewPublicTaskDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/) sourceRevision!: string;
}

export class SetPublicTaskPublicationDto {
  @IsBoolean() published!: boolean;
}
