import glmLogo from '../../assets/providers/GLM.svg';

import { LogoImage } from './logo-image.js';

export function GlmLogo(input: { readonly size?: number }) {
  return <LogoImage src={glmLogo} size={input.size} />;
}
