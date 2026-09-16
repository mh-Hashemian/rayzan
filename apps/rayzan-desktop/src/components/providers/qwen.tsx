import qwenLogo from '../../assets/providers/Qwen.svg';

import { LogoImage } from './logo-image.js';

export function QwenLogo(input: { readonly size?: number }) {
  return <LogoImage src={qwenLogo} size={input.size} />;
}
