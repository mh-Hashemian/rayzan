import { NAV_ITEMS, type ProductPage } from '../navigation.js';

export function Sidebar(input: {
  readonly page: ProductPage;
  readonly runtimeReady: boolean;
  readonly connecting: boolean;
  readonly onNavigate: (page: ProductPage) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="28" height="28">
            <path
              d="M16 3 L19 14 L29 16 L19 18 L16 29 L13 18 L3 16 L13 14 Z"
              fill="currentColor"
            />
          </svg>
        </div>
        <div>
          <p className="brand-name">Rayzan</p>
          <p className="brand-tag">From many perspectives.</p>
        </div>
      </div>

      <nav className="side-nav" aria-label="Main">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === input.page ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              input.onNavigate(item.id);
            }}
          >
            <span className="nav-icon" aria-hidden="true">
              {icon(item.id)}
            </span>
            {item.label}
          </button>
        ))}
      </nav>

      <p className="side-quote">
        Better questions. Broader perspectives. Clearer decisions.
      </p>

      <div className="side-footer">
        <span
          className={
            input.connecting ? 'dot' : input.runtimeReady ? 'dot ok' : 'dot warn'
          }
          aria-hidden="true"
        />
        {input.connecting
          ? 'Connecting…'
          : input.runtimeReady
            ? 'Runtime connected'
            : 'Runtime stopped'}
      </div>
    </aside>
  );
}

function icon(page: ProductPage): string {
  switch (page) {
    case 'home':
      return '⌂';
    case 'new-decision':
      return '+';
    case 'debates':
      return '☰';
    case 'library':
      return '▦';
    case 'settings':
      return '⚙';
  }
}
