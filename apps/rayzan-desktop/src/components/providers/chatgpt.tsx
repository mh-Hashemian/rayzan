import chatgptLogo from '../../assets/providers/ChatGPT.svg';

import { LogoImage } from './logo-image.js';

export function ChatGptLogo(input: { readonly size?: number }) {
  return <LogoImage src={chatgptLogo} size={input.size} />;
}
