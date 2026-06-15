const nativeFetch = window.fetch.bind(window);
const authRoot = createAuthRoot();
const form = authRoot.querySelector("#authForm");
const emailInput = authRoot.querySelector("#authEmail");
const passwordInput = authRoot.querySelector("#authPassword");
const submitButton = authRoot.querySelector("#authSubmit");
const switchButton = authRoot.querySelector("#authSwitch");
const status = authRoot.querySelector("#authStatus");
const title = authRoot.querySelector("#authTitle");
const prompt = authRoot.querySelector("#authPrompt");
let mode = "signin";
let supabase;

function waitForSession() {
  return new Promise((resolve) => {
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        if (event === "SIGNED_IN" && nextSession) {
          listener.subscription.unsubscribe();
          activateSession(nextSession);
          resolve();
        }
      },
    );
  });
}

function activateSession(session) {
  authRoot.hidden = true;
  document.body.classList.remove("auth-locked");
  addAccountControl(session.user);

  window.fetch = async (input, init = {}) => {
    const requestUrl = new URL(
      input instanceof Request ? input.url : input,
      window.location.href,
    );
    if (
      requestUrl.origin !== window.location.origin
      || !requestUrl.pathname.startsWith("/api/")
      || requestUrl.pathname === "/api/auth/config"
    ) {
      return nativeFetch(input, init);
    }

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.reload();
      throw new Error("Authentication session expired");
    }

    const headers = new Headers(
      init.headers || (input instanceof Request ? input.headers : undefined),
    );
    headers.set("Authorization", `Bearer ${token}`);
    return nativeFetch(input, { ...init, headers });
  };
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(true);
  setStatus("");

  const credentials = {
    email: emailInput.value.trim(),
    password: passwordInput.value,
  };
  const result = mode === "signup"
    ? await supabase.auth.signUp(credentials)
    : await supabase.auth.signInWithPassword(credentials);

  if (result.error) {
    setStatus(result.error.message, true);
    setBusy(false);
    return;
  }
  if (mode === "signup" && !result.data.session) {
    setStatus("Check your email to confirm your account.");
    setBusy(false);
  }
});

switchButton.addEventListener("click", () => {
  mode = mode === "signin" ? "signup" : "signin";
  const signingUp = mode === "signup";
  title.textContent = signingUp ? "Create your account" : "Welcome back";
  prompt.textContent = signingUp
    ? "Already have an account?"
    : "New to Neurogram?";
  submitButton.textContent = signingUp ? "Create account" : "Sign in";
  switchButton.textContent = signingUp ? "Sign in" : "Create account";
  passwordInput.autocomplete = signingUp ? "new-password" : "current-password";
  setStatus("");
});

function addAccountControl(user) {
  const control = document.createElement("div");
  control.className = "auth-account";
  control.innerHTML = `
    <span>${escapeHtml(user.email || "Signed in")}</span>
    <button type="button">Sign out</button>
  `;
  control.querySelector("button").addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.reload();
  });
  document.body.append(control);
}

function setBusy(busy) {
  submitButton.disabled = busy;
  switchButton.disabled = busy;
  submitButton.textContent = busy
    ? (mode === "signup" ? "Creating account..." : "Signing in...")
    : (mode === "signup" ? "Create account" : "Sign in");
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function showConfigurationError() {
  authRoot.hidden = false;
  form.hidden = true;
  authRoot.querySelector(".auth-switch").hidden = true;
  title.textContent = "Authentication needs configuration";
  setStatus(
    "Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env, then restart Neurogram.",
    true,
  );
}

function createAuthRoot() {
  document.body.classList.add("auth-locked");
  const root = document.createElement("div");
  root.className = "auth-gate";
  root.hidden = true;
  root.innerHTML = `
    <section class="auth-card" aria-labelledby="authTitle">
      <p class="auth-eyebrow">Neurogram · Private memory atlas</p>
      <h1 id="authTitle">Welcome back</h1>
      <p class="auth-copy">Sign in to access your memories and associations.</p>
      <form id="authForm">
        <label for="authEmail">Email</label>
        <input id="authEmail" type="email" autocomplete="email" required>
        <label for="authPassword">Password</label>
        <input id="authPassword" type="password" autocomplete="current-password"
          minlength="6" required>
        <button class="auth-primary" id="authSubmit" type="submit">Sign in</button>
      </form>
      <p class="auth-status" id="authStatus" role="status" aria-live="polite"></p>
      <p class="auth-switch">
        <span id="authPrompt">New to Neurogram?</span>
        <button id="authSwitch" type="button">Create account</button>
      </p>
    </section>
  `;
  document.body.append(root);
  return root;
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

async function initializeAuth() {
  const configResponse = await nativeFetch("/api/auth/config");
  if (configResponse.status === 204) {
    document.body.classList.remove("auth-locked");
    return;
  }
  if (!configResponse.ok) {
    showConfigurationError();
    await new Promise(() => {});
  }

  const { url, publishableKey } = await configResponse.json();
  supabase = window.supabase.createClient(url, publishableKey);
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    activateSession(session);
  } else {
    authRoot.hidden = false;
    await waitForSession();
  }
}

await initializeAuth();
