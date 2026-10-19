"use client";

import { useEffect, useState } from "react";
import type { SearchView } from "./core";
import styles from "./company-url-search.module.css";

type InvestorOption = { id: string; name: string };
const stateLabel = { SEARCHING: "Searching", SAVED: "Saved", EMPTY: "No websites found", FAILED: "Failed" };

export default function CompanyUrlSearch({ initialInvestorId }: { initialInvestorId: string }) {
  const [investors, setInvestors] = useState<InvestorOption[]>([]);
  const [investorId, setInvestorId] = useState(initialInvestorId);
  const [searches, setSearches] = useState<SearchView[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh(id: string, signal?: AbortSignal) {
    const response = await fetch("/api/company-url-search" + (id ? "?investorId=" + encodeURIComponent(id) : ""), { signal, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load company websites.");
    if (signal?.aborted) return;
    setInvestors(data.investors);
    setSearches(data.searches);
    if (!id && data.investors.length) setInvestorId(data.investors[0].id);
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setSearches([]);
    void refresh(investorId, controller.signal).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load company websites.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    // Poll persisted history so reloads also recover interrupted searches.
    const interval = setInterval(() => {
      void refresh(investorId, controller.signal).catch(error => {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to refresh saved searches.");
      });
    }, 5_000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [investorId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/company-url-search", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ investorId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Company website search failed.");
      // The server returns a committed record, not an unsaved model response.
      setSearches(current => [data.search, ...current.filter(search => search.id !== data.search.id)].slice(0, 20));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Search interrupted. Check the saved search history below.");
    } finally {
      try { await refresh(investorId); } catch { setError(current => current || "Unable to reload saved results. Reload this page to check persistence."); }
      setBusy(false);
    }
  }

  return <main className={styles.page}>
    <a className={styles.back} href="/">← Investors and research</a>
    <p className="eyebrow">INVESTOR RESEARCH</p>
    <h1>Company websites</h1>
    <p className={styles.intro}>Find websites of companies an investor has invested in. Saved web-search findings may be incomplete or outdated; supporting links are included where available.</p>
    <form className={styles.form} onSubmit={submit}>
      <label htmlFor="company-url-investor">Investor</label>
      <div className={styles.controls}>
        <select id="company-url-investor" value={investorId} onChange={event => setInvestorId(event.target.value)} disabled={busy || loading} required>
          <option value="">Select an investor</option>
          {investors.map(investor => <option key={investor.id} value={investor.id}>{investor.name}</option>)}
        </select>
        <button className="primary" disabled={busy || loading || !investorId}>{busy ? "Searching…" : "Find company websites"}</button>
      </div>
      <p>Searches for up to 30 companies at a time. Each search is saved separately.</p>
    </form>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {busy && <p role="status">Searching for invested companies and saving their website links…</p>}
    {loading ? <p>Loading saved searches…</p> : !investors.length ? <p>No investors are available yet. Add investors through the existing investor intake.</p> : !searches.length && <p>No saved searches for this investor yet.</p>}
    <div className={styles.history}>
      {searches.map(search => <section key={search.id} className={styles.search}>
        <div className={styles.searchHeader}>
          <h2>{search.investorName}</h2>
          <span>{stateLabel[search.state]}{search.state === "SAVED" ? ` · ${search.resultCount} website${search.resultCount === 1 ? "" : "s"}` : ""}</span>
        </div>
        <p className={styles.date}>{new Date(search.createdAt).toLocaleString()}</p>
        {search.error && <p className={styles.error}>{search.error}</p>}
        {search.notes && <p>{search.notes}</p>}
        {search.rejectedCount > 0 && <p>{search.rejectedCount} entries omitted because they did not contain eligible company website URLs.</p>}
        {search.links.length > 0 && <div className={styles.tableWrap}><table>
          <thead><tr><th>Invested company</th><th>Company website</th><th>Supporting links</th></tr></thead>
          <tbody>{search.links.map(link => <tr key={link.websiteUrl}>
            <td>{link.name}</td>
            <td><a href={link.websiteUrl} target="_blank" rel="noreferrer">{link.websiteUrl}</a></td>
            <td>{link.evidenceUrls.length ? link.evidenceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">Source {index + 1}</a>) : "Not supplied"}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>)}
    </div>
  </main>;
}
