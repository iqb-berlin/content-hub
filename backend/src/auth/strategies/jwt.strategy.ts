import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { JwtPayload } from "../auth.service";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "../../database/entities/user.entity";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter("token"),
        ExtractJwt.fromUrlQueryParameter("auth_token"),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>("JWT_SECRET", "dev-secret"),
    });
  }

  async validate(payload: JwtPayload) {
    // Credential users don't exist in User table - return payload directly
    if (payload.type === "credential") {
      return {
        sub: payload.sub,
        username: payload.username,
        isAppAdmin: false,
        type: payload.type,
        authType: payload.authType,
        acpId: payload.acpId,
        acpRoles: [],
      };
    }

    // Reject local user tokens issued by older releases immediately.
    if (payload.type !== "oidc" || payload.authType !== "oidc") {
      return null;
    }

    // Load full user with roles from database for OIDC users.
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
      relations: ["acpRoles", "acpRoles.acp"],
    });

    if (!user) {
      return null;
    }

    return {
      sub: payload.sub,
      username: user.username || payload.username,
      displayName: user.displayName,
      isAppAdmin: user.isAppAdmin,
      type: payload.type,
      authType: payload.authType,
      acpId: payload.acpId,
      acpRoles: user.acpRoles.map((role) => ({
        acpId: role.acpId,
        acpName: role.acp?.name,
        role: role.role,
      })),
    };
  }
}
