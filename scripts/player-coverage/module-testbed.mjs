/** A transparent Verona host for original modules; never changes the module HTML. */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
export async function createModuleTestbed(directory, assetOrigin, transform) {
  const server = createServer(async (request, response) => {
    if (assetOrigin && request.url?.startsWith("/api/shared-assets/")) {
      try {
        const result = await fetch(new URL(request.url, assetOrigin));
        response.statusCode = result.status;
        response.setHeader(
          "Content-Type",
          result.headers.get("content-type") || "application/octet-stream",
        );
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch {
        response.writeHead(502).end();
      }
      return;
    }
    if (request.url?.startsWith("/module/")) {
      const file = decodeURIComponent(request.url.slice("/module/".length));
      if (!/^players\/[\w.-]+\.html$/.test(file)) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      const content = readFileSync(resolve(directory, file));
      response.end(transform ? await transform(content.toString("utf8")) : content);
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html lang="de"><title>Verona-Modulprüfung</title><style>body{margin:0}iframe{border:0;width:100%;height:100vh}</style><script>
      window.moduleMessages=[];
      addEventListener('message',event=>{
        if(event.source!==document.querySelector('iframe')?.contentWindow)return;
        moduleMessages.push(event.data);
      });
    </script><iframe title="Originales Verona-Modul"></iframe></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
export async function loadModule(
  page,
  url,
  file,
  definition,
  editor = false,
  protocol = "vop",
  playerConfig = {},
) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate((file) => {
    document.querySelector("iframe").src = "/module/" + file;
  }, file);
  await page.waitForFunction(
    ({ editor, protocol }) =>
      window.moduleMessages.some(
        (message) =>
          message.type ===
          (editor
            ? "voeReadyNotification"
            : protocol === "legacy-vo"
              ? "vo.FromPlayer.ReadyNotification"
              : "vopReadyNotification"),
      ),
    { editor, protocol },
    { timeout: 20000 },
  );
  await page.evaluate(
    ({ definition, editor, protocol, playerConfig }) => {
      const frame = document.querySelector("iframe");
      const message = editor
        ? {
            type: "voeStartCommand",
            sessionId: "authoring-audit",
            unitDefinition: JSON.stringify(definition),
            editorConfig: { role: "super", directDownloadUrl: "" },
          }
        : protocol === "legacy-vo"
          ? {
              type: "vo.ToPlayer.DataTransfer",
              sessionId: "generation-audit",
              unitDefinition:
                typeof definition === "string"
                  ? definition
                  : JSON.stringify(definition),
            }
          : {
              type: "vopStartCommand",
              sessionId: "generation-audit",
              unitDefinition:
                typeof definition === "string"
                  ? definition
                  : JSON.stringify(definition),
              playerConfig: {
                stateReportPolicy: "eager",
                pagingMode: "buttons",
                unitNumber: 1,
                ...playerConfig,
              },
              unitState: { dataParts: {} },
            };
      frame.contentWindow.postMessage(message, "*");
    },
    { definition, editor, protocol, playerConfig },
  );
  return page.frameLocator("iframe");
}
