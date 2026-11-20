import { ApCapabilitiesService } from "./capabilities/ap-capabilities.service";
import {
  ExplorerReadGuard,
  ExplorerEditGuard,
} from "./capabilities/explorer-access.guard";
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { ApAccessGuard } from "./guards/ap-access.guard";
import { OidcAuthGuard } from "./guards/oidc-auth.guard";
import { OidcValidationService } from "./services/oidc-validation.service";
import {
  User,
  ApCredential,
  ApAccessConfig,
  ApUserRole,
} from "../database/entities";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>("JWT_SECRET", "dev-secret"),
        signOptions: {
          expiresIn: configService.get<string>("JWT_EXPIRATION", "24h") as any,
        },
      }),
    }),
    TypeOrmModule.forFeature([User, ApCredential, ApAccessConfig, ApUserRole]),
  ],
  controllers: [AuthController],
  providers: [
    ApCapabilitiesService,
    ExplorerReadGuard,
    ExplorerEditGuard,
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    ApAccessGuard,
    OidcValidationService,
    OidcAuthGuard,
  ],
  exports: [
    ApCapabilitiesService,
    ExplorerReadGuard,
    ExplorerEditGuard,
    AuthService,
    JwtAuthGuard,
    RolesGuard,
    ApAccessGuard,
    OidcAuthGuard,
    OidcValidationService,
    JwtModule,
    TypeOrmModule,
  ],
})
export class AuthModule {}
