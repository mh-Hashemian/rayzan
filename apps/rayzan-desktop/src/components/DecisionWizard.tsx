export function DecisionWizard() {
  return (
    <section className="page">
      <h1>New Decision</h1>
      <p className="lede">
        The decision wizard is the next checkpoint. This Step 1 shell does not
        start a debate yet.
      </p>
      <ol className="wizard-preview" aria-label="Planned workflow">
        <li>Define problem</li>
        <li>Configure agents</li>
        <li>Review and start</li>
      </ol>
    </section>
  );
}
