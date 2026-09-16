export type ProductPage =
  | 'home'
  | 'new-decision'
  | 'active-decision'
  | 'debates'
  | 'library'
  | 'settings';

export const NAV_ITEMS: readonly {
  readonly id: Exclude<ProductPage, 'active-decision'>;
  readonly label: string;
}[] = [
  { id: 'home', label: 'Home' },
  { id: 'new-decision', label: 'New Decision' },
  { id: 'debates', label: 'Debates' },
  { id: 'library', label: 'Library' },
  { id: 'settings', label: 'Settings' },
];
