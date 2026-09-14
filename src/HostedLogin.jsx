import { useState } from "react";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import "./hosted.css";

export default function HostedLogin({ onAuthenticated }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function signIn(event) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const password = new FormData(form).get("password");
    form.reset();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          data.error || "Organizer sign-in failed. Please try again.",
        );
      if (!data.hosting?.admin)
        throw new Error("The server did not grant organizer access.");
      onAuthenticated(data);
    } catch (failure) {
      setError(
        failure.message || "Could not reach the server. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <div className="section-eyebrow">
        <ShieldCheck size={16} /> ORGANIZER ACCESS
      </div>
      <h2>
        The control <span>desk.</span>
      </h2>
      <p className="dialog-intro">
        Sign in to manage the public event, export scores, and change exhibition
        settings. Everyone can play without signing in.
      </p>
      <form className="hosted-login-form" onSubmit={signIn}>
        <label htmlFor="organizer-password">ORGANIZER PASSWORD</label>
        <div className="hosted-password-field">
          <LockKeyhole size={17} aria-hidden="true" />
          <input
            id="organizer-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={pending}
            autoFocus
            placeholder="Enter organizer password"
            aria-describedby={error ? "organizer-login-error" : undefined}
          />
        </div>
        {error && (
          <p
            id="organizer-login-error"
            role="alert"
            className="hosted-login-error"
          >
            {error}
          </p>
        )}
        <button type="submit" className="primary-button" disabled={pending}>
          {pending ? "Signing in…" : "Sign in to organizer"}
          <ArrowRight size={16} />
        </button>
      </form>
      <p className="hosted-login-note">
        Organizer access applies to this browser session. Sign out when you
        finish on a shared device.
      </p>
    </>
  );
}
