import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { copy } from "../copy";
import { joinLink, safeNext } from "../link";
import type { Board, Me } from "../types";
import { api } from "./api";
import { ping, primePing } from "./ping";

type MeState = { status: "loading" | "error" } | ({ status: "ready" } & Me);

function useMe(): MeState {
  const [state, setState] = useState<MeState>({ status: "loading" });
  useEffect(() => {
    let cancel = false;
    api
      .me()
      .then((me) => {
        if (!cancel) setState({ status: "ready", ...me });
      })
      .catch(() => {
        if (!cancel) setState({ status: "error" });
      });
    return () => {
      cancel = true;
    };
  }, []);
  return state;
}

function Shell({ children }: { children?: ReactNode }) {
  useEffect(() => {
    document.title = "Acta";
  }, []);
  return (
    <main className="sheet surface rounded-sm">
      <h1>
        <Link to="/" className="rounded-sm">
          {copy.product}
        </Link>
      </h1>
      <p>{copy.firstLook}</p>
      {children}
    </main>
  );
}

function Home() {
  const me = useMe();
  const navigate = useNavigate();
  const groupId = me.status === "ready" && me.user ? me.groups[0]?.id ?? "" : "";

  useEffect(() => {
    if (groupId) navigate(`/groups/${groupId}`, { replace: true });
  }, [groupId, navigate]);

  if (me.status === "loading" || groupId) return <Shell />;
  if (me.status === "error") {
    return (
      <Shell>
        <p className="error">The board could not be reached.</p>
      </Shell>
    );
  }
  return <Start signedIn={me.status === "ready" && Boolean(me.user)} />;
}

function Start({ signedIn }: { signedIn: boolean }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [groupName, setGroupName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!signedIn && (!name.trim() || !email.trim() || password.length < 8)) {
      setError("Enter your name, email, and a password of at least 8 characters.");
      return;
    }
    if (!groupName.trim()) {
      setError("Name the group.");
      return;
    }
    setBusy(true);
    try {
      if (!signedIn) await api.signUp({ name: name.trim(), email: email.trim(), password });
      const created = await api.createGroup(groupName.trim());
      navigate(`/groups/${created.group.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The board could not be reached.");
      setBusy(false);
    }
  }

  return (
    <Shell>
      <form className="sheet" noValidate onSubmit={onSubmit}>
        {signedIn ? null : (
          <>
            <label>
              Your name
              <input className="rounded-sm" name="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              Email
              <input className="rounded-sm" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              Password
              <input className="rounded-sm" name="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
          </>
        )}
        <label>
          Group name
          <input className="rounded-sm" name="group" value={groupName} onChange={(event) => setGroupName(event.target.value)} />
        </label>
        <button className="rounded-sm" type="submit" disabled={busy}>
          {copy.createGroup}
        </button>
        {error ? <p className="error">{error}</p> : null}
      </form>
      {signedIn ? <SignOut /> : <Link className="rounded-sm" to="/sign-in">Sign in</Link>}
    </Shell>
  );
}

function SignIn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.signIn({ email: email.trim(), password });
      navigate(next || "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The board could not be reached.");
      setBusy(false);
    }
  }

  return (
    <Shell>
      <form className="sheet" noValidate onSubmit={onSubmit}>
        <label>
          Email
          <input className="rounded-sm" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          Password
          <input className="rounded-sm" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button className="rounded-sm" type="submit" disabled={busy}>
          Sign in
        </button>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </Shell>
  );
}

function SignOut() {
  const navigate = useNavigate();
  return (
    <button
      className="rounded-sm"
      type="button"
      onClick={() => {
        void api.signOut().then(() => navigate("/"));
      }}
    >
      Sign out
    </button>
  );
}

function BoardPage() {
  const { groupId = "" } = useParams();
  const navigate = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pings, setPings] = useState(0);
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancel = false;
    api
      .board(groupId)
      .then((next) => {
        if (!cancel) setBoard(next);
      })
      .catch((err: unknown) => {
        if (cancel) return;
        const message = err instanceof Error ? err.message : "";
        if (message === "Sign in first.") {
          navigate(`/sign-in?next=${encodeURIComponent(`/groups/${groupId}`)}`, { replace: true });
          return;
        }
        setError(message || "The board could not be reached.");
      });
    return () => {
      cancel = true;
    };
  }, [groupId, navigate]);

  useEffect(() => {
    if (board) document.title = `Acta — ${board.group.name}`;
  }, [board]);

  async function onCopy() {
    const link = linkRef.current?.value ?? "";
    linkRef.current?.focus();
    linkRef.current?.select();
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      document.execCommand("copy");
    }
  }

  async function onLog(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!text.trim()) {
      setText("");
      setError("");
      setStatus("");
      return;
    }
    primePing();
    setBusy(true);
    setError("");
    setStatus("Working out the score.");
    try {
      const result = await api.log(groupId, text);
      if (result.outcome === "changed") {
        setBoard(result.board);
        setPings((count) => count + 1);
        ping();
        setText("");
        setStatus("");
      } else if (result.outcome === "failed") {
        setStatus("");
        setError(copy.scoreFailed);
      } else {
        setText("");
        setStatus("");
        setError("");
      }
    } catch (err) {
      setStatus("");
      setError(err instanceof Error ? err.message : "The board could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  if (!board) {
    return (
      <Shell>
        {error ? <p className="error">{error}</p> : null}
      </Shell>
    );
  }

  const link = joinLink(window.location.origin, board.publicOrigin, board.group.joinToken);

  return (
    <Shell>
      <h2>{board.group.name}</h2>
      <div>
        <p>{copy.shareLink}</p>
        <div className="share">
          <input ref={linkRef} className="rounded-sm" readOnly value={link} aria-label={copy.shareLink} onFocus={(event) => event.currentTarget.select()} />
          <button className="rounded-sm" type="button" onClick={() => void onCopy()}>
            Copy
          </button>
        </div>
      </div>
      <div className="surface rounded-sm" data-pings={pings}>
        <div className="head">
          <span>Name</span>
          <span>Standing</span>
        </div>
        {board.members.map((member) => (
          <div className="member" key={member.userId} data-standing={member.standing ?? ""}>
            <span>
              {member.name}
              {member.userId === board.viewerId ? " (you)" : ""}
            </span>
            <span className="standing">{member.standing === null ? "—" : member.standing}</span>
          </div>
        ))}
      </div>
      <form noValidate onSubmit={(event) => void onLog(event)}>
        <label>
          {copy.whatDidYouDo}
          <textarea className="rounded-sm" name="deed" autoComplete="off" value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <button className="rounded-sm" type="submit" disabled={busy}>
          Log
        </button>
      </form>
      {status ? <p>{status}</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <SignOut />
    </Shell>
  );
}

function JoinPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<{ status: "loading" } | { status: "ready"; groupName: string } | { status: "missing" }>({
    status: "loading",
  });
  const [mode, setMode] = useState<"create" | "sign-in">("create");
  const [person, setPerson] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    api
      .previewJoin(token)
      .then((group) => {
        if (!cancel) {
          setName(group.name);
          setPreview({ status: "ready", groupName: group.name });
        }
      })
      .catch((err: unknown) => {
        if (cancel) return;
        const message = err instanceof Error ? err.message : "";
        if (message === "This join link does not match a group.") {
          setPreview({ status: "missing" });
          return;
        }
        setPreview({ status: "missing" });
        setError(message || "The board could not be reached.");
      });
    return () => {
      cancel = true;
    };
  }, [token]);

  useEffect(() => {
    if (me.status !== "ready" || !me.user || preview.status !== "ready") return;
    let cancel = false;
    api
      .join(token)
      .then((result) => {
        if (!cancel) navigate(`/groups/${result.groupId}`, { replace: true });
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "The board could not be reached.");
      });
    return () => {
      cancel = true;
    };
  }, [me, navigate, preview.status, token]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "create") {
        if (!person.trim() || !email.trim() || password.length < 8) {
          setError("Enter your name, email, and a password of at least 8 characters.");
          setBusy(false);
          return;
        }
        await api.signUp({ name: person.trim(), email: email.trim(), password });
      } else {
        await api.signIn({ email: email.trim(), password });
      }
      const joined = await api.join(token);
      navigate(`/groups/${joined.groupId}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The board could not be reached.");
      setBusy(false);
    }
  }

  return (
    <Shell>
      {preview.status === "missing" ? <p>This join link does not match a group.</p> : null}
      {preview.status === "ready" ? <p>This link joins {name}.</p> : null}
      {me.status === "ready" && me.user && preview.status === "ready" ? <p>Opening the board.</p> : null}
      {preview.status === "ready" && me.status === "ready" && !me.user ? (
        <form className="sheet" noValidate onSubmit={(event) => void onSubmit(event)}>
          {mode === "create" ? (
            <label>
              Your name
              <input className="rounded-sm" name="name" autoComplete="name" value={person} onChange={(event) => setPerson(event.target.value)} />
            </label>
          ) : null}
          <label>
            Email
            <input className="rounded-sm" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Password
            <input
              className="rounded-sm"
              name="password"
              type="password"
              autoComplete={mode === "create" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="rounded-sm" type="submit" disabled={busy}>
            {mode === "create" ? "Create an account" : "Sign in"}
          </button>
          {error ? <p className="error">{error}</p> : null}
          <button
            className="rounded-sm"
            type="button"
            onClick={() => {
              setMode(mode === "create" ? "sign-in" : "create");
              setError("");
            }}
          >
            {mode === "create" ? "Sign in" : "Create an account"}
          </button>
        </form>
      ) : null}
      {error && (me.status !== "ready" || me.user) ? <p className="error">{error}</p> : null}
    </Shell>
  );
}

function NewGroup() {
  const me = useMe();
  const navigate = useNavigate();
  const signedOut = me.status === "ready" && !me.user;

  useEffect(() => {
    if (signedOut) navigate(`/sign-in?next=${encodeURIComponent("/groups/new")}`, { replace: true });
  }, [signedOut, navigate]);

  if (me.status !== "ready" || !me.user) return <Shell />;
  return <Start signedIn />;
}

function NotHere() {
  return (
    <Shell>
      <p>That page is not here.</p>
    </Shell>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/groups/new" element={<NewGroup />} />
      <Route path="/groups/:groupId" element={<BoardPage />} />
      <Route path="/join/:token" element={<JoinPage />} />
      <Route path="*" element={<NotHere />} />
    </Routes>
  );
}
