import grokLogo from '../../assets/providers/Grok.svg';

import { LogoImage } from './logo-image.js';

export function GrokLogo(input: { readonly size?: number }) {
  return <LogoImage src={grokLogo} size={input.size} />;
}
