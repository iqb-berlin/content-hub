# Keycloak theme provenance and notices

The login form (`login/login.ftl`) and page layout (`login/template.ftl`)
contain adaptations of Keycloak login templates distributed under the Apache
License, Version 2.0. The complete license is included in `LICENSE.txt`.

The adaptations change login labels, form behavior, styling, accessibility,
page layout, product branding and resource links for IQB ContentPool / Content
Hub. Each modified file carries its own modification notice.

The provenance review compared the templates with these official sources:

- [Keycloak 24.0.1 login form](https://github.com/keycloak/keycloak/blob/24.0.1/themes/src/main/resources/theme/base/login/login.ftl)
- [Keycloak 24.0.1 page layout](https://github.com/keycloak/keycloak/blob/24.0.1/themes/src/main/resources/theme/base/login/template.ftl)
- [Keycloak 4.3.0.Final page layout](https://github.com/keycloak/keycloak/blob/4.3.0.Final/themes/src/main/resources/theme/base/login/template.ftl)
- [Keycloak 24.0.1 license](https://github.com/keycloak/keycloak/blob/24.0.1/LICENSE.txt)

These are comparison references; the exact version from which the original
local adaptations were made has not been reconstructed. No copyright ownership
of the Keycloak portions is assigned to the local project by this notice.

The vendored ALTCHA widget has its separate MIT license and copyright notice in
`login/resources/js/altcha/LICENSE.txt`. That text remains alongside the scripts.
This Apache license does not replace the terms of other third-party assets or
establish rights in all theme assets.

The theme directory, including this notice and `LICENSE.txt`, is mounted by the
Compose configurations and included by `scripts/build-runtime-bundle.sh`.
