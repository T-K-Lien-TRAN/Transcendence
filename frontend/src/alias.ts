// frontend/alias.ts
const API_BASE = "https://localhost:3000/api";

async function request(endpoint: string, options: RequestInit = {}) {
  const headers = { "Content-Type": "application/json" };
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export const register = (user: { username: string; email: string; password: string }) =>
  request("/user/register", { method: "POST", body: JSON.stringify(user) });

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("register-form") as HTMLFormElement;
  const message = document.getElementById("register-message") as HTMLElement;

  form?.addEventListener("submit", async (e) => {
    e.preventDefault(); // stop the form from doing a normal GET submit
    message.textContent = "";

    const username = (document.getElementById("username") as HTMLInputElement).value.trim();
    const email = (document.getElementById("email") as HTMLInputElement).value.trim();
    const password = (document.getElementById("password") as HTMLInputElement).value;

    // ✅ Debug logs
    console.log("Form submit intercepted");
    console.log("Username:", username, "Email:", email, "Password:", password);

    if (!username || !email || !password) {
      message.textContent = "⚠️ All fields are required.";
      return;
    }

    try {
      const res = await register({ username, email, password });
      message.textContent = `✅ Registered successfully! ID: ${res.userId}`;
    } catch (err: any) {
      message.textContent = `❌ ${err.message}`;
    }
  });
});


