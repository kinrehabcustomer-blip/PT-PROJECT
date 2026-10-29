"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/infrastructure/api/client";
import { useApp } from "@/presentation/state/app-context";

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(formData: FormData) {
    setBusy(true);
    setError(null);
    try {
      await api.login(String(formData.get("username")), String(formData.get("password")));
      await refresh();
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="modal" action={submit}>
        <h2>เข้าสู่ระบบ PT Care</h2>
        <p>ใช้บัญชีที่ผู้ดูแลระบบสร้างให้</p>
        <label className="form-field">ชื่อผู้ใช้<input name="username" autoComplete="username" required autoFocus /></label>
        <label className="form-field">รหัสผ่าน<input name="password" type="password" autoComplete="current-password" required /></label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="modal-actions"><button className="primary-button" disabled={busy}>{busy ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}</button></div>
      </form>
    </main>
  );
}
