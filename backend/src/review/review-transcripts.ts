// IQB unit profiles p12/p16/p17 use iqb_transcript; p52/p55 use
// iqb_final_transcript. p52-p55 also contain iqb_copyright_original.
// https://github.com/iqb-vocabs/p12/blob/master/unit.json
// https://github.com/iqb-vocabs/p53/blob/master/unit.json
// https://github.com/iqb-vocabs/p55/blob/master/unit.json
const transcriptIds = new Set([
  "iqb_transcript",
  "iqb_final_transcript",
  "iqb_copyright_original",
]);

export function isReviewTranscript(entry: {
  id: string;
  label: string;
  value: string;
}): boolean {
  // The legacy p53/p54 field k6 is only identifiable by its label:
  // p16/p17 use the same ID for background noise ("Nebengeräusche").
  return (
    Boolean(entry.value) &&
    (transcriptIds.has(entry.id) ||
      (entry.id === "k6" &&
        entry.label.toLocaleLowerCase("de").replace(/\s+/g, " ") ===
          "transkript zur aufgabe"))
  );
}
