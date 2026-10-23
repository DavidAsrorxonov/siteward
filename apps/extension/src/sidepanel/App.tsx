export default function App() {
  return (
    <main className="app">
      <header className="app-header">
        <h1>Siteward</h1>
        <p>Your important sites, in one place.</p>
      </header>

      <section className="empty-state" aria-labelledby="empty-state-title">
        <h2 id="empty-state-title">No saved sites yet</h2>
        <p>Your saved sites will appear here.</p>
      </section>
    </main>
  );
}
