function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pageShell({ title, heading, muted, body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(title)}</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=IBM+Plex+Mono:wght@500&display=swap"
      rel="stylesheet"
    />
    <style>
      :root {
        --bg: #e8eef2;
        --bg-accent: #d5e4ec;
        --surface: #f7fafc;
        --ink: #152029;
        --muted: #5b6b78;
        --line: #c5d2dc;
        --brand: #0f6e6a;
        --shadow: 0 18px 40px rgba(21, 32, 41, 0.08);
      }
      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; }
      body {
        font-family: "DM Sans", system-ui, sans-serif;
        color: var(--ink);
        background:
          radial-gradient(1200px 500px at 10% -10%, #c9e8e4 0%, transparent 55%),
          radial-gradient(900px 420px at 100% 0%, #f3d6c8 0%, transparent 50%),
          linear-gradient(180deg, var(--bg-accent), var(--bg));
      }
      .app {
        max-width: 1100px;
        width: 100%;
        margin: 0 auto;
        padding: 0.7rem 1.25rem 3rem;
      }
      .panel {
        max-width: 720px;
        margin: 8vh auto 0;
        background: color-mix(in srgb, var(--surface) 92%, white);
        border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
        border-radius: 18px;
        box-shadow: var(--shadow);
      }
      .panel-head { padding: 1.4rem 1.4rem 0.5rem; }
      .login-head { display: flex; align-items: center; gap: 0.75rem; }
      .login-logo { width: 4.9rem; height: 5.7rem; object-fit: contain; display: block; }
      .login-brand { margin: 0; font-weight: 700; letter-spacing: -0.03em; color: var(--brand); }
      h1 { margin: 0.1rem 0 0; font-size: 1.65rem; }
      .muted { margin: 0.35rem 0 0; color: var(--muted); }
      .banner {
        margin: 0 1.4rem;
        padding: 0.7rem 0.85rem;
        border-radius: 10px;
        font-weight: 500;
      }
      .banner.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
      .banner.success { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
      form, .form { display: grid; gap: 0.9rem; padding: 0.5rem 1.4rem 1.5rem; }
      label { display: grid; gap: 0.35rem; font-weight: 600; font-size: 0.92rem; }
      input {
        width: 100%;
        border: 1px solid var(--line);
        background: white;
        border-radius: 10px;
        padding: 0.6rem 0.75rem;
        font: inherit;
        font-weight: 400;
      }
      input:focus {
        outline: 2px solid color-mix(in srgb, var(--brand) 45%, white);
        border-color: var(--brand);
      }
      .login-actions { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; }
      .btn {
        border: 0;
        border-radius: 10px;
        padding: 0.6rem 0.95rem;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      .btn.primary { background: var(--brand); color: white; }
      .login-forgot {
        border: 0;
        background: transparent;
        color: var(--brand);
        font: inherit;
        font-weight: 600;
        font-size: 0.9rem;
        padding: 0;
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 0.18em;
      }
      .reset-password-label { display: flex; justify-content: space-between; align-items: baseline; gap: 0.75rem; }
      .reset-password-tools {
        display: inline-flex;
        align-items: baseline;
        gap: 0.85rem;
        font-weight: 600;
      }
      .reset-password-hint { margin: -0.35rem 0 0; font-weight: 400; font-size: 0.85rem; color: var(--muted); }
      .reset-password-value {
        display: none;
        margin-top: 0.35rem;
        font-family: "IBM Plex Mono", ui-monospace, monospace;
        font-size: 0.88rem;
        font-weight: 600;
        color: var(--ink);
        word-break: break-all;
      }
      .reset-password-value.is-on { display: inline-block; }
      .reset-password-confirm {
        -webkit-text-security: disc;
      }
    </style>
  </head>
  <body>
    <div class="app">
      <section class="panel">
        <div class="panel-head">
          <div class="login-head">
            <img class="login-logo" src="/five-wits-logo.png?v=2" alt="Five Wits" />
            <div>
              <p class="login-brand">Help Desk</p>
              <h1>${escapeHtml(heading)}</h1>
            </div>
          </div>
          <p class="muted">${escapeHtml(muted)}</p>
        </div>
        ${body}
      </section>
    </div>
  </body>
</html>`;
}

function sendHtml(res, html, status = 200) {
  res
    .status(status)
    .set({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    })
    .send(html);
}

function resetPasswordPage({ token, email, error }) {
  const safeToken = escapeHtml(token);
  const safeEmail = escapeHtml(email);
  const errorBanner = error
    ? `<div class="banner error">${escapeHtml(error)}</div>`
    : "";
  const body = email
    ? `${errorBanner}
        <form method="post" action="/api/auth/reset-password" autocomplete="on">
          <input type="hidden" name="token" value="${safeToken}" />
          <label for="login-username">
            Email
            <input
              id="login-username"
              name="username"
              type="email"
              autocomplete="username"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              required
              readonly
              onfocus="this.removeAttribute('readonly')"
              value="${safeEmail}"
            />
          </label>
          <label for="new-password">
            <span class="reset-password-label">
              New password
              <span class="reset-password-tools">
                <button type="button" class="login-forgot" id="generate-password">Generate password</button>
                <button type="button" class="login-forgot" id="copy-password">Copy</button>
              </span>
            </span>
            <input
              id="new-password"
              name="password"
              type="password"
              autocomplete="new-password"
              minlength="6"
              required
              spellcheck="false"
            />
          </label>
          <p class="reset-password-hint">
            Copy this password, then choose Update when Google asks to save it.
            <code class="reset-password-value" id="generated-password"></code>
          </p>
          <label for="confirm-password">
            Retype password
            <input
              id="confirm-password"
              name="confirm"
              type="text"
              class="reset-password-confirm"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              minlength="6"
              required
            />
          </label>
          <div class="login-actions">
            <a class="login-forgot" href="/">Back to sign in</a>
            <button type="submit" class="btn primary">Update password</button>
          </div>
        </form>
        <script>
          (function () {
            var form = document.querySelector("form");
            var password = document.getElementById("new-password");
            var confirm = document.getElementById("confirm-password");
            var generated = document.getElementById("generated-password");
            var copyBtn = document.getElementById("copy-password");
            function pick(set) { return set[Math.floor(Math.random() * set.length)]; }
            function setPassword(value) {
              password.value = value;
              confirm.value = value;
              password.dispatchEvent(new Event("input", { bubbles: true }));
              confirm.dispatchEvent(new Event("input", { bubbles: true }));
              generated.textContent = value;
              generated.classList.add("is-on");
              copyBtn.textContent = "Copy";
            }
            document.getElementById("generate-password").addEventListener("click", function () {
              var lower = "abcdefghijkmnopqrstuvwxyz";
              var upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
              var digits = "23456789";
              var symbols = "!@#$%^&*-_?";
              var all = lower + upper + digits + symbols;
              var chars = [pick(lower), pick(upper), pick(digits), pick(symbols)];
              while (chars.length < 16) chars.push(pick(all));
              for (var i = chars.length - 1; i > 0; i -= 1) {
                var j = Math.floor(Math.random() * (i + 1));
                var next = chars[i];
                chars[i] = chars[j];
                chars[j] = next;
              }
              setPassword(chars.join(""));
            });
            copyBtn.addEventListener("click", function () {
              var value = password.value;
              if (!value) return;
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(value).then(function () {
                  copyBtn.textContent = "Copied";
                }).catch(function () {
                  generated.classList.add("is-on");
                  generated.textContent = value;
                });
                return;
              }
              generated.classList.add("is-on");
              generated.textContent = value;
            });
            form.addEventListener("submit", function (event) {
              if (password.value !== confirm.value) {
                event.preventDefault();
                alert("Passwords do not match");
              }
            });
          })();
        </script>`
    : `${errorBanner}
        <div class="form">
          <div class="login-actions">
            <a class="login-forgot" href="/">Back to sign in</a>
          </div>
        </div>`;

  return pageShell({
    title: "Reset password",
    heading: "Reset password",
    muted: email
      ? "Choose a new password for your account."
      : "This reset link can’t be used.",
    body,
  });
}

function passwordUpdatedPage({ email }) {
  const signInHref = email
    ? `/?email=${encodeURIComponent(email)}`
    : "/";
  const body = `
        <div class="banner success">Password updated. Sign in with your new password.</div>
        <div class="form">
          <div class="login-actions">
            <a class="btn primary" href="${escapeHtml(signInHref)}" style="text-decoration:none">Sign in</a>
          </div>
        </div>`;
  return pageShell({
    title: "Password updated",
    heading: "Password updated",
    muted: email
      ? `Your password for ${email} is ready to use on this phone and your computer.`
      : "Your password is ready to use on this phone and your computer.",
    body,
  });
}

export { sendHtml, resetPasswordPage, passwordUpdatedPage };
