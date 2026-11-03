# Keycloak Registration and ALTCHA

Content Hub allows direct Keycloak self-registration. New users must verify
their email address before they can sign in.

The registration form is intentionally not restricted to HU/IQB email domains.
Bot protection is handled by a self-hosted ALTCHA proof-of-work challenge in
the Keycloak registration flow.

## Deployment Model

```text
Browser -> Keycloak registration form -> ALTCHA widget
        -> Keycloak registration FormAction -> email verification
```

ALTCHA is self-hosted:

- the browser widget is served from the local Keycloak theme,
- challenges are generated and signed by the Keycloak provider,
- submitted payloads are verified inside Keycloak,
- no Google, Cloudflare, or external CAPTCHA verification service is called.

## Build the Provider

Build the Keycloak provider before starting or updating Keycloak:

```bash
make keycloak-altcha-provider
```

This creates:

```text
keycloak/providers/content-hub-keycloak-altcha.jar
```

The JAR is a build artifact and is not committed. The Compose files mount
`./keycloak/providers` into `/opt/keycloak/providers`.

## Required Environment

Set a strong HMAC secret in `.env`:

```bash
ALTCHA_HMAC_SECRET=<long-random-secret>
```

Generate one with:

```bash
openssl rand -hex 32
```

Changing the secret invalidates already-rendered registration challenges, which
is acceptable. It does not affect existing users.

## Realm Configuration

Fresh realm imports enable registration and email verification through
`keycloak/realm-export.json`, but the ALTCHA execution should still be applied
after Keycloak has loaded the provider JAR.

Existing Keycloak databases are not automatically changed by realm imports.
After deploying the provider and restarting Keycloak, always run:

```bash
make keycloak-registration
```

The script:

- enables self-registration,
- enables email verification,
- keeps duplicate emails disabled,
- copies the built-in `registration` flow to `contenthub registration` if needed,
- points the realm registration flow to `contenthub registration`,
- adds the `registration-altcha-action` execution to the copied form subflow,
- marks the ALTCHA execution as `REQUIRED`.

If the script reports that it cannot find `registration-altcha-action`, rebuild
the provider and restart Keycloak so the JAR is loaded.

If the Keycloak admin API credentials are unavailable on an existing server,
use the database fallback only as an operational repair path:

```bash
make keycloak-registration-db
```

That fallback updates the currently active registration flow directly in the
Keycloak database and restarts Keycloak. Prefer `make keycloak-registration`
whenever valid admin API credentials are available.

## Manual Admin Console Setup

If needed, configure the flow manually:

1. Open `Authentication -> Flows`.
2. Duplicate the built-in `registration` flow, for example as
   `contenthub registration`.
3. Open the copied flow and expand its form subflow, usually named
   `contenthub registration registration form`.
4. Add execution `ALTCHA` to that form subflow.
5. Set the `ALTCHA` execution requirement to `Required`.
6. Open `Realm settings -> Login`.
7. Set the registration flow to `contenthub registration`.
8. Enable `User registration`.
9. Enable `Verify email`.
10. Keep `Duplicate emails` disabled.

The provider can read its HMAC secret from `ALTCHA_HMAC_SECRET`, so the
execution does not need to store the secret in Keycloak's database. If you do
set a secret in the execution config, it takes precedence over the environment
variable.

## Operational Notes

ALTCHA raises the cost of automated registrations but does not replace rate
limits. Keep reverse-proxy rate limits for registration, password reset, and
token endpoints, and keep Keycloak brute-force protection enabled.

The production nginx facade applies per-client rate limits to the most sensitive
Keycloak endpoints:

- registration: 5 requests per minute, with a burst of 5,
- password reset: 10 requests per minute, with a burst of 10,
- token endpoint: 120 requests per minute, with a burst of 120.

The token endpoint limit is intentionally higher because normal OIDC login and
refresh flows use it, and multiple legitimate users may share one institutional
NAT address.

The vendored browser widget must be the regular ALTCHA browser bundle, not the
`external` bundle. The versioned theme asset
`resources/js/altcha/altcha-main-3.0.11.min.js` is copied from
`dist/main/altcha.min.js`. The provider emits `PBKDF2/SHA-256` challenges by
default, and the `external` bundle does not include the worker/algorithm
registration needed to solve them in the browser.

Newly registered users should receive only minimal default roles. Access to ACPs
and administrative features must continue to be controlled by Content Hub roles
and access configuration.

The default Keycloak realm role is `user`. That role is not sufficient for
Content Hub administration or ACP management; application access still depends on
local `APP_ADMIN` status and explicit ACP roles.
