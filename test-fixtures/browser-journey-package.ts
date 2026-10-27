import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Shared with the synthetic ASPECT pool; only this task is needed by the journeys.
export const journeyUnitId = "journey-u1";
export const journeyUnitName = "Ein Ausflug zum See";
export const journeyBookletId = "journey-review";
const source = resolve(__dirname, "synthetic-aspect");
const unit = JSON.parse(readFileSync(resolve(source, "u1.json"), "utf8"));
const playerName = "iqb-player-aspect-3.0.1.html";
const player = readFileSync(resolve(source, playerName));
if (
  createHash("sha256").update(player).digest("hex") !==
  "54ee0f792c105c933b1c811ded0ee54eefae8502fa690edb18f6dd0b71c803c2"
) {
  throw new Error("Browser journey ASPECT player checksum mismatch.");
}

const textFile = (name: string, type: string, content: string) => ({
  name,
  type,
  buffer: Buffer.from(content),
});
export const journeyFiles = [
  { name: playerName, type: "PLAYER", buffer: player },
  textFile(
    `${journeyUnitId}.xml`,
    "UNIT_XML",
    `<Unit><Id>${journeyUnitId}</Id><Label>${journeyUnitName}</Label><DefinitionRef player="iqb-player-aspect@3.0">${journeyUnitId}.voud</DefinitionRef><CodingSchemeRef>${journeyUnitId}.vocs</CodingSchemeRef><Reference>${journeyUnitId}.vomd</Reference></Unit>`,
  ),
  textFile(
    `${journeyUnitId}.voud`,
    "UNIT_DEFINITION",
    JSON.stringify(unit.definition),
  ),
  textFile(
    `${journeyUnitId}.vocs`,
    "CODING_SCHEME",
    JSON.stringify(unit.codingScheme),
  ),
  textFile(
    `${journeyUnitId}.vomd`,
    "ITEM_METADATA",
    JSON.stringify({
      profiles: [],
      items: [
        {
          id: "wahl",
          uuid: "journey-choice",
          variableId: "WAHL",
          description: "Ausflugsziel",
          profiles: [],
        },
        {
          id: "fahrt",
          uuid: "journey-transport",
          variableId: "FAHRT",
          description: "Verkehrsmittel",
          profiles: [],
        },
      ],
    }),
  ),
  textFile(
    "journey-review.xml",
    "BOOKLET_XML",
    `<Booklet><Metadata><Id>${journeyBookletId}</Id><Label>Review E2E</Label></Metadata><Units><Unit id="${journeyUnitId}" label="${journeyUnitName}"/></Units></Booklet>`,
  ),
];
