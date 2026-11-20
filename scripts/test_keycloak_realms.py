import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class KeycloakRealmTest(unittest.TestCase):
    def test_frontend_logout_target_is_allowed_for_every_configured_origin(self):
        # AuthService.logout returns to the login page, including on port 4201.
        for name in ("realm-export.dev.json", "realm-export.json"):
            realm = json.loads((ROOT / "keycloak" / name).read_text())
            client = next(c for c in realm["clients"] if c["clientId"] == "contenthub")
            allowed = client["attributes"]["post.logout.redirect.uris"].split("##")
            for origin in client["webOrigins"]:
                with self.subTest(realm=name, origin=origin):
                    self.assertIn(origin.rstrip("/") + "/login", allowed)


if __name__ == "__main__":
    unittest.main()
