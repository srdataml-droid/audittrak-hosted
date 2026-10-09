import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
const api = async (path: string, method = "GET", data?: unknown) => {
  const r = await fetch("/api/v1" + path, {
    method,
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error ?? "Request failed");
  return value;
};
const money = (minor: number, currency = "NGN") =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(
    minor / 100,
  );
const date = () => new Date().toISOString().slice(0, 10);
const uid = () => crypto.randomUUID();
function Button({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props}>{children}</button>;
}
function Field({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isPassword = props.type === "password";
  return (
    <label>
      {label}
      {isPassword ? (
        <span className="password-control">
          <input
            {...props}
            type={passwordVisible ? "text" : "password"}
            autoComplete={props.autoComplete}
          />
          <button
            className="password-toggle"
            type="button"
            aria-label={passwordVisible ? "Hide password" : "Show password"}
            aria-pressed={passwordVisible}
            onClick={() => setPasswordVisible(!passwordVisible)}
          >
            {passwordVisible ? "Hide" : "Show"}
          </button>
        </span>
      ) : (
        <input {...props} />
      )}
    </label>
  );
}
function Badge({
  children,
  good = false,
}: {
  children: React.ReactNode;
  good?: boolean;
}) {
  return <span className={"badge " + (good ? "good" : "")}>{children}</span>;
}
function Form({
  title,
  children,
  submit,
}: {
  title: string;
  children: React.ReactNode;
  submit: (f: Record<string, string>) => Promise<any>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="card">
      <h3>{title}</h3>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await submit(
              Object.fromEntries(new FormData(e.currentTarget)) as Record<
                string,
                string
              >,
            );
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="fields">{children}</div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <Button disabled={busy}>
          {busy
            ? "Saving…"
            : title === "Sign in"
              ? "Sign in"
              : title === "Create your workspace"
                ? "Create workspace"
                : "Save " + title.toLowerCase()}
        </Button>
      </form>
    </section>
  );
}
function App() {
  const [user, setUser] = useState<any>(null),
    [ready, setReady] = useState(false),
    [events, setEvents] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null),
    [view, setView] = useState("jobs"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [profile, setProfile] = useState<any>(null),
    [audit, setAudit] = useState<any[]>([]),
    [business, setBusiness] = useState<any>(null),
    [signup, setSignup] = useState(false),
    [link, setLink] = useState(""),
    [busy, setBusy] = useState(false);
  const token = location.pathname.startsWith("/confirm/")
    ? location.pathname.split("/")[2]
    : null;
  const refresh = async () => {
    const list = await api("/events");
    setEvents(list);
    if (user?.role === "business") {
      setProfile(await api("/profile"));
      setBusiness(await api("/business"));
    }
  };
  useEffect(() => {
    api("/auth/me")
      .then((x) => setUser(x.user))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (user) refresh().catch((e) => setError(e.message));
  }, [user]);
  const act = async (fn: () => Promise<any>, message = "Saved") => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await fn();
      setNotice(message);
      await refresh();
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const save = async (path: string, method: string, data?: unknown) => {
    const value = await api("/events/" + selected.id + path, method, data);
    setSelected(value);
    setLink("");
    await refresh();
    setNotice("Saved. Run the assessment again after changing evidence.");
    return value;
  };
  if (token) return <Confirmation token={token} />;
  if (!ready)
    return (
      <main className="login">
        <h1>AuditTrak</h1>
        <p>Opening your workspace…</p>
      </main>
    );
  if (!user)
    return (
      <PublicExperience
        signup={signup}
        setSignup={setSignup}
        submit={async (f) => {
          if (signup && f.password !== f.confirmPassword) {
            throw new Error("The passwords do not match.");
          }
          const credentials = { ...f };
          delete credentials.confirmPassword;
          const r = await api(
            signup ? "/auth/signup" : "/auth/login",
            "POST",
            credentials,
          );
          setUser(r.user);
        }}
      />
    );
  return (
    <div className="shell">
      <aside>
        <div className="brand">◈ AUDITTRAK</div>
        <p className="muted">The story behind the money</p>
        <nav>
          {(user.role === "business"
            ? ["jobs", "profile", "business", "audit"]
            : ["jobs"]
          ).map((x) => (
            <Button
              key={x}
              className={view === x ? "active" : "quiet"}
              onClick={async () => {
                setSelected(null);
                setView(x);
                if (x === "audit") setAudit(await api("/audit"));
              }}
            >
              {x === "jobs"
                ? user.role === "reviewer"
                  ? "Review queue"
                  : "My jobs"
                : x[0].toUpperCase() + x.slice(1)}
            </Button>
          ))}
        </nav>
        <div className="aside-bottom">
          <p>
            {user.name}
            <br />
            <small>
              {user.role === "reviewer"
                ? "Institutional reviewer"
                : business?.name}
            </small>
          </p>
          <Button
            className="quiet"
            onClick={async () => {
              await api("/auth/logout", "POST");
              setUser(null);
              setSelected(null);
              setEvents([]);
              setView("jobs");
              setProfile(null);
              setAudit([]);
              setBusiness(null);
            }}
          >
            Sign out
          </Button>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <small>COMMERCIAL EVIDENCE WORKSPACE</small>
            <h1>
              {selected
                ? selected.title
                : view === "jobs"
                  ? user.role === "reviewer"
                    ? "Shared jobs for review"
                    : "Your work. One clear record."
                  : view === "profile"
                    ? "Commercial activity profile"
                    : view === "business"
                      ? "Your business"
                      : "Activity history"}
            </h1>
          </div>
          <Badge good={user.role === "business"}>
            {user.role === "reviewer"
              ? "Reviewer workspace"
              : "Business workspace"}
          </Badge>
        </header>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {selected ? (
          <>
            <Button
              className="quiet"
              onClick={() => {
                setSelected(null);
                setLink("");
              }}
            >
              ← Back to jobs
            </Button>
            <div className="job-meta">
              <span>{selected.counterparty}</span>
              <span>
                {selected.channel === "marketplace"
                  ? "Marketplace job"
                  : "Direct client"}
              </span>
              <span>Revision {selected.revision}</span>
              <Badge good={!!selected.submitted}>
                {selected.submitted ? "Shared for review" : "Private draft"}
              </Badge>
            </div>
            <div className="flow">
              {[
                ["Agreement", !!selected.agreement],
                ["Invoice", !!selected.invoice],
                ["Payment", selected.transactions.length > 0],
                [
                  "Delivery",
                  selected.fulfillment?.status === "completed" &&
                    selected.evidence.some(
                      (x: any) => x.kind === "fulfillment",
                    ),
                ],
                [
                  "Confirmation",
                  selected.attestations.some(
                    (x: any) =>
                      x.revision === selected.revision &&
                      x.status === "confirmed",
                  ),
                ],
              ].map(([name, done], i) => (
                <div className={done ? "done" : ""} key={String(name)}>
                  <b>{done ? "✓" : i + 1}</b>
                  <span>{name}</span>
                </div>
              ))}
            </div>
            <p className="muted">
              Each step is linked to this job. A filled step shows a record
              exists; it does not prove authenticity.
            </p>
            {selected.assessment && (
              <section className="card assessment">
                <div className="section-heading">
                  <h2>
                    {selected.assessment.stale
                      ? "Evidence changed — reassess"
                      : selected.assessment.label}
                  </h2>
                  <Badge
                    good={
                      !selected.assessment.stale &&
                      selected.assessment.status === "consistent"
                    }
                  >
                    {selected.assessment.coverage.present}/5 stages
                  </Badge>
                </div>
                <p>{selected.assessment.summary}</p>
                <p className="muted">
                  {selected.assessment.confidenceExplanation}
                </p>
                <div className="signals">
                  {selected.assessment.reasons.map((x: any, i: number) => (
                    <div className={"signal " + x.status} key={i}>
                      <b>
                        {x.status === "match"
                          ? "✓"
                          : x.status === "mismatch"
                            ? "!"
                            : "○"}{" "}
                        {x.status}
                      </b>
                      <span>{x.message}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {user.role === "business" && (
              <div className="actions">
                <Button
                  disabled={busy}
                  onClick={() =>
                    act(() => save("/assessment", "POST"), "Assessment updated")
                  }
                >
                  Check this job
                </Button>
                <Button
                  className="secondary"
                  disabled={
                    busy || !selected.assessment || selected.assessment.stale
                  }
                  onClick={() =>
                    act(
                      () =>
                        save(
                          selected.submitted ? "/unshare" : "/submit",
                          "POST",
                        ),
                      selected.submitted
                        ? "Sharing revoked"
                        : "Shared with the reviewer workspace",
                    )
                  }
                >
                  {selected.submitted ? "Revoke sharing" : "Share for review"}
                </Button>
              </div>
            )}
            <div className="columns">
              <div>
                {user.role === "business" ? (
                  <>
                    <EvidenceEntry
                      key={selected.id + "agreement-entry"}
                      title="Agreement"
                      kind="agreement"
                      event={selected}
                      onUpload={async (data) => save("/evidence", "POST", data)}
                    >
                      <Form
                        key={selected.id + "agreement"}
                        title="Agreement"
                        submit={(f) =>
                          save("/agreement", "PUT", {
                            id: selected.agreement?.id ?? uid(),
                            kind: "agreement",
                            source: "user",
                            counterparty: f.counterparty,
                            service: f.service,
                            amount: {
                              amountMinor: Math.round(Number(f.amount) * 100),
                              currency: selected.currency,
                            },
                            effectiveDate: f.date,
                            reference: f.reference,
                          })
                        }
                      >
                        <Field
                          label="Client named in agreement"
                          name="counterparty"
                          defaultValue={
                            selected.agreement?.counterparty ??
                            selected.counterparty
                          }
                          required
                        />
                        <Field
                          label="Work agreed"
                          name="service"
                          defaultValue={
                            selected.agreement?.service ?? selected.service
                          }
                          required
                        />
                        <Field
                          label={"Agreed amount (" + selected.currency + ")"}
                          name="amount"
                          type="number"
                          min="0"
                          step="0.01"
                          defaultValue={
                            selected.agreement
                              ? selected.agreement.amount.amountMinor / 100
                              : ""
                          }
                          required
                        />
                        <Field
                          label="Agreement date"
                          name="date"
                          type="date"
                          defaultValue={
                            selected.agreement?.effectiveDate ?? date()
                          }
                          required
                        />
                        <Field
                          label="Reference (optional)"
                          name="reference"
                          defaultValue={selected.agreement?.reference}
                        />
                      </Form>
                    </EvidenceEntry>

                    <EvidenceEntry
                      key={selected.id + "invoice-entry"}
                      title="Invoice"
                      kind="invoice"
                      event={selected}
                      onUpload={async (data) => save("/evidence", "POST", data)}
                    >
                      <Form
                        key={selected.id + "invoice"}
                        title="Invoice"
                        submit={(f) =>
                          save("/invoice", "PUT", {
                            id: selected.invoice?.id ?? uid(),
                            kind: "invoice",
                            source: "user",
                            invoiceNumber: f.number,
                            counterparty: f.counterparty,
                            service: selected.service,
                            amount: {
                              amountMinor: Math.round(Number(f.amount) * 100),
                              currency: selected.currency,
                            },
                            issuedDate: f.date,
                          })
                        }
                      >
                        <Field
                          label="Invoice number"
                          name="number"
                          defaultValue={selected.invoice?.invoiceNumber}
                          required
                        />
                        <Field
                          label="Client billed"
                          name="counterparty"
                          defaultValue={
                            selected.invoice?.counterparty ??
                            selected.counterparty
                          }
                          required
                        />
                        <Field
                          label={"Billed amount (" + selected.currency + ")"}
                          name="amount"
                          type="number"
                          min="0"
                          step="0.01"
                          defaultValue={
                            selected.invoice
                              ? selected.invoice.amount.amountMinor / 100
                              : ""
                          }
                          required
                        />
                        <Field
                          label="Invoice date"
                          name="date"
                          type="date"
                          defaultValue={selected.invoice?.issuedDate ?? date()}
                          required
                        />
                      </Form>
                    </EvidenceEntry>

                    <EvidenceEntry
                      key={selected.id + "payment-entry"}
                      title="Payment"
                      kind="payment"
                      event={selected}
                      onUpload={async (data) => save("/evidence", "POST", data)}
                      records={
                        selected.transactions.length > 0 && (
                          <div className="saved-payments">
                            <h4>Saved payment details</h4>
                            {selected.transactions.map((x: any) => (
                              <article className="record" key={x.id}>
                                <b>
                                  {x.direction === "debit" ? "−" : "+"}
                                  {money(
                                    x.amount.amountMinor,
                                    x.amount.currency,
                                  )}
                                </b>
                                <p>
                                  {x.counterparty} · {x.transactionDate}
                                </p>
                                <small>
                                  {x.transactionId} ·{" "}
                                  {x.reference || "No reference"} · Source:{" "}
                                  {x.source}
                                </small>
                                {user.role === "business" && (
                                  <Button
                                    className="quiet"
                                    onClick={() =>
                                      act(
                                        () =>
                                          save(
                                            "/transactions/" +
                                              encodeURIComponent(
                                                x.transactionId,
                                              ),
                                            "DELETE",
                                          ),
                                        "Payment unlinked",
                                      )
                                    }
                                  >
                                    Unlink
                                  </Button>
                                )}
                              </article>
                            ))}
                          </div>
                        )
                      }
                    >
                      <Form
                        title="Payment record"
                        submit={(f) =>
                          save("/transactions", "POST", {
                            id: uid(),
                            kind: "payment",
                            source: "user",
                            transactionId: f.transactionId,
                            direction: f.direction,
                            counterparty: f.payer,
                            amount: {
                              amountMinor: Math.round(Number(f.amount) * 100),
                              currency: selected.currency,
                            },
                            transactionDate: f.date,
                            reference: f.reference,
                          })
                        }
                      >
                        <Field
                          label="Transaction ID (unique)"
                          name="transactionId"
                          required
                        />
                        <Field
                          label="Payer / other party"
                          name="payer"
                          defaultValue={selected.counterparty}
                          required
                        />
                        <Field
                          label={"Amount (" + selected.currency + ")"}
                          name="amount"
                          type="number"
                          min="0"
                          step="0.01"
                          required
                        />
                        <Field
                          label="Payment date"
                          name="date"
                          type="date"
                          defaultValue={date()}
                          required
                        />
                        <label>
                          Direction
                          <select name="direction">
                            <option value="credit">Money received</option>
                            <option value="debit">
                              Money returned / debited
                            </option>
                          </select>
                        </label>
                        <Field
                          label="Invoice or payment reference"
                          name="reference"
                        />
                      </Form>
                    </EvidenceEntry>

                    <EvidenceEntry
                      key={selected.id + "fulfillment-entry"}
                      title="Delivery"
                      kind="fulfillment"
                      event={selected}
                      onUpload={async (data) => save("/evidence", "POST", data)}
                    >
                      <Form
                        key={selected.id + "delivery"}
                        title="Delivery"
                        submit={(f) =>
                          save("/fulfillment", "PUT", {
                            status: f.status,
                            description: f.description,
                            ...(f.status === "completed"
                              ? { completedDate: f.date }
                              : {}),
                          })
                        }
                      >
                        <label>
                          Work status
                          <select
                            name="status"
                            defaultValue={
                              selected.fulfillment?.status ?? "in_progress"
                            }
                          >
                            <option value="in_progress">In progress</option>
                            <option value="completed">Completed</option>
                          </select>
                        </label>
                        <Field
                          label="What was delivered?"
                          name="description"
                          defaultValue={selected.fulfillment?.description}
                          required
                        />
                        <Field
                          label="Completion date"
                          name="date"
                          type="date"
                          defaultValue={
                            selected.fulfillment?.completedDate ?? date()
                          }
                        />
                      </Form>
                    </EvidenceEntry>
                  </>
                ) : (
                  <section className="card">
                    <h2>Source records</h2>
                    {[
                      ["Agreement", selected.agreement],
                      ["Invoice", selected.invoice],
                      ["Delivery", selected.fulfillment],
                    ].map(([name, value]) => (
                      <div key={String(name)}>
                        <h3>{String(name)}</h3>
                        {value ? (
                          <pre>{JSON.stringify(value, null, 2)}</pre>
                        ) : (
                          <p>Not provided</p>
                        )}
                      </div>
                    ))}
                  </section>
                )}
              </div>
              <div>
                {user.role === "reviewer" && (
                  <section className="card">
                    <h3>Supporting documents</h3>
                    <EvidenceLinks event={selected} />
                    <div className="saved-payments">
                      <h4>Saved payment details</h4>
                      {selected.transactions.map((x: any) => (
                        <article className="record" key={x.id}>
                          <b>
                            {x.direction === "debit" ? "−" : "+"}
                            {money(x.amount.amountMinor, x.amount.currency)}
                          </b>
                          <p>
                            {x.counterparty} · {x.transactionDate}
                          </p>
                          <small>
                            {x.transactionId} · {x.reference || "No reference"}{" "}
                            · Source: {x.source}
                          </small>
                          {user.role === "business" && (
                            <Button
                              className="quiet"
                              onClick={() =>
                                act(
                                  () =>
                                    save(
                                      "/transactions/" +
                                        encodeURIComponent(x.transactionId),
                                      "DELETE",
                                    ),
                                  "Payment unlinked",
                                )
                              }
                            >
                              Unlink
                            </Button>
                          )}
                        </article>
                      ))}
                    </div>
                  </section>
                )}
                <section className="card">
                  <h3>Client confirmation</h3>
                  <p>
                    Share a link with your client. They can review the job
                    summary, confirm or dispute it, and leave a comment.
                  </p>
                  {selected.attestations.map((x: any) => (
                    <p key={x.id}>
                      <Badge
                        good={
                          x.status === "confirmed" &&
                          x.revision === selected.revision
                        }
                      >
                        {x.status}
                      </Badge>{" "}
                      {x.name ?? "Awaiting response"} · revision {x.revision}
                      {x.comment && (
                        <small className="block">{x.comment}</small>
                      )}
                    </p>
                  ))}
                  {user.role === "business" && (
                    <>
                      <p>
                        Finish editing evidence first. Changes make old
                        confirmation links invalid.
                      </p>
                      <Button
                        className="secondary"
                        onClick={() =>
                          act(async () => {
                            const r = await api(
                              "/events/" + selected.id + "/attestations",
                              "POST",
                            );
                            setLink(location.origin + r.path);
                            setSelected(await api("/events/" + selected.id));
                            return r;
                          }, "Link created. Share it with the intended client yourself.")
                        }
                      >
                        Create confirmation link
                      </Button>
                      {link && (
                        <p>
                          <a href={link} target="_blank" rel="noreferrer">
                            Open client confirmation ↗
                          </a>
                          <input
                            aria-label="Confirmation link"
                            readOnly
                            value={link}
                            onFocus={(e) => e.target.select()}
                          />
                        </p>
                      )}
                    </>
                  )}
                  <p className="muted">
                    Anyone holding this link can respond. It is not independent
                    identity verification. No message is sent automatically.
                  </p>
                </section>
                <section className="card">
                  <h3>Evidence timeline</h3>
                  {[
                    { label: "Job created", at: selected.created_at },
                    ...selected.evidence.map((x: any) => ({
                      label: x.kind + " file added: " + x.name,
                      at: x.created_at,
                    })),
                    ...selected.attestations
                      .filter((x: any) => x.responded_at)
                      .map((x: any) => ({
                        label: "Client response: " + x.status,
                        at: x.responded_at,
                      })),
                    ...selected.reviews.map((x: any) => ({
                      label: "Reviewer note added",
                      at: x.created_at,
                    })),
                  ]
                    .sort((a, b) => a.at.localeCompare(b.at))
                    .map((x, i) => (
                      <p className="timeline" key={i}>
                        <b>{x.label}</b>
                        <small>{new Date(x.at).toLocaleString()}</small>
                      </p>
                    ))}
                </section>
                <section className="card">
                  <h3>Reviewer notes</h3>
                  {selected.reviews.map((x: any) => (
                    <article key={x.id}>
                      <p>{x.note}</p>
                      <small>
                        {x.reviewer_name} · revision {x.revision}
                      </small>
                    </article>
                  ))}
                  {!selected.reviews.length && <p>No reviewer notes yet.</p>}
                </section>
                {user.role === "reviewer" && (
                  <Form
                    title="Review note"
                    submit={(f) => save("/reviews", "POST", { note: f.note })}
                  >
                    <label>
                      Your observations
                      <textarea name="note" required minLength={3} />
                    </label>
                  </Form>
                )}
                {user.role === "business" && (
                  <details className="card">
                    <summary>Edit or remove this job</summary>
                    <EventForm
                      event={selected}
                      submit={(f) => save("", "PATCH", f)}
                    />
                    <Button
                      className="danger"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Delete this job and its evidence? This cannot be undone.",
                          )
                        )
                          act(async () => {
                            await api("/events/" + selected.id, "DELETE");
                            setSelected(null);
                          }, "Job deleted");
                      }}
                    >
                      Delete job
                    </Button>
                  </details>
                )}
              </div>
            </div>
          </>
        ) : view === "jobs" ? (
          <>
            <section className="hero">
              <div>
                <h2>
                  {user.role === "reviewer"
                    ? "Read the evidence. Record your observations."
                    : "Start with one job."}
                </h2>
                <p>
                  {user.role === "reviewer"
                    ? "Only jobs explicitly shared by their owners appear here. Evidence assessments support review; they do not decide credit."
                    : "What was agreed? What was billed? What arrived? Add delivery proof and ask your client to confirm."}
                </p>
              </div>
            </section>
            <div className="stats">
              <div>
                <b>{events.length}</b>
                <span>
                  {user.role === "reviewer" ? "Shared jobs" : "Saved jobs"}
                </span>
              </div>
              <div>
                <b>
                  {
                    events.filter((x) => x.assessment && !x.assessment.stale)
                      .length
                  }
                </b>
                <span>Current assessments</span>
              </div>
              <div>
                <b>
                  {
                    events.filter((x) => x.assessment?.status === "conflict")
                      .length
                  }
                </b>
                <span>Recorded differences</span>
              </div>
            </div>
            <section className="card">
              <h2>{user.role === "reviewer" ? "Review queue" : "Your jobs"}</h2>
              {!events.length && (
                <p className="muted">
                  No jobs yet.{" "}
                  {user.role === "business"
                    ? "Create a job to organize its agreement, invoice, payment, and delivery records."
                    : "Ask the business owner to share an assessed job."}
                </p>
              )}
              <div className="job-list">
                {events.map((x) => (
                  <button
                    className="job"
                    key={x.id}
                    onClick={() => {
                      setSelected(x);
                      setError("");
                      setNotice("");
                    }}
                  >
                    <div>
                      <b>{x.title}</b>
                      <small>
                        {x.counterparty} · {x.channel} · {x.currency}
                      </small>
                    </div>
                    <Badge
                      good={
                        x.assessment?.status === "consistent" &&
                        !x.assessment?.stale
                      }
                    >
                      {x.assessment?.stale
                        ? "Reassess"
                        : (x.assessment?.label ?? "Not checked")}
                    </Badge>
                    <span>Open →</span>
                  </button>
                ))}
              </div>
            </section>
            {user.role === "business" && (
              <EventForm
                submit={async (f) => {
                  const x = await api("/events", "POST", f);
                  setSelected(x);
                  await refresh();
                }}
              />
            )}
          </>
        ) : view === "profile" ? (
          <section className="card">
            <h2>{business?.name}</h2>
            <p>{profile?.explanation}</p>
            <div className="stats">
              <div>
                <b>{profile?.events}</b>
                <span>Jobs</span>
              </div>
              <div>
                <b>{profile?.consistent}</b>
                <span>Consistent records</span>
              </div>
              <div>
                <b>{profile?.requiresReview}</b>
                <span>Require review</span>
              </div>
            </div>
            <h3>Net linked payments by currency</h3>
            {Object.entries(profile?.netLinkedPaymentsByCurrency ?? {}).map(
              ([c, v]) => (
                <p key={c}>{money(Number(v), c)}</p>
              ),
            )}
            <p className="muted">
              These are linked record totals, not verified revenue.
              Mixed-currency jobs are excluded from totals.
            </p>
          </section>
        ) : view === "business" ? (
          <Form
            key={business?.id}
            title="Business profile"
            submit={async (f) => {
              await api("/business", "PUT", f);
              await refresh();
              setNotice("Business updated");
            }}
          >
            <Field
              label="Business name"
              name="name"
              defaultValue={business?.name}
              required
            />
            <Field
              label="Sector"
              name="sector"
              defaultValue={business?.sector}
            />
            <label>
              About your business
              <textarea
                name="description"
                defaultValue={business?.description}
              />
            </label>
          </Form>
        ) : (
          <section className="card">
            <h2>Recent actions</h2>
            {audit.map((x, i) => (
              <p className="timeline" key={i}>
                <b>{x.action.replaceAll(".", " ")}</b>
                <small>{new Date(x.created_at).toLocaleString()}</small>
              </p>
            ))}
          </section>
        )}
        <footer>
          AuditTrak · Evidence for human review · No credit decisions or fraud
          labels
        </footer>
      </main>
    </div>
  );
}
function EventForm({
  event,
  submit,
}: {
  event?: any;
  submit: (f: any) => Promise<any>;
}) {
  return (
    <Form title={event ? "Job details" : "New job"} submit={submit}>
      <Field
        label="Job title"
        name="title"
        defaultValue={event?.title}
        required
      />
      <Field
        label="Service / work"
        name="service"
        defaultValue={event?.service}
        required
      />
      <Field
        label="Client / counterparty"
        name="counterparty"
        defaultValue={event?.counterparty}
        required
      />
      <Field
        label="Client email (optional)"
        name="counterpartyEmail"
        type="email"
        defaultValue={event?.counterparty_email}
      />
      <Field
        label="Currency (3 letters)"
        name="currency"
        defaultValue={event?.currency ?? "NGN"}
        pattern="[A-Z]{3}"
        required
      />
      <label>
        Job source
        <select name="channel" defaultValue={event?.channel ?? "direct"}>
          <option value="direct">Direct client</option>
          <option value="marketplace">Marketplace</option>
        </select>
      </label>
    </Form>
  );
}
function EvidenceLinks({ event, kind }: { event: any; kind?: string }) {
  const files = event.evidence.filter(
    (item: any) => !kind || item.kind === kind,
  );
  return (
    <div className="evidence-links">
      {files.map((item: any) => (
        <p key={item.id}>
          <a href={"/api/v1/events/" + event.id + "/evidence/" + item.id}>
            {item.name}
          </a>
          {!kind && <Badge>{item.kind}</Badge>}
        </p>
      ))}
    </div>
  );
}
function EvidenceEntry({
  title,
  kind,
  event,
  onUpload,
  children,
  records,
}: {
  title: string;
  kind: string;
  event: any;
  onUpload: (data: any) => Promise<any>;
  children: React.ReactNode;
  records?: React.ReactNode;
}) {
  const [mode, setMode] = useState(
    kind === "fulfillment" ? "manual" : "upload",
  );
  return (
    <section className="card evidence-entry">
      <h3>{title}</h3>
      {kind === "invoice" && (
        <p className="muted">
          Have an invoice? Add it here. If you don't issue invoices, skip this
          and upload your receipt under Payment.
        </p>
      )}
      {kind === "payment" && (
        <p className="muted">
          Upload a payment receipt, with or without an invoice, or enter the
          payment details.
        </p>
      )}
      <div
        className="entry-options"
        role="group"
        aria-label={title + " entry method"}
      >
        <Button
          type="button"
          className={mode === "upload" ? "" : "secondary"}
          aria-pressed={mode === "upload"}
          onClick={() => setMode("upload")}
        >
          Upload {kind === "payment" ? "receipt" : "document"}
        </Button>
        <Button
          type="button"
          className={mode === "manual" ? "" : "secondary"}
          aria-pressed={mode === "manual"}
          onClick={() => setMode("manual")}
        >
          Fill in details
        </Button>
      </div>
      <div hidden={mode !== "upload"}>
        <Upload kind={kind} onUpload={onUpload} />
        <p className="muted">
          Your original file is saved with this job. Document contents are not
          read automatically yet; comparisons use any details entered in the
          form.
        </p>
      </div>
      <div hidden={mode !== "manual"}>{children}</div>
      <EvidenceLinks event={event} kind={kind} />
      {records}
    </section>
  );
}

function Upload({
  onUpload,
  kind,
}: {
  onUpload: (x: any) => Promise<any>;
  kind: string;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <label>
        {busy
          ? "Uploading…"
          : "Attach a file (PDF, Word, PNG, JPEG, text; max 3 MB)"}
        <input
          type="file"
          accept=".pdf,.docx,.png,.jpg,.jpeg,.txt"
          disabled={busy}
          onChange={async (e) => {
            const input = e.currentTarget;
            const file = input.files?.[0];
            if (!file) return;
            setError("");
            if (file.size > 3 * 1024 * 1024) {
              setError("Please choose a file under 3 MB.");
              return;
            }
            setBusy(true);
            try {
              const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () =>
                  resolve(String(reader.result).split(",")[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
              });
              await onUpload({
                kind,
                name: file.name,
                mime: file.type || "text/plain",
                base64: data,
              });
              input.value = "";
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </>
  );
}
function PublicExperience({
  signup,
  setSignup,
  submit,
}: {
  signup: boolean;
  setSignup: (value: boolean) => void;
  submit: (f: Record<string, string>) => Promise<any>;
}) {
  const [screen, setScreen] = useState<"home" | "auth">("home");
  const begin = (createAccount = false) => {
    setSignup(createAccount);
    setScreen("auth");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  if (screen === "auth")
    return (
      <main className="auth-page">
        <a
          className="auth-back"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setScreen("home");
          }}
        >
          ← Back to AuditTrak
        </a>
        <div className="auth-grid">
          <section className="auth-story">
            <div className="brand">
              <span className="brand-mark">◈</span> AUDITTRAK
            </div>
            <div className="auth-story-copy">
              <span className="eyebrow light">THE STORY BEHIND THE MONEY</span>
              <h1>Good work deserves a clear record.</h1>
              <p>
                Keep the agreement, invoice, payment, and delivery details for
                each job together.
              </p>
              <div className="story-note">
                <span>AGREEMENT</span>
                <b>What we decided</b>
                <i>→</i>
                <span>PAYMENT</span>
              </div>
            </div>
            <small className="photo-credit">
              A calmer way to keep business evidence in view.
            </small>
          </section>
          <section className="auth-form-wrap">
            <div className="mobile-brand brand">
              <span className="brand-mark">◈</span> AUDITTRAK
            </div>
            <div className="auth-form-head">
              <span className="eyebrow">YOUR WORKSPACE</span>
              <h2>{signup ? "Create your account" : "Welcome back"}</h2>
              <p>
                {signup
                  ? "Set up a place to keep each job’s records together."
                  : "Sign in to continue to your workspace."}
              </p>
            </div>
            <Form
              title={signup ? "Create your workspace" : "Sign in"}
              submit={submit}
            >
              {signup && (
                <Field
                  label="Your name"
                  name="name"
                  placeholder="e.g. Amina Bello"
                  required
                />
              )}
              {signup && (
                <Field
                  label="Business name"
                  name="businessName"
                  placeholder="e.g. Amina Creative Studio"
                  required
                />
              )}
              <Field
                label="Email address"
                name="email"
                type="email"
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
              <Field
                label="Password"
                name="password"
                type="password"
                placeholder={
                  signup ? "At least 12 characters" : "Enter your password"
                }
                minLength={signup ? 12 : 1}
                required
                autoComplete={signup ? "new-password" : "current-password"}
              />
              {signup && (
                <Field
                  label="Confirm password"
                  name="confirmPassword"
                  type="password"
                  placeholder="Enter your password again"
                  minLength={12}
                  required
                  autoComplete="new-password"
                />
              )}
              {signup && (
                <p className="field-hint">
                  Use at least 12 characters. You can show or hide either
                  password while typing.
                </p>
              )}
            </Form>
            <p className="auth-switch">
              {signup ? "Already have an account?" : "New to AuditTrak?"}{" "}
              <button type="button" onClick={() => setSignup(!signup)}>
                {signup ? "Sign in" : "Create an account"}
              </button>
            </p>
            <p className="auth-privacy">
              Your records stay in your workspace. Sharing with a reviewer
              requires your action.
            </p>
          </section>
        </div>
      </main>
    );

  return (
    <div className="public-site">
      <header className="public-nav">
        <a className="brand" href="#top">
          <span className="brand-mark">◈</span> AUDITTRAK
        </a>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#privacy">Privacy</a>
        </nav>
        <div className="nav-actions">
          <button className="nav-login" onClick={() => begin(false)}>
            Log in
          </button>
          <button className="nav-cta" onClick={() => begin(true)}>
            Get started <span>↗</span>
          </button>
        </div>
      </header>
      <main id="top" className="public-main">
        <section className="public-hero">
          <div className="hero-copy">
            <span className="eyebrow">A CLEARER VIEW OF EVERY JOB</span>
            <h1>Make business activity easier to understand.</h1>
            <p>
              Agreements live in chats. Invoices live somewhere else. Payments
              land in your bank. AuditTrak brings the records together so you
              can see what lines up and what needs a closer look.
            </p>
            <div className="hero-actions">
              <button className="nav-cta" onClick={() => begin(true)}>
                Create your account <span>↗</span>
              </button>
              <a href="#how-it-works">
                See how it works <span>↓</span>
              </a>
            </div>
            <div className="hero-caption">
              <span className="caption-dot" /> Built for real work, with a
              person always in control.
            </div>
          </div>
          <div
            className="hero-visual"
            role="img"
            aria-label="Illustrative workspace with a sample job record"
          >
            <div className="visual-tag">ONE JOB, ONE CLEAR VIEW</div>
            <div className="visual-paper">
              <div className="paper-top">
                <span>JOB RECORD</span>
                <span className="paper-status">IN REVIEW</span>
              </div>
              <strong>
                Brand identity
                <br />
                for Aster House
              </strong>
              <div className="paper-rule" />
              <div className="paper-row">
                <span>Agreement</span>
                <b>Found</b>
              </div>
              <div className="paper-row">
                <span>Invoice</span>
                <b>₦180,000</b>
              </div>
              <div className="paper-row">
                <span>Payment</span>
                <b>₦180,000</b>
              </div>
              <div className="paper-bottom">3 records · 1 job</div>
            </div>
            <div className="visual-caption">
              A simple view of the records behind the work.
            </div>
          </div>
        </section>
        <section className="proof-strip" aria-label="Evidence types">
          <span>AGREEMENT</span>
          <i>+</i>
          <span>INVOICE</span>
          <i>+</i>
          <span>PAYMENT</span>
          <i>+</i>
          <span>DELIVERY</span>
          <b>→</b>
          <strong>ONE CLEAR RECORD</strong>
        </section>
        <section id="how-it-works" className="how-section">
          <div className="section-intro">
            <span className="eyebrow">FROM TRANSACTION TO CONTEXT</span>
            <h2>Make the pieces easier to follow.</h2>
            <p>
              AuditTrak helps freelancers and small businesses organize job
              evidence and review it in one place.
            </p>
          </div>
          <div className="how-grid">
            <article>
              <span className="step-no">01</span>
              <div className="step-icon">↗</div>
              <h3>Bring the records together</h3>
              <p>
                Add the agreement, invoice, payment, and delivery details for
                one piece of work.
              </p>
            </article>
            <article>
              <span className="step-no">02</span>
              <div className="step-icon">⌕</div>
              <h3>See what lines up</h3>
              <p>
                AuditTrak compares dates, amounts, names, and references using
                clear rules.
              </p>
            </article>
            <article>
              <span className="step-no">03</span>
              <div className="step-icon">✓</div>
              <h3>Review the open questions</h3>
              <p>
                Differences and missing details are shown for a person to check
                and resolve.
              </p>
            </article>
          </div>
        </section>
        <section className="context-section">
          <div>
            <span className="eyebrow light">LESS GUESSWORK</span>
            <h2>Know what the records say—and what they don’t.</h2>
            <p>
              A matching amount is a useful signal. It is not proof that every
              part of a job is complete. AuditTrak keeps evidence and questions
              visible so people can make informed reviews.
            </p>
            <button className="light-cta" onClick={() => begin(true)}>
              Start with a job <span>↗</span>
            </button>
          </div>
          <div className="context-card">
            <span className="context-card-kicker">ASSESSMENT SUMMARY</span>
            <strong>Payment amount matches invoice</strong>
            <p>Both records show ₦180,000 NGN.</p>
            <div className="context-divider" />
            <span className="review-pill">CHECK DELIVERY DETAILS</span>
            <small>
              Payment evidence does not confirm that the agreed work was
              delivered.
            </small>
          </div>
        </section>
        <section id="privacy" className="privacy-section">
          <span className="privacy-symbol">◈</span>
          <div>
            <span className="eyebrow">YOUR EVIDENCE, YOUR CHOICE</span>
            <h2>Sharing stays in your hands.</h2>
            <p>
              Keep job records in your workspace. When you choose to share a job
              with a reviewer, the shared record gives them more context to
              understand the activity.
            </p>
          </div>
          <button className="privacy-link" onClick={() => begin(true)}>
            Create your workspace ↗
          </button>
        </section>
        <footer className="public-footer">
          <a className="brand" href="#top">
            <span className="brand-mark">◈</span> AUDITTRAK
          </a>
          <span>The story behind the money.</span>
          <span>People review. AuditTrak organizes the evidence.</span>
        </footer>
      </main>
    </div>
  );
}

function Confirmation({ token }: { token: string }) {
  const [value, setValue] = useState<any>(null),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  useEffect(() => {
    api("/attest/" + token)
      .then(setValue)
      .catch((e) => setError(e.message));
  }, [token]);
  return (
    <main className="login">
      <div className="brand">◈ AUDITTRAK</div>
      <h1>Confirm this job</h1>
      {error && <p className="error">{error}</p>}
      {value && (
        <>
          <section className="card">
            <h2>{value.title}</h2>
            <p>
              {value.business} · Client: {value.counterparty}
            </p>
            <p>{value.service}</p>
            {value.invoice && (
              <p>
                Invoice {value.invoice.invoiceNumber}:{" "}
                {money(
                  value.invoice.amount.amountMinor,
                  value.invoice.amount.currency,
                )}
              </p>
            )}
            {value.agreement && (
              <p>
                Agreed:{" "}
                {money(
                  value.agreement.amount.amountMinor,
                  value.agreement.amount.currency,
                )}{" "}
                · {value.agreement.service}
              </p>
            )}
            {value.payments?.map((x: any, i: number) => (
              <p key={i}>
                {x.direction === "credit" ? "Received" : "Debited"}:{" "}
                {money(x.amount.amountMinor, x.amount.currency)} ·{" "}
                {x.counterparty} · {x.date}
              </p>
            ))}
            <p>
              Delivery: {value.fulfillment?.description ?? "Not recorded"} (
              {value.fulfillment?.status ?? "missing"})
            </p>
            <p>
              Revision {value.revision}. Confirm that this accurately describes
              the work and records you know, or dispute it below.
            </p>
          </section>
          {done || value.status !== "pending" ? (
            <p className="notice">Response recorded. Thank you.</p>
          ) : (
            <Form
              title="Your response"
              submit={async (f) => {
                await api("/attest/" + token, "POST", f);
                setDone(true);
              }}
            >
              <Field label="Your name" name="name" required />
              <label>
                Response
                <select name="status">
                  <option value="confirmed">I confirm this job</option>
                  <option value="disputed">I dispute this record</option>
                </select>
              </label>
              <label>
                Comment (optional)
                <textarea name="comment" />
              </label>
            </Form>
          )}
          <p className="muted">
            Only respond if this link was intended for you. Link possession is
            not independent identity verification.
          </p>
        </>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
