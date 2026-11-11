import { rewriteGeoGebraAssetUrls } from './geogebra-player-html.util';

/** Reviewed backports for immutable releases. Stored/downloaded modules are never changed. */
export const PLAYER_HTML_REPAIRS = [
  {
    id: 'abi-2-production-host',
    length: 11516595,
    sha256: '2ed1986d2cc63ddbfe612d32f6649e0b8eb7eb27c43a4fad8c9cc06707149742',
    source: 'ABI 2.0.1 src/app/app.component.ts: uninitialized property injection',
    before:
      'class AppComponent {\n        constructor(dialog) {\n            this.dialog = dialog;',
    after:
      'class AppComponent {\n        constructor(dialog) {\n            this.dialog = dialog;\n            this.isProductionMode = true;',
    additionalChanges: [
      { before: 'la(1,"player-component alive!")', after: 'la(1,"")' },
      { before: 'la(1, "player-component alive!")', after: 'la(1, "")' },
    ],
  },
  {
    id: 'aspect-3-readonly-controls',
    length: 3758696,
    sha256: '3999e2239000e7a20425434a5c56a235cd9b4716273bdb9dbd91b247ff32fc33',
    source: 'ASPECT 3.1.0 text-field.component.html and player element-form-group.directive.ts',
    before: '"ngIf",e.elementModel.clearable',
    after: '"ngIf",e.elementModel.clearable&&!e.elementModel.readOnly',
    additionalChanges: [
      {
        before: 'new iH(o,t.getValidators(i))',
        after:
          'new iH(i.readOnly&&["checkbox","radio","radio-group-images","dropdown","slider","likert-row"].includes(i.type)?{value:o,disabled:true}:o,t.getValidators(i))',
      },
    ],
  },
  {
    id: 'aspect-3-editor-readonly-clear',
    length: 4908684,
    sha256: '0c5e89d4f11eaf180b59f8fe62f909c9137b6e44378f7ed555931666fa3212c9',
    source: 'ASPECT 3.1.0 common/components/elements/text-field/text-field.component.html',
    before: '"ngIf",e.elementModel.clearable',
    after: '"ngIf",e.elementModel.clearable&&!e.elementModel.readOnly',
  },
] as const;

export async function preparePlayerHtml(content: string): Promise<string> {
  let html = content;
  const candidates = PLAYER_HTML_REPAIRS.filter((repair) => repair.length === html.length);
  if (candidates.length) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
    const hash = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    const repair = candidates.find((candidate) => candidate.sha256 === hash);
    if (repair) {
      for (const change of [
        repair,
        ...('additionalChanges' in repair ? repair.additionalChanges : []),
      ]) {
        if (html.split(change.before).length !== 2)
          throw new Error(`Ambiguous player compatibility repair: ${repair.id}`);
        html = html.replace(change.before, change.after);
      }
      html += `\n<!-- Content Hub compatibility: ${repair.id}; original SHA-256 ${hash} -->`;
    }
  }
  return rewriteGeoGebraAssetUrls(html);
}
