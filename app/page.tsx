import { getPublicRuntimeStatus } from "@/lib/status";

export default function Home() {
  const status = getPublicRuntimeStatus();

  return (
    <main>
      <div className="shell">
        <div className="eyebrow">Order automation</div>
        <h1>Shopline paid orders to Ship&amp;Co</h1>
        <p>
          支払い完了になったShopline注文を受け取り、Ship&amp;Coのオーダーとして登録するための同期サーバーです。
        </p>

        <section className="grid">
          <div className="card">
            <h2>Endpoints</h2>
            <ul className="list">
              <li className="row">
                <span className="label">Shopline webhook</span>
                <span className="value">/api/shopline/webhook</span>
              </li>
              <li className="row">
                <span className="label">Direct create</span>
                <span className="value">/api/shipco/order</span>
              </li>
              <li className="row">
                <span className="label">Health</span>
                <span className="value">/api/health</span>
              </li>
            </ul>
          </div>

          <div className="card">
            <h2>Runtime</h2>
            <ul className="list">
              {status.map((item) => (
                <li className="row" key={item.label}>
                  <span className="label">{item.label}</span>
                  <span className={`pill ${item.ready ? "ok" : "warn"}`}>
                    {item.ready ? "ready" : "missing"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
