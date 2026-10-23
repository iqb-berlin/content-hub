import { BadRequestException } from "@nestjs/common";
import { parseCredentialFile } from "./credential-file";
const password = "Strong,Password123!";
describe("credential file parsing", () => {
  it.each([",", ";", "\t"])(
    "accepts BOM, CRLF, quoted fields and separator %s",
    (separator) => {
      const text =
        "\uFEFFBenutzername" +
        separator +
        'Kennwort\r\n"alice"' +
        separator +
        '"' +
        password +
        '"\r\n';
      expect(parseCredentialFile(Buffer.from(text))).toEqual([
        { username: "alice", password },
      ]);
    },
  );
  it("accepts reversed English headers, escaped quotes and multiline fields", () => {
    expect(
      parseCredentialFile(
        Buffer.from('password;username\n"Strong""Pass\n123!";alice'),
      ),
    ).toEqual([{ username: "alice", password: 'Strong"Pass\n123!' }]);
  });
  it("preserves spaces in passwords", () => {
    expect(
      parseCredentialFile(Buffer.from("alice; StrongPassword123! "))[0]
        .password,
    ).toBe(" StrongPassword123! ");
  });
  it.each([
    "alice;\n",
    ";StrongPassword123!\n",
    "alice;StrongPassword123!\nalice;OtherPassword123!",
    'alice;"unterminated',
    'alice;"abc"junk',
    "",
    "username,password",
  ])("rejects malformed data without exposing passwords", (text) => {
    try {
      parseCredentialFile(Buffer.from(text));
      throw new Error("expected failure");
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      expect(error.getStatus()).toBe(400);
      expect(JSON.stringify(error.getResponse())).not.toContain(
        "StrongPassword123!",
      );
      expect(JSON.stringify(error.getResponse())).not.toContain(
        "OtherPassword123!",
      );
    }
  });
  it.each([",", ";", "\t"])(
    "rejects explicitly empty records with %s",
    (separator) => {
      for (const row of [separator, '""' + separator + '""']) {
        expect(() =>
          parseCredentialFile(
            Buffer.from(
              "alice" + separator + "StrongPassword123!\n" + row + "\n",
            ),
          ),
        ).toThrow("Zugangsliste ist ungültig");
      }
    },
  );
  it("skips genuinely blank lines", () => {
    expect(
      parseCredentialFile(Buffer.from("alice;StrongPassword123!\n\n")),
    ).toEqual([{ username: "alice", password: "StrongPassword123!" }]);
  });
  it.each([",", ";", "\t"])(
    "detects separator %s after leading blank lines",
    (separator) => {
      for (const newline of ["\n", "\r\n", "\r"]) {
        for (const header of ["", `username${separator}password${newline}`]) {
          const text = `\uFEFF${newline}${newline}${header}alice${separator}"${password}"${newline}`;
          expect(parseCredentialFile(Buffer.from(text))).toEqual([
            { username: "alice", password },
          ]);
        }
      }
    },
  );
  it("preserves error line numbers after leading blank lines", () => {
    try {
      parseCredentialFile(Buffer.from("\n\nusername;password\nalice;\n"));
      throw new Error("expected failure");
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      expect(error.getResponse()).toEqual(
        expect.objectContaining({
          errors: [{ line: 4, message: "Passwort fehlt" }],
        }),
      );
    }
  });
  it("rejects invalid UTF-8", () =>
    expect(() => parseCredentialFile(Buffer.from([0xff, 0xfe]))).toThrow(
      "UTF-8",
    ));
});
