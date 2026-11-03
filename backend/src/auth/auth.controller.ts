import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags, ApiOperation } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { OidcValidationService } from "./services/oidc-validation.service";
import { CredentialLoginDto, OidcCallbackDto } from "./dto/login.dto";
import { SyncOidcRolesDto } from "./dto/sync-oidc-roles.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { Roles } from "./roles.decorator";

@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly oidcValidationService: OidcValidationService,
  ) {}

  @Get("oidc-config")
  @ApiOperation({ summary: "Get OIDC configuration" })
  async getOidcConfig() {
    // Use public issuer URL for frontend, fallback to internal URL if not set
    const publicIssuerUrl =
      process.env.OIDC_PUBLIC_ISSUER_URL || process.env.OIDC_ISSUER_URL;
    const redirectUri =
      process.env.OIDC_REDIRECT_URI || "http://localhost:4201/auth/callback";
    const enabled =
      this.oidcValidationService.isOidcEnabled() &&
      !!publicIssuerUrl &&
      !!redirectUri;

    return {
      enabled,
      issuerUrl: publicIssuerUrl || null,
      clientId: process.env.OIDC_CLIENT_ID || null,
      redirectUri,
      scope: process.env.OIDC_SCOPE || "openid profile email",
    };
  }

  @Post("oidc-callback")
  @ApiOperation({ summary: "OIDC callback - exchange ID token for JWT" })
  async oidcCallback(@Body() oidcCallbackDto: OidcCallbackDto) {
    if (!this.oidcValidationService.isOidcEnabled()) {
      throw new UnauthorizedException("OIDC is not configured");
    }

    const userInfo = await this.oidcValidationService.validateIdToken(
      oidcCallbackDto.idToken,
    );

    // Generate JWT for the authenticated OIDC user
    return this.authService.generateTokenForOidcUser(userInfo);
  }

  @Post("link-oidc")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("APP_ADMIN")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Link a user to OIDC account (Admin only)" })
  async linkOidcAccount(@Body() body: { userId: string; oidcSub: string }) {
    return this.authService.linkOidcAccount(body.userId, body.oidcSub);
  }

  @Post("credential-login")
  @ApiOperation({ summary: "Login with AP credentials" })
  async credentialLogin(
    @Body() credentialLoginDto: CredentialLoginDto,
    @Request() req: any,
  ) {
    const clientId = this.extractClientId(req);
    return this.authService.credentialLogin(
      credentialLoginDto.acpId,
      credentialLoginDto.username,
      credentialLoginDto.password,
      clientId,
    );
  }

  @Post("logout")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Logout user (audit logging)" })
  async logout(@Request() req: any) {
    return this.authService.logout(req.user.sub);
  }

  @Get("profile")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get current user profile" })
  async getProfile(@Request() req: any) {
    return this.authService.getProfile(req.user.sub);
  }

  @Post("sync-oidc-roles")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Sync OIDC roles with application roles for current user and get new token",
  })
  async syncOidcRoles(@Request() req: any, @Body() syncDto: SyncOidcRolesDto) {
    if (!this.oidcValidationService.isOidcEnabled()) {
      throw new UnauthorizedException("OIDC is not configured");
    }

    // Validate the ID token and sync OIDC-derived user information.
    // OIDC admin role can elevate users to app admin but does not remove locally granted app-admin rights.
    const userInfo = await this.oidcValidationService.validateIdToken(
      syncDto.idToken,
    );

    // Check that the token belongs to the current user
    if (userInfo.sub !== req.user.sub) {
      throw new UnauthorizedException("Token does not match current user");
    }

    // Generate a NEW JWT token with the updated admin status
    return this.authService.generateTokenForOidcUser(userInfo);
  }

  private extractClientId(req: any): string {
    const xForwardedFor = req?.headers?.["x-forwarded-for"];
    const rawClient =
      (Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor) ||
      req?.ip ||
      req?.socket?.remoteAddress ||
      "unknown";
    const firstHop = String(rawClient).split(",")[0].trim();
    return firstHop || "unknown";
  }
}
