import deepseekLogo from '../../assets/providers/DeepSeek.svg';

import { LogoImage } from './logo-image.js';

export function DeepSeekLogo(input: { readonly size?: number }) {
  return <LogoImage src={deepseekLogo} size={input.size} />;
}
