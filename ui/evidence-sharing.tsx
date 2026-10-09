import React, { useEffect, useRef, useState } from "react";
type Api = (path: string, method?: string, data?: unknown) => Promise<any>;
const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(
    minor / 100,
  );
const stage = (kind: string) =>
  ({
    agreement: "Agreement",
    invoice: "Invoice",
    payment: "Payment",
    fulfillment: "Delivery",
    other: "Other evidence",
  })[kind] ?? kind;
export function CopyLink({ link }: { link: string }) {
  const input = useRef<HTMLInputElement>(null),
    [message, setMessage] = useState("");
  return (
    <div className="copy-link">
      <label>
        Shareable link
        <input
          ref={input}
          value={link}
          readOnly
          onFocus={(e) => e.target.select()}
        />
      </label>
      <div className="actions">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setMessage("Link copied.");
            } catch {
              input.current?.select();
              setMessage(
                document.execCommand("copy")
                  ? "Link copied."
                  : "Select the link and copy it manually.",
              );
            }
          }}
        >
          Copy link
        </button>
        <a href={link} target="_blank" rel="noreferrer">
          Open link
        </a>
      </div>
      <p role="status">{message}</p>
    </div>
  );
}
export function ShareControls({
  api,
  eventIds,
  title,
  pack = false,
}: {
  api: Api;
  eventIds: string[];
  title: string;
  pack?: boolean;
}) {
  const [link, setLink] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [shares, setShares] = useState<any[]>([]),
    [days, setDays] = useState(30),
    [label, setLabel] = useState(title);
  const selection = eventIds.join(",");
  const refresh = async () => setShares(await api("/shares"));
  useEffect(() => {
    setLink("");
    setLabel(title);
    refresh().catch((e) => setError(e.message));
  }, [selection, title]);
  const applicable = shares.filter((x) =>
    pack ? true : x.eventIds.length === 1 && x.eventIds[0] === eventIds[0],
  );
  return (
    <section className="card share-card">
      <h3>
        {pack ? "Share Commercial Evidence Pack" : "Share Commercial Evidence"}
      </h3>
      <p>
        Recipients can open the evidence and its documents without signing in.
        Anyone with the link can view it.
      </p>
      <p className="muted">
        The link captures the current evidence. Later changes need a new link.
      </p>
      {pack && (
        <label>
          Pack title
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={150}
          />
        </label>
      )}
      <label>
        Link expires after
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </label>
      <button
        type="button"
        disabled={busy || !eventIds.length || label.trim().length < 2}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await api("/shares", "POST", {
              eventIds,
              title: label,
              expiresDays: days,
            });
            setLink(location.origin + r.path);
            await refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Creating link…"
          : pack
            ? "Create pack link"
            : "Create evidence link"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {link && <CopyLink link={link} />}
      {!!applicable.length && (
        <details>
          <summary>Manage existing links</summary>
          {applicable.map((x) => (
            <div className="share-item" key={x.id}>
              <b>{x.title}</b>
              <small>
                Captured {new Date(x.created_at).toLocaleString()} ·{" "}
                {x.eventIds.length} evidence record(s)
              </small>
              <small>
                {x.revoked
                  ? "Revoked"
                  : Date.parse(x.expires_at) < Date.now()
                    ? "Expired"
                    : "Expires " + new Date(x.expires_at).toLocaleDateString()}
              </small>
              {!x.revoked && (
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await api("/shares/" + x.id + "/revoke", "POST", {});
                      setLink("");
                      await refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Revoke link
                </button>
              )}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
export function PackBuilder({ api, events }: { api: Api; events: any[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const included = selected.filter((id) => events.some((e) => e.id === id));
  return (
    <section className="pack-builder">
      <div className="card">
        <h3>Build a Commercial Evidence Pack</h3>
        <p>
          Select the work you want to share. Your other evidence stays private.
        </p>
        {events.map((event) => (
          <label className="check-row" key={event.id}>
            <input
              type="checkbox"
              checked={included.includes(event.id)}
              disabled={included.length >= 20 && !included.includes(event.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...included, event.id]
                    : included.filter((id) => id !== event.id),
                )
              }
            />
            <span>
              <b>{event.title}</b>
              <small>
                {event.counterparty} · {event.currency}
              </small>
            </span>
          </label>
        ))}
        <p>{included.length} selected · up to 20 per pack</p>
      </div>
      <ShareControls
        api={api}
        eventIds={included}
        title="Commercial Evidence Pack"
        pack
      />
    </section>
  );
}
export function ConfirmationControls({
  api,
  event,
  onRefresh,
}: {
  api: Api;
  event: any;
  onRefresh: () => Promise<any>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [link, setLink] = useState(""),
    [message, setMessage] = useState("");
  return (
    <section className="card">
      <h3>Client confirmation</h3>
      <p>
        Your client can open the documents, confirm or dispute this evidence,
        and optionally leave a review. No account is needed.
      </p>
      {event.attestations.map((x: any) => (
        <article className="client-verdict" key={x.id}>
          <b>
            {x.status === "confirmed"
              ? "Confirmed"
              : x.status === "disputed"
                ? "Disputed"
                : "Awaiting client response"}
            {x.status !== "pending"
              ? " by " + (x.name || "an unnamed client")
              : ""}
          </b>
          <small>
            {x.responded_at
              ? new Date(x.responded_at).toLocaleString()
              : new Date(x.created_at).toLocaleString()}{" "}
            ·{" "}
            {x.revision === event.revision
              ? "Current evidence"
              : "Earlier evidence version"}
          </small>
          {x.comment && <p>{x.comment}</p>}
          {(x.email || x.phone) && (
            <small>
              Private contact: {[x.email, x.phone].filter(Boolean).join(" · ")}
            </small>
          )}
          {x.review_consent === 1 && (
            <small>
              Client allows this review to be included when sharing evidence.
            </small>
          )}
          {x.notification_status && (
            <small>
              Email notification:{" "}
              {(
                {
                  sent: "sent to your signup email",
                  failed: "failed; response saved",
                  pending: "queued",
                  sending: "sending",
                  not_configured: "waiting for email service setup",
                } as any
              )[x.notification_status] ?? x.notification_status}
            </small>
          )}
        </article>
      ))}
      <p className="muted">
        Finish editing first. Changes invalidate pending confirmation links. A
        response stays tied to the version the client reviewed.
      </p>
      <div className="actions">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            setMessage("");
            try {
              const r = await api(
                "/events/" + event.id + "/attestations",
                "POST",
                {},
              );
              setLink(location.origin + r.path);
              setMessage("Link created. Copy it and send it to your client.");
              await onRefresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Creating link…" : "Create confirmation link"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onRefresh();
              setMessage("Client responses refreshed.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Refresh responses
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {link && <CopyLink link={link} />}
      <p className="muted">
        A response confirms link possession. Client identity is not
        independently verified.
      </p>
    </section>
  );
}
export function Notifications({ api }: { api: Api }) {
  const [value, setValue] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = async () => setValue(await api("/notifications"));
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  return (
    <section className="card">
      <h3>Client response notifications</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {value && (
        <>
          <p>
            Notifications go to your signup email: <b>{value.recipient}</b>.
          </p>
          {!value.configured && (
            <p className="muted">
              Email delivery is waiting for the operator to connect an email
              service. Client responses are still saved in your Commercial
              Evidence.
            </p>
          )}
          {value.items.map((x: any) => (
            <p key={x.id}>
              <b>{x.subject}</b>
              <small className="block">
                {x.status.replace("_", " ")} ·{" "}
                {new Date(x.created_at).toLocaleString()}
              </small>
              {x.last_error && <small className="block">{x.last_error}</small>}
            </p>
          ))}
          {value.configured && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api("/notifications/retry", "POST", {});
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Sending…" : "Retry pending notifications"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
function RecordDetails({
  record,
  invoice = false,
}: {
  record: any;
  invoice?: boolean;
}) {
  return (
    <dl className="evidence-details">
      {invoice && (
        <>
          <dt>Invoice number</dt>
          <dd>{record.invoiceNumber}</dd>
        </>
      )}
      <dt>Client</dt>
      <dd>{record.counterparty}</dd>
      {record.service && (
        <>
          <dt>Work</dt>
          <dd>{record.service}</dd>
        </>
      )}
      <dt>Amount</dt>
      <dd>{money(record.amount.amountMinor, record.amount.currency)}</dd>
      <dt>Date</dt>
      <dd>{record.effectiveDate || record.issuedDate || "Not recorded"}</dd>
      {record.reference && (
        <>
          <dt>Reference</dt>
          <dd>{record.reference}</dd>
        </>
      )}
    </dl>
  );
}
export function EvidenceView({
  event,
  fileBase,
}: {
  event: any;
  fileBase: string;
}) {
  return (
    <article className="public-evidence">
      <header>
        <h2>{event.title}</h2>
        <p>
          {event.business} · Client: {event.counterparty}
        </p>
        <p>{event.service}</p>
        <small>Evidence version {event.revision}</small>
      </header>
      {["agreement", "invoice", "payment", "fulfillment", "other"].map(
        (kind) => {
          const files = (event.files ?? []).filter((f: any) => f.kind === kind);
          const record =
            kind === "agreement"
              ? event.agreement
              : kind === "invoice"
                ? event.invoice
                : kind === "fulfillment"
                  ? event.fulfillment
                  : null;
          return (
            <section className="card" key={kind}>
              <h3>{stage(kind)}</h3>
              {["agreement", "invoice"].includes(kind) && record && (
                <RecordDetails record={record} invoice={kind === "invoice"} />
              )}
              {kind === "payment" &&
                (event.payments ?? []).map((p: any, i: number) => (
                  <div className="record" key={i}>
                    <b>
                      {p.direction === "debit"
                        ? "Money returned / debited"
                        : "Money received"}
                      : {money(p.amount.amountMinor, p.amount.currency)}
                    </b>
                    <p>
                      {p.counterparty} · {p.transactionDate || p.date}
                    </p>
                    <small>
                      Reference:{" "}
                      {p.reference || p.transactionId || "Not supplied"}
                    </small>
                  </div>
                ))}
              {kind === "fulfillment" && record && (
                <>
                  <p>
                    {record.status === "completed"
                      ? "Completed"
                      : "In progress"}
                  </p>
                  <p>{record.description}</p>
                  {record.completedDate && (
                    <small>Completed {record.completedDate}</small>
                  )}
                </>
              )}
              {!record && kind !== "payment" && !files.length && (
                <p className="muted">Not supplied</p>
              )}
              {kind === "payment" &&
                !event.payments?.length &&
                !files.length && <p className="muted">Not supplied</p>}
              {files.map((f: any) => (
                <div className="shared-document" key={f.id}>
                  <a href={fileBase + f.id} target="_blank" rel="noreferrer">
                    View / download {f.name}
                  </a>
                  {["image/png", "image/jpeg"].includes(f.mime) && (
                    <img
                      loading="lazy"
                      src={fileBase + f.id}
                      alt={stage(kind) + " evidence: " + f.name}
                    />
                  )}
                </div>
              ))}
              {!!files.length &&
                !record &&
                (kind !== "payment" || !event.payments?.length) && (
                  <p className="muted">
                    Original document supplied. Its contents have not been read
                    automatically.
                  </p>
                )}
            </section>
          );
        },
      )}
      {!!event.confirmations?.length && (
        <section className="card">
          <h3>Client verdicts</h3>
          {event.confirmations.map((c: any, i: number) => (
            <div className="client-verdict" key={i}>
              <b>
                {c.status}
                {c.name ? " by " + c.name : ""}
              </b>
              <small>
                {c.revision === event.revision
                  ? "For this version"
                  : "For an earlier version"}{" "}
                · {new Date(c.responded_at).toLocaleString()}
              </small>
              {c.review && <p>{c.review}</p>}
            </div>
          ))}
        </section>
      )}
      {event.assessment && (
        <section className="card">
          <h3>Evidence assessment</h3>
          <p>{event.assessment.summary}</p>
          {event.assessment.stale && (
            <p>Evidence has changed since this assessment.</p>
          )}
          {event.assessment.reasons?.map((r: any, i: number) => (
            <p key={i}>
              <b>{r.status}: </b>
              {r.message}
            </p>
          ))}
          <p className="muted">
            Supporting evidence for human review. No lending decision or
            document authenticity verification is made.
          </p>
        </section>
      )}
    </article>
  );
}
export function SharedPack({ token, api }: { token: string; api: Api }) {
  const [value, setValue] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("/shared/" + token)
      .then(setValue)
      .catch((e) => setError(e.message));
  }, [token]);
  return (
    <main className="public-review">
      <div className="brand">AUDITTRAK</div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : !value ? (
        <p role="status">Loading shared evidence…</p>
      ) : (
        <>
          <h1>{value.title}</h1>
          <p>
            {value.events.length === 1
              ? "Commercial Evidence"
              : "Commercial Evidence Pack"}{" "}
            · {value.events.length} evidence record(s)
          </p>
          <p className="muted">
            Captured {new Date(value.created_at).toLocaleString()} · Link
            expires {new Date(value.expires_at).toLocaleDateString()}
          </p>
          <section className="card">
            <h2>Overview</h2>
            {value.events.map((e: any) => (
              <p key={e.id}>
                <a href={"#evidence-" + e.id}>{e.title}</a> · {e.counterparty}
              </p>
            ))}
            {Object.entries(value.totals).map(([currency, total]) => (
              <p key={currency}>
                Net recorded payments: {money(Number(total), currency)}
              </p>
            ))}
            {!!value.unreadReceipts && (
              <p>
                {value.unreadReceipts} receipt(s) have no entered amount and are
                not included in totals.
              </p>
            )}
            <p className="muted">
              Totals cover only the selected evidence. They are recorded
              amounts, not verified income; mixed currencies are not combined.
            </p>
          </section>
          {value.events.map((event: any) => (
            <div id={"evidence-" + event.id} key={event.id}>
              <EvidenceView
                event={event}
                fileBase={"/api/v1/shared/" + token + "/files/"}
              />
            </div>
          ))}
        </>
      )}
    </main>
  );
}
export function ClientConfirmation({
  token,
  api,
}: {
  token: string;
  api: Api;
}) {
  const [value, setValue] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [verdict, setVerdict] = useState("confirmed");
  useEffect(() => {
    api("/attest/" + token)
      .then(setValue)
      .catch((e) => setError(e.message));
  }, [token]);
  return (
    <main className="public-review">
      <div className="brand">AUDITTRAK</div>
      <h1>Review and confirm Commercial Evidence</h1>
      <p>No account is needed. Review the evidence below before responding.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!value && !error && <p role="status">Loading evidence…</p>}
      {value && (
        <>
          <EvidenceView
            event={value}
            fileBase={"/api/v1/attest/" + token + "/files/"}
          />
          {done || value.status !== "pending" ? (
            <section className="card notice" role="status">
              <h2>Response recorded</h2>
              <p>
                Thank you. Your{" "}
                {done
                  ? verdict === "confirmed"
                    ? "confirmation"
                    : "dispute"
                  : "response"}{" "}
                has been saved for the freelancer.
              </p>
            </section>
          ) : (
            <section className="card">
              <h2>Your verdict</h2>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const data = Object.fromEntries(
                    new FormData(e.currentTarget),
                  );
                  setBusy(true);
                  setError("");
                  try {
                    await api("/attest/" + token, "POST", {
                      ...data,
                      status: verdict,
                      reviewConsent: data.reviewConsent === "on",
                    });
                    setDone(true);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <div
                  className="entry-options"
                  role="group"
                  aria-label="Your verdict"
                >
                  <button
                    type="button"
                    className={verdict === "confirmed" ? "" : "secondary"}
                    aria-pressed={verdict === "confirmed"}
                    onClick={() => setVerdict("confirmed")}
                  >
                    Yes, this is correct
                  </button>
                  <button
                    type="button"
                    className={verdict === "disputed" ? "" : "secondary"}
                    aria-pressed={verdict === "disputed"}
                    onClick={() => setVerdict("disputed")}
                  >
                    Something is incorrect
                  </button>
                </div>
                <label>
                  Your name (optional)
                  <input name="name" maxLength={150} />
                </label>
                <label>
                  Email (optional, private to the freelancer)
                  <input name="email" type="email" maxLength={200} />
                </label>
                <label>
                  Phone (optional, private to the freelancer)
                  <input name="phone" type="tel" maxLength={30} />
                </label>
                <label>
                  {verdict === "confirmed"
                    ? "Review or comment (optional)"
                    : "Explain what is incorrect (optional)"}
                  <textarea
                    name="comment"
                    maxLength={2000}
                    placeholder="For example: The work was delivered on time."
                  />
                </label>
                <label className="check-row">
                  <input name="reviewConsent" type="checkbox" />
                  <span>
                    I allow my name and review to be included when the
                    freelancer shares this evidence. My email and phone stay
                    private.
                  </span>
                </label>
                {error && (
                  <p role="alert" className="error">
                    {error}
                  </p>
                )}
                <button disabled={busy}>
                  {busy ? "Saving response…" : "Submit response"}
                </button>
                <p className="muted">
                  Only respond if this link was intended for you. No identity
                  verification is performed.
                </p>
              </form>
            </section>
          )}
        </>
      )}
    </main>
  );
}
