import { BadRequestException } from "@nestjs/common";
import { TextDecoder } from "util";

/** Parse records without ever including record contents in diagnostics. */
export function parseCredentialFile(
  buffer: Buffer,
): Array<{ username: string; password: string }> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new BadRequestException("Datei muss gültiges UTF-8 enthalten");
  }
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  // Detect separators in the first nonblank record without changing line numbers.
  let firstRecordStart = 0;
  while (text[firstRecordStart] === "\n") firstRecordStart++;
  let quoted = false;
  const counts = new Map([
    [",", 0],
    [";", 0],
    ["\t", 0],
  ]);
  for (let i = firstRecordStart; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    }
    if (!quoted && c === "\n") break;
    if (!quoted && counts.has(c)) counts.set(c, counts.get(c)! + 1);
  }
  const separator = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const rows: Array<{ line: number; fields: string[] }> = [];
  let fields: string[] = [],
    field = "",
    line = 1,
    startLine = 1,
    afterQuote = false,
    recordPresent = false;
  quoted = false;
  const fail = (message: string): never => {
    throw new BadRequestException({
      message: "Zugangsliste ist ungültig",
      errors: [{ line, message }],
    });
  };
  for (let i = 0; i <= text.length; i++) {
    const c = i === text.length ? "\n" : text[i];
    if (c !== "\n") recordPresent = true;
    if (quoted) {
      if (i === text.length) fail("Nicht geschlossenes Anführungszeichen");
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += c;
        if (c === "\n") line++;
      }
    } else if (c === separator || c === "\n") {
      fields.push(field);
      field = "";
      afterQuote = false;
      if (c === "\n") {
        if (recordPresent) rows.push({ line: startLine, fields });
        fields = [];
        recordPresent = false;
        line++;
        startLine = line;
      }
    } else if (c === '"' && field === "" && !afterQuote) quoted = true;
    else {
      if (afterQuote || c === '"') fail("Ungültiges CSV-Quoting");
      field += c;
    }
  }
  const userHeaders = ["username", "user", "benutzername", "nutzername"];
  const passwordHeaders = ["password", "passwort", "kennwort"];
  let userColumn = 0,
    passwordColumn = 1;
  const header = rows[0]?.fields.map((f) => f.trim().toLowerCase());
  if (
    header?.length === 2 &&
    header.some((f) => userHeaders.includes(f)) &&
    header.some((f) => passwordHeaders.includes(f))
  ) {
    userColumn = header.findIndex((f) => userHeaders.includes(f));
    passwordColumn = header.findIndex((f) => passwordHeaders.includes(f));
    rows.shift();
  }
  const errors: Array<{ line: number; message: string }> = [];
  const seen = new Map<string, number>();
  const result = rows.map((row) => {
    const username = (row.fields[userColumn] || "").trim();
    const password = row.fields[passwordColumn] || "";
    const error = (message: string) => errors.push({ line: row.line, message });
    if (row.fields.length !== 2) error("Genau zwei Spalten erwartet");
    if (!username) error("Nutzername fehlt");
    if (!password) error("Passwort fehlt");
    else if (
      !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])[\s\S]{12,}$/s.test(
        password,
      )
    )
      error(
        "Passwort benötigt mindestens 12 Zeichen, Groß-/Kleinbuchstaben, Zahl und Sonderzeichen",
      );
    if (seen.has(username))
      error(
        "Doppelter Nutzername; erstes Vorkommen in Zeile " + seen.get(username),
      );
    seen.set(username, row.line);
    return { username, password };
  });
  if (!result.length)
    errors.push({ line: 1, message: "Keine Zugangsdaten enthalten" });
  if (errors.length)
    throw new BadRequestException({
      message: "Zugangsliste ist ungültig",
      errors,
    });
  return result;
}
