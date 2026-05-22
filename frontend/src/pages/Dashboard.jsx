export default function Dashboard() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">SwingTrader Pro Agent</h1>
      <p className="text-sm text-gray-500">Research alerts only. Human approval required.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <section className="border rounded p-4">Today's Top Alerts</section>
        <section className="border rounded p-4">Market Regime Panel</section>
        <section className="border rounded p-4">Watchlist</section>
        <section className="border rounded p-4">Rejected Setups</section>
      </div>
    </div>
  );
}
