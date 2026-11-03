/** A protocol fixture, not an Aspect renderer. Echoes only the active session. */
export const responseStatePlayerHtml = `<!doctype html><html><body>
<label>Testantwort <input id="answer" /></label>
<script>
let sessionId;
let dataParts = {};
const answer = document.querySelector('#answer');
function report() {
  parent.postMessage({ type: 'vopStateChangedNotification', sessionId,
    unitState: { dataParts } }, '*');
}
window.addEventListener('message', event => {
  if (event.source !== parent || event.data?.type !== 'vopStartCommand') return;
  sessionId = event.data.sessionId;
  dataParts = { ...(event.data.unitState?.dataParts || {}) };
  answer.value = dataParts.answer || '';
  report();
});
answer.addEventListener('input', () => {
  dataParts = { ...dataParts, answer: answer.value };
  report();
});
</script></body></html>`;
