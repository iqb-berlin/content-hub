import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import unittest
from urllib.parse import parse_qs, urlsplit

spec = importlib.util.spec_from_file_location("client_migration", Path(__file__).with_name("migrate-keycloak-client.py"))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class ClientMigrationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.env = self.directory / ".env"
        self.env.write_text("KEYCLOAK_ADMIN_USER=operator\nKEYCLOAK_ADMIN_PASSWORD=test-password\nOIDC_CLIENT_ID=contentpool\nCONTENT_POOL_HOST=iqb-contentpool.de\nOIDC_REDIRECT_URI=https://iqb-contentpool.de/auth/callback\n")
        self.clients = [{"id": "stable-uuid", "clientId": "contentpool", "redirectUris": ["https://iqb-contentpool.de/auth/callback"], "attributes": {"pkce.code.challenge.method": "S256"}}]
        self.puts = []
        state = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def send_json(self, data):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(data).encode())

            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                self.send_json({"access_token": "test-token"})

            def do_GET(self):
                query = parse_qs(urlsplit(self.path).query)
                if query:
                    self.send_json([c for c in state.clients if c["clientId"] == query["clientId"][0]])
                else:
                    self.send_json(next(c for c in state.clients if self.path.endswith(c["id"])))

            def do_PUT(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                state.puts.append(body)
                state.clients = [body if c["id"] == body["id"] else c for c in state.clients]
                self.send_response(204)
                self.end_headers()

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def args(self, apply=True, backup="backup"):
        return argparse.Namespace(env_file=str(self.env), url=f"http://127.0.0.1:{self.server.server_port}", realm="iqb", from_client="contentpool", to_client="contenthub", apply=apply, backup_dir=str(self.directory / backup))

    def test_preview_then_migration_preserves_uuid_urls_and_secure_backup(self):
        original = self.env.read_text()
        migration.migrate(self.args(apply=False))
        self.assertEqual(self.env.read_text(), original)
        self.assertEqual(self.puts, [])
        migration.migrate(self.args())
        self.assertEqual(self.clients[0]["id"], "stable-uuid")
        self.assertEqual(self.clients[0]["clientId"], "contenthub")
        self.assertEqual(self.clients[0]["redirectUris"], ["https://iqb-contentpool.de/auth/callback"])
        self.assertEqual(self.clients[0]["attributes"]["pkce.code.challenge.method"], "S256")
        self.assertEqual((self.directory / "backup/deployment.env").read_text(), original)
        self.assertEqual((self.directory / "backup/client.json").stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.env.read_text(), original.replace("OIDC_CLIENT_ID=contentpool", "OIDC_CLIENT_ID=contenthub"))
        migration.migrate(self.args(backup="repeat-backup"))
        self.assertEqual(len(self.puts), 1)

    def test_existing_target_is_never_overwritten(self):
        self.clients.append({"id": "other-uuid", "clientId": "contenthub"})
        original = self.env.read_text()
        with self.assertRaisesRegex(ValueError, "Ambiguous"):
            migration.migrate(self.args())
        self.assertEqual(self.env.read_text(), original)
        self.assertEqual(self.puts, [])


if __name__ == "__main__":
    unittest.main()
