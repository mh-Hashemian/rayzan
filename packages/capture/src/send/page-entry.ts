/**
 * Browser IIFE entry for managed Electron injection.
 * Bundled as `globalName: __rayzanChatGptSend`.
 */
export {
  chatgptComposer,
  chatgptIsGenerating,
  chatgptSendControl,
  chatgptSubmitAccepted,
  sendChatGptPrompt,
} from './chatgpt-send.js';
export { richComposerText, setRichComposerValue } from './rich-composer.js';
